import { OpenAIService } from "./openai-service";

// Detect runtime
const isBun = typeof (globalThis as any).Bun !== 'undefined';

const openAIService = new OpenAIService();

if (isBun) {
  // Bun runtime - use Bun.serve()
  console.log(`Attempting to start server on port ${parseInt(process.env.PORT || '3001')}...`);
  const server = (globalThis as any).Bun.serve({
    port: parseInt(process.env.PORT || '3001'),
    async fetch(req: Request) {
      const url = new URL(req.url);

      // CORS headers
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      };

      // Handle preflight requests
      if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
      }

      try {
        // Health check endpoint
        if (url.pathname === "/health" && req.method === "GET") {
          return new Response(JSON.stringify({ status: "ok" }), {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }

        // Models endpoint
        if (url.pathname === "/v1/models" && req.method === "GET") {
          const models = openAIService.getModels();
          return new Response(JSON.stringify(models), {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }

        // Chat completions endpoint
        if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
          const body = await req.json();
          const validatedRequest = openAIService.validateRequest(body);

          // Handle streaming
          if (validatedRequest.stream) {
            const stream = await openAIService.createChatCompletionStream(validatedRequest);
            return new Response(stream, {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
                ...corsHeaders,
              },
            });
          }

          // Handle non-streaming
          const completion = await openAIService.createChatCompletion(validatedRequest);
          return new Response(JSON.stringify(completion), {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }

        // 404 for unknown endpoints
        return new Response(
          JSON.stringify({
            error: {
              message: "Not found",
              type: "invalid_request_error",
            },
          }),
          {
            status: 404,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          }
        );
      } catch (error) {
        console.error("Server error:", error);

        const errorMessage = error instanceof Error ? error.message : "Internal server error";
        const statusCode = errorMessage.includes("required") || errorMessage.includes("must") ? 400 : 500;

        return new Response(
          JSON.stringify({
            error: {
              message: errorMessage,
              type: statusCode === 400 ? "invalid_request_error" : "internal_server_error",
            },
          }),
          {
            status: statusCode,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          }
        );
      }
    },
  });

  console.log(`🚀 OpenAI-compatible server running on http://localhost:${server.port}`);
  console.log(`📚 Available endpoints:`);
  console.log(`  GET  /health - Health check`);
  console.log(`  GET  /v1/models - List available models`);
  console.log(`  POST /v1/chat/completions - Chat completions (streaming & non-streaming)`);
  console.log(`\n🔧 Example usage:`);
  console.log(`curl -X POST http://localhost:${server.port}/v1/chat/completions \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello!"}]}'`);
} else {
  // Node.js runtime - use http.createServer()
  const startNodeServer = async () => {
    const { createServer } = await import("http");

    const createServerInstance = () => createServer(async (req, res) => {
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

    const startServer = (port: number) => {
      console.log(`Attempting to start server on port ${port}...`);

      const server = createServerInstance();

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
      });

      server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`Port ${port} is already in use, trying port ${port + 1}...`);
          startServer(port + 1);
        } else {
          console.error('Server startup error:', err);
          process.exit(1);
        }
      });
    };

    const initialPort = parseInt(process.env.PORT || '3001');
    startServer(initialPort);
  };

  startNodeServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
