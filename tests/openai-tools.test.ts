import { describe, it, expect, beforeEach } from "bun:test";
import { OpenAIService } from "../src/openai-service";
import type {
  ChatCompletionRequest,
  ToolDefinition,
  ToolCall,
} from "../src/types";

describe("OpenAIService with Tools", () => {
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
  ];

  describe("validateRequest with tools", () => {
    it("should validate requests with valid tools", () => {
      const request = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "What's the weather like?" }],
        tools: sampleTools,
      };

      const validated = openAIService.validateRequest(request);
      expect(validated.tools).toEqual(sampleTools);
    });

    it("should reject requests with invalid tools", () => {
      const request = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Hello" }],
        tools: [
          {
            type: "invalid",
            function: { name: "test" },
          },
        ],
      };

      expect(() => openAIService.validateRequest(request)).toThrow(
        "Invalid tools"
      );
    });

    it("should validate tool messages", () => {
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
        ],
      };

      const validated = openAIService.validateRequest(request);
      expect(validated.messages).toHaveLength(3);
    });

    it("should reject tool messages without tool_call_id", () => {
      const request = {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "tool",
            content: "Some result",
          },
        ],
      };

      expect(() => openAIService.validateRequest(request)).toThrow(
        "Tool messages must have a tool_call_id"
      );
    });
  });

  describe("registerFunction", () => {
    it("should allow registering custom functions", () => {
      const customFunction = (args: { name: string }) => `Hello, ${args.name}!`;
      openAIService.registerFunction("greet", customFunction);

      // The function should now be available for execution
      expect(openAIService["availableFunctions"]["greet"]).toBe(customFunction);
    });
  });

  describe("executeToolCall", () => {
    it("should execute built-in functions", async () => {
      const toolCall = {
        id: "call_1",
        type: "function" as const,
        function: {
          name: "get_current_time",
          arguments: "{}",
        },
      };

      const result = await openAIService.executeToolCall(toolCall);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO date format
    });

    it("should execute calculate function", async () => {
      const toolCall = {
        id: "call_1",
        type: "function" as const,
        function: {
          name: "calculate",
          arguments: '{"expression": "2 + 2"}',
        },
      };

      const result = await openAIService.executeToolCall(toolCall);
      const parsed = JSON.parse(result);
      expect(parsed.result).toBe(4);
    });

    it("should execute weather function", async () => {
      const toolCall = {
        id: "call_1",
        type: "function" as const,
        function: {
          name: "get_weather",
          arguments: '{"location": "New York"}',
        },
      };

      const result = await openAIService.executeToolCall(toolCall);
      const parsed = JSON.parse(result);
      expect(parsed.location).toBe("New York");
      expect(parsed.temperature).toBeTypeOf("number");
      expect(parsed.condition).toBeTypeOf("string");
    });

    it("should handle function execution errors", async () => {
      const toolCall = {
        id: "call_1",
        type: "function" as const,
        function: {
          name: "calculate",
          arguments: '{"expression": "invalid expression"}',
        },
      };

      const result = await openAIService.executeToolCall(toolCall);
      const parsed = JSON.parse(result);
      expect(parsed.error).toBeDefined();
    });
  });

  describe("createChatCompletion with tools", () => {
    it("should handle requests without tools normally", async () => {
      const request: ChatCompletionRequest = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Hello, how are you?" }],
      };

      // Mock the DuckAI response
      const originalChat = openAIService["duckAI"].chat;
      openAIService["duckAI"].chat = async () => "I'm doing well, thank you!";

      const response = await openAIService.createChatCompletion(request);

      expect(response.choices[0].message.role).toBe("assistant");
      expect(response.choices[0].message.content).toBe(
        "I'm doing well, thank you!"
      );
      expect(response.choices[0].finish_reason).toBe("stop");

      // Restore original method
      openAIService["duckAI"].chat = originalChat;
    });

    it("should detect and extract function calls from AI response", async () => {
      const request: ChatCompletionRequest = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "What time is it?" }],
        tools: [sampleTools[0]], // get_current_time
      };

      // Mock the DuckAI response to return a function call
      const originalChat = openAIService["duckAI"].chat;
      openAIService["duckAI"].chat = async () =>
        JSON.stringify({
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
        });

      const response = await openAIService.createChatCompletion(request);

      expect(response.choices[0].message.role).toBe("assistant");
      expect(response.choices[0].message.content).toBe(null);
      expect(response.choices[0].message.tool_calls).toHaveLength(1);
      expect(response.choices[0].message.tool_calls![0].function.name).toBe(
        "get_current_time"
      );
      expect(response.choices[0].finish_reason).toBe("tool_calls");

      // Restore original method
      openAIService["duckAI"].chat = originalChat;
    });

    it("should handle tool_choice 'required'", async () => {
      const request: ChatCompletionRequest = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Calculate 5 + 3" }],
        tools: [sampleTools[1]], // calculate
        tool_choice: "required",
      };

      // Mock the DuckAI response
      const originalChat = openAIService["duckAI"].chat;
      openAIService["duckAI"].chat = async (req) => {
        // Verify that the system prompt contains the required instruction
        const systemMessage = req.messages.find((m) => m.role === "system");
        expect(systemMessage?.content).toContain(
          "You MUST call at least one function"
        );

        return JSON.stringify({
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "calculate",
                arguments: '{"expression": "5 + 3"}',
              },
            },
          ],
        });
      };

      const response = await openAIService.createChatCompletion(request);
      expect(response.choices[0].finish_reason).toBe("tool_calls");

      // Restore original method
      openAIService["duckAI"].chat = originalChat;
    });

    it("should handle tool_choice 'none'", async () => {
      const request: ChatCompletionRequest = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Hello" }],
        tools: sampleTools,
        tool_choice: "none",
      };

      // Mock the DuckAI response
      const originalChat = openAIService["duckAI"].chat;
      openAIService["duckAI"].chat = async () =>
        "Hello! How can I help you today?";

      const response = await openAIService.createChatCompletion(request);

      expect(response.choices[0].message.content).toBe(
        "Hello! How can I help you today?"
      );
      expect(response.choices[0].finish_reason).toBe("stop");

      // Restore original method
      openAIService["duckAI"].chat = originalChat;
    });
  });

  describe("createChatCompletionStream with tools", () => {
    it("should handle streaming with function calls", async () => {
      const request: ChatCompletionRequest = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "What time is it?" }],
        tools: sampleTools,
        stream: true,
      };

      // Mock the DuckAI response to include function calls
      const originalChat = openAIService["duckAI"].chat;
      openAIService["duckAI"].chat = async () =>
        JSON.stringify({
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
        });

      const stream = await openAIService.createChatCompletionStream(request);
      const chunks: string[] = [];

      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value) {
          const text = new TextDecoder().decode(value);
          chunks.push(text);
        }
      }

      const fullResponse = chunks.join("");
      expect(fullResponse).toContain("data:");
      expect(fullResponse).toContain("[DONE]");

      // Restore original method
      openAIService["duckAI"].chat = originalChat;
    });

    it("should handle streaming without tools", async () => {
      const request: ChatCompletionRequest = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Hello!" }],
        stream: true,
      };

      // Mock the DuckAI response
      const originalChat = openAIService["duckAI"].chat;
      openAIService["duckAI"].chat = async () => "Hello! How can I help you?";

      const stream = await openAIService.createChatCompletionStream(request);
      const chunks: string[] = [];

      const reader = stream.getReader();
      let chunkCount = 0;
      while (true && chunkCount < 10) {
        // Limit chunks to prevent infinite loop
        const { done, value } = await reader.read();
        if (done) break;

        if (value) {
          const text = new TextDecoder().decode(value);
          chunks.push(text);
        }
        chunkCount++;
      }

      const fullResponse = chunks.join("");
      expect(fullResponse).toContain("data:");

      // Restore original method
      openAIService["duckAI"].chat = originalChat;
    });
  });

  describe("Advanced Tool Scenarios", () => {
    it("should handle tool_choice with specific function", async () => {
      const request: ChatCompletionRequest = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Calculate something" }],
        tools: sampleTools,
        tool_choice: {
          type: "function",
          function: { name: "calculate" },
        },
      };

      // Mock the DuckAI response
      const originalChat = openAIService["duckAI"].chat;
      openAIService["duckAI"].chat = async () => "I'll calculate that for you.";

      const response = await openAIService.createChatCompletion(request);

      // Should force the specific function call
      expect(response.choices[0].finish_reason).toBe("tool_calls");
      expect(response.choices[0].message.tool_calls).toHaveLength(1);
      expect(response.choices[0].message.tool_calls![0].function.name).toBe(
        "calculate"
      );

      // Restore original method
      openAIService["duckAI"].chat = originalChat;
    });

    it("should handle empty response from Duck.ai gracefully", async () => {
      const request: ChatCompletionRequest = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Test" }],
        tools: sampleTools,
        tool_choice: "required",
      };

      // Mock empty response
      const originalChat = openAIService["duckAI"].chat;
      openAIService["duckAI"].chat = async () => "";

      const response = await openAIService.createChatCompletion(request);

      // Should still generate a function call due to tool_choice: required
      expect(response.choices[0].finish_reason).toBe("tool_calls");
      expect(response.choices[0].message.tool_calls).toHaveLength(1);

      // Restore original method
      openAIService["duckAI"].chat = originalChat;
    });

    it("should handle conversation with multiple tool calls", async () => {
      const request: ChatCompletionRequest = {
        model: "gpt-4o-mini",
        messages: [
          { role: "user", content: "What time is it and what's 2+2?" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "get_current_time", arguments: "{}" },
              },
            ],
          },
          {
            role: "tool",
            content: "2024-01-15T10:30:00Z",
            tool_call_id: "call_1",
          },
        ],
        tools: sampleTools,
      };

      // Mock the DuckAI response
      const originalChat = openAIService["duckAI"].chat;
      openAIService["duckAI"].chat = async () =>
        "The time is 2024-01-15T10:30:00Z. Now let me calculate 2+2.";

      const response = await openAIService.createChatCompletion(request);

      expect(response.choices[0].message.role).toBe("assistant");
      expect(response.choices[0].message.content).toContain(
        "2024-01-15T10:30:00Z"
      );

      // Restore original method
      openAIService["duckAI"].chat = originalChat;
    });

    it("should handle custom registered functions", async () => {
      // Register a custom function
      const customFunction = (args: { name: string }) => `Hello, ${args.name}!`;
      openAIService.registerFunction("greet", customFunction);

      const toolCall: ToolCall = {
        id: "call_1",
        type: "function",
        function: {
          name: "greet",
          arguments: '{"name": "Alice"}',
        },
      };

      const result = await openAIService.executeToolCall(toolCall);
      expect(result).toBe("Hello, Alice!");
    });

    it("should handle tool validation edge cases", () => {
      // Test with empty tools array
      expect(() => {
        openAIService.validateRequest({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "test" }],
          tools: [],
        });
      }).not.toThrow();

      // Test with null tools
      expect(() => {
        openAIService.validateRequest({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "test" }],
          tools: null,
        });
      }).not.toThrow();
    });

    it("should handle malformed tool_calls in assistant messages", () => {
      const request = {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                // Missing required fields
                type: "function",
              },
            ],
          },
        ],
      };

      // Should not throw during validation - malformed tool_calls are handled during execution
      expect(() => openAIService.validateRequest(request)).not.toThrow();
    });

    it("should handle concurrent tool executions", async () => {
      const slowFunction = async (args: any) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return `Slow result: ${args.input}`;
      };

      openAIService.registerFunction("slow_func", slowFunction);

      const toolCalls = [
        {
          id: "call_1",
          type: "function" as const,
          function: { name: "slow_func", arguments: '{"input": "test1"}' },
        },
        {
          id: "call_2",
          type: "function" as const,
          function: { name: "slow_func", arguments: '{"input": "test2"}' },
        },
      ];

      const results = await Promise.all(
        toolCalls.map((call) => openAIService.executeToolCall(call))
      );

      expect(results).toHaveLength(2);
      expect(results[0]).toBe("Slow result: test1");
      expect(results[1]).toBe("Slow result: test2");
    });

    // Additional advanced scenarios
    it("should handle tool_choice with non-existent function gracefully", async () => {
      const request: ChatCompletionRequest = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Test" }],
        tools: sampleTools,
        tool_choice: {
          type: "function",
          function: { name: "non_existent_function" },
        },
      };

      // Mock the DuckAI response
      const originalChat = openAIService["duckAI"].chat;
      openAIService["duckAI"].chat = async () => "I'll help you with that.";

      const response = await openAIService.createChatCompletion(request);

      // Should still force the non-existent function call (validation happens at execution time)
      expect(response.choices[0].finish_reason).toBe("tool_calls");
      expect(response.choices[0].message.tool_calls).toHaveLength(1);
      expect(response.choices[0].message.tool_calls![0].function.name).toBe(
        "non_existent_function"
      );

      // Restore original method
      openAIService["duckAI"].chat = originalChat;
    });

    it("should handle complex tool arguments extraction", async () => {
      const request: ChatCompletionRequest = {
        model: "gpt-4o-mini",
        messages: [
          { role: "user", content: "Calculate the result of 15 * 8 + 42" },
        ],
        tools: [sampleTools[1]], // calculate function
        tool_choice: "required",
      };

      // Mock empty response to trigger fallback
      const originalChat = openAIService["duckAI"].chat;
      openAIService["duckAI"].chat = async () => "";

      const response = await openAIService.createChatCompletion(request);

      expect(response.choices[0].finish_reason).toBe("tool_calls");
      expect(response.choices[0].message.tool_calls).toHaveLength(1);
      expect(response.choices[0].message.tool_calls![0].function.name).toBe(
        "calculate"
      );

      // Should extract the math expression
      const args = JSON.parse(
        response.choices[0].message.tool_calls![0].function.arguments
      );
      expect(args.expression).toBe("15 * 8");

      // Restore original method
      openAIService["duckAI"].chat = originalChat;
    });

    it("should handle weather function with location extraction", async () => {
      const request: ChatCompletionRequest = {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: "What's the weather like in San Francisco?",
          },
        ],
        tools: [sampleTools[2]], // weather function
        tool_choice: "required",
      };

      // Mock empty response to trigger fallback
      const originalChat = openAIService["duckAI"].chat;
      openAIService["duckAI"].chat = async () => "";

      const response = await openAIService.createChatCompletion(request);

      expect(response.choices[0].finish_reason).toBe("tool_calls");
      expect(response.choices[0].message.tool_calls).toHaveLength(1);
      expect(response.choices[0].message.tool_calls![0].function.name).toBe(
        "get_weather"
      );

      // Should extract the location
      const args = JSON.parse(
        response.choices[0].message.tool_calls![0].function.arguments
      );
      expect(args.location).toBe("San Francisco");

      // Restore original method
      openAIService["duckAI"].chat = originalChat;
    });

    it("should handle mixed content with function calls", async () => {
      const request: ChatCompletionRequest = {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Hello! What time is it?" }],
        tools: sampleTools,
      };

      // Mock response with mixed content and function call
      const originalChat = openAIService["duckAI"].chat;
      openAIService["duckAI"].chat = async () =>
        JSON.stringify({
          message: "Hello! Let me check the time for you.",
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
        });

      const response = await openAIService.createChatCompletion(request);

      expect(response.choices[0].finish_reason).toBe("tool_calls");
      expect(response.choices[0].message.tool_calls).toHaveLength(1);
      expect(response.choices[0].message.tool_calls![0].function.name).toBe(
        "get_current_time"
      );

      // Restore original method
      openAIService["duckAI"].chat = originalChat;
    });

    it("should handle function execution with complex return types", async () => {
      // Register a function that returns various data types
      const complexReturnFunction = (args: { type: string }) => {
        switch (args.type) {
          case "array":
            return [1, 2, 3, "four", { five: 5 }];
          case "object":
            return { nested: { data: "value" }, array: [1, 2, 3] };
          case "null":
            return null;
          case "boolean":
            return true;
          case "number":
            return 42.5;
          default:
            return "string result";
        }
      };

      openAIService.registerFunction("complex_return", complexReturnFunction);

      const testCases = [
        { type: "array", expected: [1, 2, 3, "four", { five: 5 }] },
        {
          type: "object",
          expected: { nested: { data: "value" }, array: [1, 2, 3] },
        },
        { type: "null", expected: null },
        { type: "boolean", expected: true },
        { type: "number", expected: 42.5 },
        { type: "string", expected: "string result" },
      ];

      for (const testCase of testCases) {
        const toolCall: ToolCall = {
          id: "call_1",
          type: "function",
          function: {
            name: "complex_return",
            arguments: JSON.stringify({ type: testCase.type }),
          },
        };

        const result = await openAIService.executeToolCall(toolCall);

        // Handle string results differently - they're returned as-is, not JSON-encoded
        if (testCase.type === "string") {
          expect(result).toBe(testCase.expected as string);
        } else {
          const parsed = JSON.parse(result);
          expect(parsed).toEqual(testCase.expected);
        }
      }
    });
  });
});
