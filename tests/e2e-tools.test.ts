import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { Server } from "bun";
import { OpenAIService } from "../src/openai-service";

describe("End-to-End Tool Calling Tests", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Create a separate server instance for testing on a different port
    const openAIService = new OpenAIService();
    const testPort = 3001;

    server = Bun.serve({
      port: testPort,
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
          if (
            url.pathname === "/v1/chat/completions" &&
            req.method === "POST"
          ) {
            const body = await req.json();
            const validatedRequest = openAIService.validateRequest(body);

            // Handle streaming
            if (validatedRequest.stream) {
              const stream =
                await openAIService.createChatCompletionStream(
                  validatedRequest
                );
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
            }
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
            }
          );
        }
      },
    });

    baseUrl = `http://localhost:${testPort}`;

    // Wait a bit for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(() => {
    if (server) {
      server.stop();
    }
  });

  describe("Function Calling API", () => {
    it("should handle basic function calling request", async () => {
      const request = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "What time is it?" }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_current_time",
              description: "Get the current time",
            },
          },
        ],
      };

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.object).toBe("chat.completion");
      expect(data.choices).toHaveLength(1);
      expect(data.choices[0].message.role).toBe("assistant");

      // The response should either contain tool_calls or regular content
      // depending on whether the AI decided to call the function
      if (data.choices[0].finish_reason === "tool_calls") {
        expect(data.choices[0].message.tool_calls).toBeDefined();
        expect(data.choices[0].message.content).toBe(null);
      } else {
        expect(data.choices[0].message.content).toBeTypeOf("string");
      }
    });

    it("should handle calculate function", async () => {
      const request = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Calculate 15 + 27" }],
        tools: [
          {
            type: "function",
            function: {
              name: "calculate",
              description: "Perform mathematical calculations",
              parameters: {
                type: "object",
                properties: {
                  expression: {
                    type: "string",
                    description: "Mathematical expression to evaluate",
                  },
                },
                required: ["expression"],
              },
            },
          },
        ],
        tool_choice: "required",
      };

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // With tool_choice: "required", we should get a function call
      expect(data.choices[0].finish_reason).toBe("tool_calls");
      expect(data.choices[0].message.tool_calls).toHaveLength(1);
      expect(data.choices[0].message.tool_calls[0].function.name).toBe(
        "calculate"
      );
    });

    it("should handle weather function", async () => {
      const request = {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: "What's the weather like in San Francisco?",
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get weather information for a location",
              parameters: {
                type: "object",
                properties: {
                  location: {
                    type: "string",
                    description: "The city and state, e.g. San Francisco, CA",
                  },
                },
                required: ["location"],
              },
            },
          },
        ],
      };

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.object).toBe("chat.completion");
      expect(data.choices[0].message.role).toBe("assistant");
    });

    it("should handle streaming with tools", async () => {
      const request = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "What time is it?" }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_current_time",
              description: "Get the current time",
            },
          },
        ],
        stream: true,
      };

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");

      const reader = response.body?.getReader();
      expect(reader).toBeDefined();

      let chunks: string[] = [];
      let done = false;

      while (!done && chunks.length < 10) {
        // Limit to prevent infinite loop
        const { value, done: streamDone } = await reader!.read();
        done = streamDone;

        if (value) {
          const text = new TextDecoder().decode(value);
          chunks.push(text);
        }
      }

      const fullResponse = chunks.join("");
      expect(fullResponse).toContain("data:");
      expect(fullResponse).toContain("[DONE]");
    });

    it("should reject invalid tool definitions", async () => {
      const request = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Hello" }],
        tools: [
          {
            type: "invalid_type",
            function: {
              name: "test",
            },
          },
        ],
      };

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.message).toContain("Invalid tools");
    });

    it("should handle tool_choice none", async () => {
      const request = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "What time is it?" }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_current_time",
              description: "Get the current time",
            },
          },
        ],
        tool_choice: "none",
      };

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // With tool_choice: "none", we should get regular content, not function calls
      expect(data.choices[0].message.content).toBeTypeOf("string");
      expect(data.choices[0].finish_reason).toBe("stop");
    });

    it("should handle multi-turn conversation with tools", async () => {
      const request = {
        model: "gpt-4o-mini",
        messages: [
          { role: "user", content: "What time is it?" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "get_current_time",
                  arguments: "{}",
                },
              },
            ],
          },
          {
            role: "tool",
            content: "2024-01-15T10:30:00Z",
            tool_call_id: "call_1",
          },
          {
            role: "user",
            content: "Thanks! Can you also calculate 10 + 5?",
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "get_current_time",
              description: "Get the current time",
            },
          },
          {
            type: "function",
            function: {
              name: "calculate",
              description: "Perform mathematical calculations",
              parameters: {
                type: "object",
                properties: {
                  expression: {
                    type: "string",
                    description: "Mathematical expression to evaluate",
                  },
                },
                required: ["expression"],
              },
            },
          },
        ],
      };

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.object).toBe("chat.completion");
      expect(data.choices[0].message.role).toBe("assistant");
    });
  });

  describe("Error Handling", () => {
    it("should handle malformed tool messages", async () => {
      const request = {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "tool",
            content: "Some result",
            // Missing tool_call_id
          },
        ],
      };

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.message).toContain("tool_call_id");
    });

    it("should handle missing function parameters", async () => {
      const request = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Hello" }],
        tools: [
          {
            type: "function",
            function: {
              // Missing name
              description: "A test function",
            },
          },
        ],
      };

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.message).toContain("function name is required");
    });
  });
});
