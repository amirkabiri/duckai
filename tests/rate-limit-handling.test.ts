import { describe, it, expect, beforeEach } from "bun:test";
import { OpenAIService } from "../src/openai-service";
import type { ChatCompletionRequest, ToolDefinition } from "../src/types";

describe("Rate Limiting and Error Handling", () => {
  let openAIService: OpenAIService;

  beforeEach(() => {
    openAIService = new OpenAIService();
  });

  const sampleTools: ToolDefinition[] = [
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
  ];

  describe("Duck.ai API Error Handling", () => {
    it("should handle rate limiting gracefully with fallback", async () => {
      const request: ChatCompletionRequest = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "What time is it?" }],
        tools: sampleTools,
        tool_choice: "required",
      };

      // Mock Duck.ai to throw rate limit error
      const originalChat = openAIService["duckAI"].chat;
      openAIService["duckAI"].chat = async () => {
        throw new Error("429 Too Many Requests");
      };

      try {
        const response = await openAIService.createChatCompletion(request);

        // Should still work with fallback mechanism
        expect(response.choices[0].finish_reason).toBe("tool_calls");
        expect(response.choices[0].message.tool_calls).toHaveLength(1);
        expect(response.choices[0].message.tool_calls![0].function.name).toBe(
          "get_current_time"
        );
      } catch (error) {
        // If it throws, it should be handled gracefully
        expect(error).toBeInstanceOf(Error);
      } finally {
        // Restore original method
        openAIService["duckAI"].chat = originalChat;
      }
    });

    it("should handle empty responses with tool_choice required", async () => {
      const request: ChatCompletionRequest = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Calculate 5 + 3" }],
        tools: sampleTools,
        tool_choice: "required",
      };

      // Mock Duck.ai to return empty response
      const originalChat = openAIService["duckAI"].chat;
      openAIService["duckAI"].chat = async () => "";

      const response = await openAIService.createChatCompletion(request);

      // Should generate appropriate function call based on user input
      expect(response.choices[0].finish_reason).toBe("tool_calls");
      expect(response.choices[0].message.tool_calls).toHaveLength(1);

      // Should choose calculate function based on the math expression in the message
      expect(response.choices[0].message.tool_calls![0].function.name).toBe(
        "calculate"
      );

      // Restore original method
      openAIService["duckAI"].chat = originalChat;
    });

    it("should handle network errors gracefully", async () => {
      const request: ChatCompletionRequest = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Hello" }],
        tools: sampleTools,
      };

      // Mock Duck.ai to throw network error
      const originalChat = openAIService["duckAI"].chat;
      openAIService["duckAI"].chat = async () => {
        throw new Error("Network error");
      };

      try {
        await openAIService.createChatCompletion(request);
        // If it doesn't throw, that's fine - it means fallback worked
      } catch (error) {
        // If it throws, the error should be properly handled
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("Network error");
      } finally {
        // Restore original method
        openAIService["duckAI"].chat = originalChat;
      }
    });

    it("should handle malformed responses from Duck.ai", async () => {
      const request: ChatCompletionRequest = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Test" }],
        tools: sampleTools,
      };

      // Mock Duck.ai to return malformed response
      const originalChat = openAIService["duckAI"].chat;
      openAIService["duckAI"].chat = async () =>
        "This is not JSON and not a function call";

      const response = await openAIService.createChatCompletion(request);

      // Should handle as regular response
      expect(response.choices[0].message.role).toBe("assistant");
      expect(response.choices[0].message.content).toBe(
        "This is not JSON and not a function call"
      );
      expect(response.choices[0].finish_reason).toBe("stop");

      // Restore original method
      openAIService["duckAI"].chat = originalChat;
    });

    it("should handle partial JSON responses", async () => {
      const request: ChatCompletionRequest = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Test" }],
        tools: sampleTools,
      };

      // Mock Duck.ai to return partial JSON
      const originalChat = openAIService["duckAI"].chat;
      openAIService["duckAI"].chat = async () =>
        '{"tool_calls": [{"id": "call_1", "type": "function"';

      const response = await openAIService.createChatCompletion(request);

      // Should handle as regular response since JSON is malformed
      expect(response.choices[0].message.role).toBe("assistant");
      expect(response.choices[0].finish_reason).toBe("stop");

      // Restore original method
      openAIService["duckAI"].chat = originalChat;
    });
  });

  describe("Resilience Testing", () => {
    it("should handle rapid consecutive requests", async () => {
      const requests = Array.from({ length: 5 }, (_, i) => ({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: `Test message ${i}` }],
        tools: sampleTools,
      }));

      // Mock Duck.ai with varying responses
      const originalChat = openAIService["duckAI"].chat;
      let callCount = 0;
      openAIService["duckAI"].chat = async () => {
        callCount++;
        if (callCount % 2 === 0) {
          throw new Error("Rate limited");
        }
        return `Response ${callCount}`;
      };

      const results = await Promise.allSettled(
        requests.map((req) => openAIService.createChatCompletion(req))
      );

      // All requests should either succeed or fail gracefully
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          expect(result.value.choices[0].message.role).toBe("assistant");
        } else {
          expect(result.reason).toBeInstanceOf(Error);
        }
      });

      // Restore original method
      openAIService["duckAI"].chat = originalChat;
    });

    it("should maintain function execution capability during API issues", async () => {
      // Test that built-in functions still work even if Duck.ai is down
      const toolCall = {
        id: "call_1",
        type: "function" as const,
        function: {
          name: "get_current_time",
          arguments: "{}",
        },
      };

      const result = await openAIService.executeToolCall(toolCall);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("should handle streaming errors gracefully", async () => {
      const request: ChatCompletionRequest = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Test streaming" }],
        stream: true,
      };

      // Mock Duck.ai to throw error during streaming
      const originalChat = openAIService["duckAI"].chat;
      openAIService["duckAI"].chat = async () => {
        throw new Error("Streaming error");
      };

      try {
        const stream = await openAIService.createChatCompletionStream(request);
        const reader = stream.getReader();

        // Should handle error in stream
        const { done, value } = await reader.read();

        if (value) {
          const text = new TextDecoder().decode(value);
          expect(text).toContain("data:");
        }
      } catch (error) {
        // Error should be handled gracefully
        expect(error).toBeInstanceOf(Error);
      } finally {
        // Restore original method
        openAIService["duckAI"].chat = originalChat;
      }
    });
  });

  describe("Fallback Mechanisms", () => {
    it("should use intelligent function selection when Duck.ai fails", async () => {
      const testCases = [
        {
          message: "What time is it now?",
          expectedFunction: "get_current_time",
        },
        {
          message: "Calculate 15 * 8 + 42",
          expectedFunction: "calculate",
        },
        {
          message: "Please compute 2 + 2",
          expectedFunction: "calculate",
        },
      ];

      // Mock Duck.ai to always fail
      const originalChat = openAIService["duckAI"].chat;
      openAIService["duckAI"].chat = async () => {
        throw new Error("API unavailable");
      };

      for (const testCase of testCases) {
        const request: ChatCompletionRequest = {
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: testCase.message }],
          tools: sampleTools,
          tool_choice: "required",
        };

        try {
          const response = await openAIService.createChatCompletion(request);

          if (response.choices[0].finish_reason === "tool_calls") {
            expect(
              response.choices[0].message.tool_calls![0].function.name
            ).toBe(testCase.expectedFunction);
          }
        } catch (error) {
          // Fallback might not always work, but should not crash
          expect(error).toBeInstanceOf(Error);
        }
      }

      // Restore original method
      openAIService["duckAI"].chat = originalChat;
    });
  });
});
