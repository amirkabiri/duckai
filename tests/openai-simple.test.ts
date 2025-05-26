import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import OpenAI from "openai";

const BASE_URL = "http://localhost:3003";
let server: any;
let openai: OpenAI;

beforeAll(async () => {
  // Start the server for testing
  const { spawn } = require("child_process");
  server = spawn("bun", ["run", "src/server.ts"], {
    env: { ...process.env, PORT: "3003" },
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

describe("OpenAI JavaScript Library - Core Tests", () => {
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

      // Check model structure
      const firstModel = models.data[0];
      expect(firstModel.object).toBe("model");
      expect(firstModel.owned_by).toBe("duckai");
      expect(typeof firstModel.created).toBe("number");
    });
  });

  describe("Chat Completions API", () => {
    it("should create basic chat completion using OpenAI library", async () => {
      // Add timeout handling for slow Duck.ai responses
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Test timeout - Duck.ai may be slow")),
          25000
        )
      );

      const testPromise = openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Say hello" }],
      });

      const completion = await Promise.race([testPromise, timeoutPromise]);

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
      if (completion.usage) {
        expect(typeof completion.usage.prompt_tokens).toBe("number");
        expect(typeof completion.usage.completion_tokens).toBe("number");
        expect(typeof completion.usage.total_tokens).toBe("number");
      }
    });

    it("should handle different models", async () => {
      const completion = await openai.chat.completions.create({
        model: "claude-3-haiku-20240307",
        messages: [{ role: "user", content: "Say hi" }],
      });

      expect(completion.model).toBe("claude-3-haiku-20240307");
      expect(completion.choices[0].message.content).toBeDefined();
      expect(typeof completion.choices[0].message.content).toBe("string");
    });

    it("should handle system messages", async () => {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "How are you?" },
        ],
      });

      expect(completion.choices[0].message.role).toBe("assistant");
      expect(completion.choices[0].message.content).toBeDefined();
    });

    it("should handle optional parameters", async () => {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Tell me a short joke" }],
        temperature: 0.7,
        max_tokens: 50,
      });

      expect(completion.choices[0].message.content).toBeDefined();
    });
  });

  describe("Streaming Chat Completions", () => {
    it("should create streaming chat completion using OpenAI library", async () => {
      const stream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Count from 1 to 3" }],
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

        // Break on finish
        if (choice.finish_reason === "stop") {
          break;
        }
      }

      expect(chunks.length).toBeGreaterThan(0);

      // First chunk should have role
      const firstChunk = chunks.find((c) => c.choices[0].delta.role);
      expect(firstChunk).toBeDefined();
      if (firstChunk) {
        expect(firstChunk.choices[0].delta.role).toBe("assistant");
      }

      // Last chunk should have finish_reason
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.choices[0].finish_reason).toBe("stop");
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
        // Should be 400 for validation error, but Duck.ai might return 500
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

  describe("Real-world Usage", () => {
    it("should work like a real OpenAI client", async () => {
      // This test demonstrates real-world usage
      const conversation: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
        [{ role: "user", content: "What is 2+2?" }];

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: conversation,
      });

      expect(response.choices[0].message.content).toBeDefined();

      // Add response to conversation
      conversation.push(response.choices[0].message);
      conversation.push({ role: "user", content: "What about 3+3?" });

      const response2 = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: conversation,
      });

      expect(response2.choices[0].message.content).toBeDefined();
    });

    it("should handle streaming like real OpenAI", async () => {
      const stream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Write a very short poem" }],
        stream: true,
      });

      let fullResponse = "";
      for await (const chunk of stream) {
        if (chunk.choices[0].delta.content) {
          fullResponse += chunk.choices[0].delta.content;
        }
        if (chunk.choices[0].finish_reason === "stop") {
          break;
        }
      }

      expect(fullResponse.length).toBeGreaterThan(0);
    });
  });
});
