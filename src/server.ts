import { OpenAIService } from "./openai-service";
import * as http from "http";

const openAIService = new OpenAIService();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);

  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.writeHead(200, corsHeaders);
    res.end();
    return;
  }

  try {
    // Health check endpoint
    if (url.pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // Models endpoint
    if (url.pathname === "/v1/models" && req.method === "GET") {
      const models = openAIService.getModels();
      res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify(models));
      return;
    }

    // Chat completions endpoint
    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });

      req.on("end", async () => {
        try {
          const parsedBody = JSON.parse(body);
          const validatedRequest = openAIService.validateRequest(parsedBody);

          // Handle streaming
          if (validatedRequest.stream) {
            const stream = await openAIService.createChatCompletionStream(validatedRequest);
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
              ...corsHeaders,
            });

            const reader = stream.getReader();
            const pump = async () => {
              try {
                const { done, value } = await reader.read();
                if (done) {
                  res.end();
                  return;
                }
                // value is Uint8Array, write it directly
                res.write(value);
                pump();
              } catch (error) {
                console.error("Stream error:", error);
                res.end();
              }
            };
            pump();
            return;
          }

          // Handle non-streaming
          const completion = await openAIService.createChatCompletion(validatedRequest);
          res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
          res.end(JSON.stringify(completion));
        } catch (error) {
          console.error("Request processing error:", error);
          const errorMessage = error instanceof Error ? error.message : "Internal server error";
          const statusCode = errorMessage.includes("required") || errorMessage.includes("must") ? 400 : 500;

          res.writeHead(statusCode, { "Content-Type": "application/json", ...corsHeaders });
          res.end(JSON.stringify({
            error: {
              message: errorMessage,
              type: statusCode === 400 ? "invalid_request_error" : "internal_server_error",
            },
          }));
        }
      });
      return;
    }

    // 404 for unknown endpoints
    res.writeHead(404, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({
      error: {
        message: "Not found",
        type: "invalid_request_error",
      },
    }));
  } catch (error) {
    console.error("Server error:", error);

    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    const statusCode = errorMessage.includes("required") || errorMessage.includes("must") ? 400 : 500;

    res.writeHead(statusCode, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({
      error: {
        message: errorMessage,
        type: statusCode === 400 ? "invalid_request_error" : "internal_server_error",
      },
    }));
  }
});

const startServer = (port: number) => {
  server.listen(port, () => {
    console.log(`🚀 OpenAI-compatible server running on http://localhost:${port}`);
    console.log(`📚 Available endpoints:`);
    console.log(`  GET  /health - Health check`);
    console.log(`  GET  /v1/models - List available models`);
    console.log(`  POST /v1/chat/completions - Chat completions (streaming & non-streaming)`);
    console.log(`\n🔧 Example usage:`);
    console.log(`curl -X POST http://localhost:${port}/v1/chat/completions \\`);
    console.log(`  -H "Content-Type: application/json" \\`);
    console.log(`  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello!"}]}'`);
  }).on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} is busy, trying ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
};

const initialPort = parseInt(process.env.PORT || '3001');
startServer(initialPort);

// Handle server errors
server.on('error', (error) => {
  console.error('Server error:', error);
  process.exit(1);
});

// Keep the process alive
process.on('SIGINT', () => {
  console.log('SIGINT received, but keeping server running...');
  // Don't exit, just log
});
