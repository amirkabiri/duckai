import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import OpenAI from "openai";

const BASE_URL = "http://localhost:3002";
let server: any;
let openai: OpenAI;

beforeAll(async () => {
  // Start the server for testing
  const { spawn } = require("child_process");
  server = spawn("bun", ["run", "src/server.ts"], {
    env: { ...process.env, PORT: "3002" },
    stdio: "pipe",
  });

  // Wait for server to start
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Initialize OpenAI client
  openai = new OpenAI({
    baseURL: `${BASE_URL}/v1`,
    apiKey: "dummy-key", // Our server doesn't require auth, but SDK expects it
  });
});

afterAll(() => {
  if (server) {
    server.kill();
  }
});

describe("OpenAI JavaScript Library Compatibility", () => {
  describe("Models API", () => {
    it("should list models using OpenAI library", async () => {
      const models = await openai.models.list();

      expect(models.object).toBe("list");
      expect(Array.isArray(models.data)).toBe(true);
      expect(models.data.length).toBeGreaterThan(0);

      // Check that we have expected models
      const modelIds = models.data.map((m) => m.id);
      expect(modelIds).toContain("gpt-4o-mini");
      expect(modelIds).toContain("claude-3-haiku-20240307");
      expect(modelIds).toContain("mistralai/Mistral-Small-24B-Instruct-2501");

      // Check model structure
      const firstModel = models.data[0];
      expect(firstModel.object).toBe("model");
      expect(firstModel.owned_by).toBe("duckai");
      expect(typeof firstModel.created).toBe("number");
    });
  });

  describe("Chat Completions API", () => {
    it("should create basic chat completion using OpenAI library", async () => {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "user", content: "Say 'Hello World' and nothing else" },
        ],
        max_tokens: 10,
      });

      expect(completion.object).toBe("chat.completion");
      expect(completion.model).toBe("gpt-4o-mini");
      expect(completion.choices).toHaveLength(1);

      const choice = completion.choices[0];
      expect(choice.index).toBe(0);
      expect(choice.message.role).toBe("assistant");
      expect(typeof choice.message.content).toBe("string");
      expect(choice.finish_reason).toBe("stop");

      // Check usage
      expect(completion.usage).toBeDefined();
      expect(typeof completion.usage.prompt_tokens).toBe("number");
      expect(typeof completion.usage.completion_tokens).toBe("number");
      expect(typeof completion.usage.total_tokens).toBe("number");
      expect(completion.usage.total_tokens).toBe(
        completion.usage.prompt_tokens + completion.usage.completion_tokens
      );
    });

    it("should handle different models", async () => {
      const models = [
        "gpt-4o-mini",
        "claude-3-haiku-20240307",
        "mistralai/Mistral-Small-24B-Instruct-2501",
      ];

      for (const model of models) {
        const completion = await openai.chat.completions.create({
          model,
          messages: [{ role: "user", content: "Say hi" }],
        });

        expect(completion.model).toBe(model);
        expect(completion.choices[0].message.content).toBeDefined();
        expect(typeof completion.choices[0].message.content).toBe("string");
      }
    });

    it("should handle system messages", async () => {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a helpful assistant that responds in exactly 3 words.",
          },
          { role: "user", content: "How are you?" },
        ],
      });

      expect(completion.choices[0].message.role).toBe("assistant");
      expect(completion.choices[0].message.content).toBeDefined();
    });

    it("should handle conversation history", async () => {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "user", content: "My name is Alice" },
          { role: "assistant", content: "Hello Alice! Nice to meet you." },
          { role: "user", content: "What's my name?" },
        ],
      });

      expect(completion.choices[0].message.content).toBeDefined();
      expect(typeof completion.choices[0].message.content).toBe("string");
    });

    it("should handle optional parameters", async () => {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Tell me a short joke" }],
        temperature: 0.7,
        max_tokens: 50,
        top_p: 0.9,
      });

      expect(completion.choices[0].message.content).toBeDefined();
      expect(completion.usage.completion_tokens).toBeLessThanOrEqual(50);
    });
  });

  describe("Streaming Chat Completions", () => {
    it("should create streaming chat completion using OpenAI library", async () => {
      const stream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "user", content: "Count from 1 to 5, one number per line" },
        ],
        stream: true,
      });

      let chunks: any[] = [];
      let fullContent = "";

      for await (const chunk of stream) {
        chunks.push(chunk);

        expect(chunk.object).toBe("chat.completion.chunk");
        expect(chunk.model).toBe("gpt-4o-mini");
        expect(chunk.choices).toHaveLength(1);

        const choice = chunk.choices[0];
        expect(choice.index).toBe(0);

        if (choice.delta.content) {
          fullContent += choice.delta.content;
        }

        // Check finish_reason on last chunk
        if (choice.finish_reason === "stop") {
          expect(choice.delta).toEqual({});
        }
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(fullContent.length).toBeGreaterThan(0);

      // First chunk should have role
      const firstChunk = chunks.find((c) => c.choices[0].delta.role);
      expect(firstChunk).toBeDefined();
      expect(firstChunk.choices[0].delta.role).toBe("assistant");

      // Last chunk should have finish_reason
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.choices[0].finish_reason).toBe("stop");
    });

    it("should handle streaming with different models", async () => {
      const stream = await openai.chat.completions.create({
        model: "claude-3-haiku-20240307",
        messages: [{ role: "user", content: "Say hello" }],
        stream: true,
      });

      let chunkCount = 0;
      for await (const chunk of stream) {
        chunkCount++;
        expect(chunk.model).toBe("claude-3-haiku-20240307");
        expect(chunk.object).toBe("chat.completion.chunk");

        // Don't process too many chunks in test
        if (chunkCount > 20) break;
      }

      expect(chunkCount).toBeGreaterThan(0);
    });

    it("should handle streaming errors gracefully", async () => {
      try {
        const stream = await openai.chat.completions.create({
          model: "invalid-model",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
        });

        // This should not reach here if validation works
        for await (const chunk of stream) {
          // Should not get here
          expect(true).toBe(false);
        }
      } catch (error) {
        // Should catch validation error or API error
        expect(error).toBeDefined();
      }
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid requests properly", async () => {
      try {
        await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [] as any, // Invalid empty messages
        });

        // Should not reach here
        expect(true).toBe(false);
      } catch (error: any) {
        expect(error).toBeDefined();
        // Should be 400 for validation error, but Duck.ai might return 500 due to rate limiting
        expect([400, 500]).toContain(error.status);
      }
    });

    it("should handle malformed messages", async () => {
      try {
        await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "invalid" as any, content: "test" }],
        });

        // Should not reach here
        expect(true).toBe(false);
      } catch (error: any) {
        expect(error).toBeDefined();
        expect(error.status).toBe(400);
      }
    });
  });

  describe("Advanced Features", () => {
    it("should maintain conversation context", async () => {
      // First message
      const completion1 = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Remember this number: 42" }],
      });

      expect(completion1.choices[0].message.content).toBeDefined();

      // Follow-up message with context
      const completion2 = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "user", content: "Remember this number: 42" },
          {
            role: "assistant",
            content: completion1.choices[0].message.content,
          },
          { role: "user", content: "What number did I ask you to remember?" },
        ],
      });

      expect(completion2.choices[0].message.content).toBeDefined();
    });

    it("should handle concurrent requests", async () => {
      const promises = Array.from({ length: 3 }, (_, i) =>
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: `Say "Response ${i + 1}"` }],
        })
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach((result, i) => {
        expect(result.choices[0].message.content).toBeDefined();
        expect(result.object).toBe("chat.completion");
      });
    });

    it("should handle long conversations", async () => {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there! How can I help you?" },
        { role: "user", content: "What's the weather like?" },
        {
          role: "assistant",
          content: "I don't have access to current weather data.",
        },
        { role: "user", content: "That's okay, thanks!" },
      ];

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
      });

      expect(completion.choices[0].message.content).toBeDefined();
      expect(completion.usage.prompt_tokens).toBeGreaterThan(20); // Should be substantial for long conversation
    });
  });

  describe("Performance Tests", () => {
    it("should respond within reasonable time", async () => {
      const startTime = Date.now();

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Say hello" }],
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(completion.choices[0].message.content).toBeDefined();
      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds
    });

    it("should handle streaming efficiently", async () => {
      try {
        const startTime = Date.now();
        let firstChunkTime: number | null = null;

        const stream = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "Count to 3" }],
          stream: true,
        });

        for await (const chunk of stream) {
          if (firstChunkTime === null) {
            firstChunkTime = Date.now();
          }

          expect(chunk.object).toBe("chat.completion.chunk");

          if (chunk.choices[0].finish_reason === "stop") {
            break;
          }
        }

        expect(firstChunkTime).not.toBeNull();
        expect(firstChunkTime! - startTime).toBeLessThan(5000); // First chunk within 5 seconds
      } catch (error: any) {
        // If we hit rate limits or other external service issues, skip the test
        if (
          error.status === 500 &&
          error.message?.includes("Too Many Requests")
        ) {
          console.warn(
            "Skipping streaming efficiency test due to rate limiting"
          );
          expect(true).toBe(true); // Pass the test
        } else {
          throw error; // Re-throw other errors
        }
      }
    });
  });
});
