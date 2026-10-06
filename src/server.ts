import { OpenAIService } from "./openai-service";

const openAIService = new OpenAIService();

const server = Bun.serve({
  port: process.env.PORT || 3000,
  async fetch(req) {
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
          const stream =
            await openAIService.createChatCompletionStream(validatedRequest);
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
        const completion =
          await openAIService.createChatCompletion(validatedRequest);
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
        },
      );
    } catch (error) {
      console.error("Server error:", error);

      const errorMessage =
        error instanceof Error ? error.message : "Internal server error";
      const statusCode =
        errorMessage.includes("required") || errorMessage.includes("must")
          ? 400
          : 500;

      return new Response(
        JSON.stringify({
          error: {
            message: errorMessage,
            type:
              statusCode === 400
                ? "invalid_request_error"
                : "internal_server_error",
          },
        }),
        {
          status: statusCode,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }
  },
});

console.log(
  `🚀 OpenAI-compatible server running on http://localhost:${server.port}`,
);
console.log(`📚 Available endpoints:`);
console.log(`  GET  /health - Health check`);
console.log(`  GET  /v1/models - List available models`);
console.log(
  `  POST /v1/chat/completions - Chat completions (streaming & non-streaming)`,
);
console.log(`\n🔧 Example usage:`);
console.log(
  `curl -X POST http://localhost:${server.port}/v1/chat/completions \\`,
);
console.log(`  -H "Content-Type: application/json" \\`);
console.log(
  `  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello!"}]}'`,
);
