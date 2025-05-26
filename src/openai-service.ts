import { DuckAI } from "./duckai";
import { ToolService } from "./tool-service";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionStreamResponse,
  ChatCompletionMessage,
  ModelsResponse,
  Model,
  DuckAIRequest,
  ToolDefinition,
  ToolCall,
} from "./types";

export class OpenAIService {
  private duckAI: DuckAI;
  private toolService: ToolService;
  private availableFunctions: Record<string, Function>;

  constructor() {
    this.duckAI = new DuckAI();
    this.toolService = new ToolService();
    this.availableFunctions = this.initializeBuiltInFunctions();
  }

  private initializeBuiltInFunctions(): Record<string, Function> {
    return {
      // Example built-in functions - users can extend this
      get_current_time: () => new Date().toISOString(),
      calculate: (args: { expression: string }) => {
        try {
          // Simple calculator - in production, use a proper math parser
          const result = Function(
            `"use strict"; return (${args.expression})`
          )();
          return { result };
        } catch (error) {
          return { error: "Invalid expression" };
        }
      },
      get_weather: (args: { location: string }) => {
        // Mock weather function
        return {
          location: args.location,
          temperature: Math.floor(Math.random() * 30) + 10,
          condition: ["sunny", "cloudy", "rainy"][
            Math.floor(Math.random() * 3)
          ],
          note: "This is a mock weather function for demonstration",
        };
      },
    };
  }

  registerFunction(name: string, func: Function): void {
    this.availableFunctions[name] = func;
  }

  private generateId(): string {
    return `chatcmpl-${Math.random().toString(36).substring(2, 15)}`;
  }

  private getCurrentTimestamp(): number {
    return Math.floor(Date.now() / 1000);
  }

  private estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  private transformToDuckAIRequest(
    request: ChatCompletionRequest
  ): DuckAIRequest {
    // Use the model from request, fallback to default
    const model = request.model || "mistralai/Mistral-Small-24B-Instruct-2501";

    return {
      model,
      messages: request.messages,
    };
  }

  async createChatCompletion(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    // Check if this request involves function calling
    if (
      this.toolService.shouldUseFunctionCalling(
        request.tools,
        request.tool_choice
      )
    ) {
      return this.createChatCompletionWithTools(request);
    }

    const duckAIRequest = this.transformToDuckAIRequest(request);
    const response = await this.duckAI.chat(duckAIRequest);

    const id = this.generateId();
    const created = this.getCurrentTimestamp();

    // Calculate token usage
    const promptText = request.messages.map((m) => m.content || "").join(" ");
    const promptTokens = this.estimateTokens(promptText);
    const completionTokens = this.estimateTokens(response);

    return {
      id,
      object: "chat.completion",
      created,
      model: request.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: response,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };
  }

  private async createChatCompletionWithTools(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    const id = this.generateId();
    const created = this.getCurrentTimestamp();

    // Validate tools
    if (request.tools) {
      const validation = this.toolService.validateTools(request.tools);
      if (!validation.valid) {
        throw new Error(`Invalid tools: ${validation.errors.join(", ")}`);
      }
    }

    // Create a modified request with tool instructions
    const modifiedMessages = [...request.messages];

    // Add tool instructions as user message (DuckAI doesn't support system messages)
    if (request.tools && request.tools.length > 0) {
      const toolPrompt = this.toolService.generateToolSystemPrompt(
        request.tools,
        request.tool_choice
      );
      modifiedMessages.unshift({
        role: "user",
        content: `[SYSTEM INSTRUCTIONS] ${toolPrompt}

Please follow these instructions when responding to the following user message.`,
      });
    }

    const duckAIRequest = this.transformToDuckAIRequest({
      ...request,
      messages: modifiedMessages,
    });

    const response = await this.duckAI.chat(duckAIRequest);

    // Check if the response contains function calls
    if (this.toolService.detectFunctionCalls(response)) {
      const toolCalls = this.toolService.extractFunctionCalls(response);

      if (toolCalls.length > 0) {
        // Calculate token usage
        const promptText = modifiedMessages
          .map((m) => m.content || "")
          .join(" ");
        const promptTokens = this.estimateTokens(promptText);
        const completionTokens = this.estimateTokens(response);

        return {
          id,
          object: "chat.completion",
          created,
          model: request.model,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: toolCalls,
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
          },
        };
      }
    }

    // No function calls detected
    // If tool_choice is "required" or specific function, we need to force a function call
    if (
      (request.tool_choice === "required" ||
        (typeof request.tool_choice === "object" &&
          request.tool_choice.type === "function")) &&
      request.tools &&
      request.tools.length > 0
    ) {
      // Get user message for argument extraction
      const userMessage = request.messages[request.messages.length - 1];
      const userContent = userMessage.content || "";

      // Determine which function to call
      let functionToCall: string;

      // If specific function is requested, use that
      if (
        typeof request.tool_choice === "object" &&
        request.tool_choice.type === "function"
      ) {
        functionToCall = request.tool_choice.function.name;
      } else {
        // Try to infer which function to call based on the user's request
        // Simple heuristics to choose appropriate function
        functionToCall = request.tools[0].function.name; // Default to first function

        if (userContent.toLowerCase().includes("time")) {
          const timeFunction = request.tools.find(
            (t) => t.function.name === "get_current_time"
          );
          if (timeFunction) functionToCall = timeFunction.function.name;
        } else if (
          userContent.toLowerCase().includes("calculate") ||
          /\d+\s*[+\-*/]\s*\d+/.test(userContent)
        ) {
          const calcFunction = request.tools.find(
            (t) => t.function.name === "calculate"
          );
          if (calcFunction) functionToCall = calcFunction.function.name;
        } else if (userContent.toLowerCase().includes("weather")) {
          const weatherFunction = request.tools.find(
            (t) => t.function.name === "get_weather"
          );
          if (weatherFunction) functionToCall = weatherFunction.function.name;
        }
      }

      // Generate appropriate arguments based on function
      let args = "{}";
      if (functionToCall === "calculate") {
        const mathMatch = userContent.match(/(\d+\s*[+\-*/]\s*\d+)/);
        if (mathMatch) {
          args = JSON.stringify({ expression: mathMatch[1] });
        }
      } else if (functionToCall === "get_weather") {
        // Try to extract location from user message
        const locationMatch = userContent.match(
          /(?:in|for|at)\s+([A-Za-z\s,]+)/i
        );
        if (locationMatch) {
          args = JSON.stringify({ location: locationMatch[1].trim() });
        }
      }

      const forcedToolCall: ToolCall = {
        id: `call_${Date.now()}`,
        type: "function",
        function: {
          name: functionToCall,
          arguments: args,
        },
      };

      const promptText = modifiedMessages.map((m) => m.content || "").join(" ");
      const promptTokens = this.estimateTokens(promptText);
      const completionTokens = this.estimateTokens(
        JSON.stringify(forcedToolCall)
      );

      return {
        id,
        object: "chat.completion",
        created,
        model: request.model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [forcedToolCall],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      };
    }

    // No function calls detected, return normal response
    const promptText = modifiedMessages.map((m) => m.content || "").join(" ");
    const promptTokens = this.estimateTokens(promptText);
    const completionTokens = this.estimateTokens(response);

    return {
      id,
      object: "chat.completion",
      created,
      model: request.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: response,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };
  }

  async createChatCompletionStream(
    request: ChatCompletionRequest
  ): Promise<ReadableStream<Uint8Array>> {
    // Check if this request involves function calling
    if (
      this.toolService.shouldUseFunctionCalling(
        request.tools,
        request.tool_choice
      )
    ) {
      return this.createChatCompletionStreamWithTools(request);
    }

    const duckAIRequest = this.transformToDuckAIRequest(request);
    const duckStream = await this.duckAI.chatStream(duckAIRequest);

    const id = this.generateId();
    const created = this.getCurrentTimestamp();

    return new ReadableStream({
      start(controller) {
        const reader = duckStream.getReader();
        let isFirst = true;

        function pump(): Promise<void> {
          return reader.read().then(({ done, value }) => {
            if (done) {
              // Send final chunk
              const finalChunk: ChatCompletionStreamResponse = {
                id,
                object: "chat.completion.chunk",
                created,
                model: request.model,
                choices: [
                  {
                    index: 0,
                    delta: {},
                    finish_reason: "stop",
                  },
                ],
              };

              const finalData = `data: ${JSON.stringify(finalChunk)}\n\n`;
              const finalDone = `data: [DONE]\n\n`;

              controller.enqueue(new TextEncoder().encode(finalData));
              controller.enqueue(new TextEncoder().encode(finalDone));
              controller.close();
              return;
            }

            const chunk: ChatCompletionStreamResponse = {
              id,
              object: "chat.completion.chunk",
              created,
              model: request.model,
              choices: [
                {
                  index: 0,
                  delta: isFirst
                    ? { role: "assistant", content: value }
                    : { content: value },
                  finish_reason: null,
                },
              ],
            };

            isFirst = false;
            const data = `data: ${JSON.stringify(chunk)}\n\n`;
            controller.enqueue(new TextEncoder().encode(data));

            return pump();
          });
        }

        return pump();
      },
    });
  }

  private async createChatCompletionStreamWithTools(
    request: ChatCompletionRequest
  ): Promise<ReadableStream<Uint8Array>> {
    // For tools, we need to collect the full response first to parse function calls
    // This is a limitation of the "trick" approach - streaming with tools is complex
    const completion = await this.createChatCompletionWithTools(request);

    const id = completion.id;
    const created = completion.created;

    return new ReadableStream({
      start(controller) {
        const choice = completion.choices[0];

        if (choice.message.tool_calls) {
          // Stream tool calls
          const toolCallsChunk: ChatCompletionStreamResponse = {
            id,
            object: "chat.completion.chunk",
            created,
            model: request.model,
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  tool_calls: choice.message.tool_calls,
                },
                finish_reason: null,
              },
            ],
          };

          const toolCallsData = `data: ${JSON.stringify(toolCallsChunk)}\n\n`;
          controller.enqueue(new TextEncoder().encode(toolCallsData));

          // Send final chunk
          const finalChunk: ChatCompletionStreamResponse = {
            id,
            object: "chat.completion.chunk",
            created,
            model: request.model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: "tool_calls",
              },
            ],
          };

          const finalData = `data: ${JSON.stringify(finalChunk)}\n\n`;
          const finalDone = `data: [DONE]\n\n`;

          controller.enqueue(new TextEncoder().encode(finalData));
          controller.enqueue(new TextEncoder().encode(finalDone));
        } else {
          // Stream regular content
          const content = choice.message.content || "";

          // Send role first
          const roleChunk: ChatCompletionStreamResponse = {
            id,
            object: "chat.completion.chunk",
            created,
            model: request.model,
            choices: [
              {
                index: 0,
                delta: { role: "assistant" },
                finish_reason: null,
              },
            ],
          };

          const roleData = `data: ${JSON.stringify(roleChunk)}\n\n`;
          controller.enqueue(new TextEncoder().encode(roleData));

          // Stream content in chunks
          const chunkSize = 10;
          for (let i = 0; i < content.length; i += chunkSize) {
            const contentChunk = content.slice(i, i + chunkSize);

            const chunk: ChatCompletionStreamResponse = {
              id,
              object: "chat.completion.chunk",
              created,
              model: request.model,
              choices: [
                {
                  index: 0,
                  delta: { content: contentChunk },
                  finish_reason: null,
                },
              ],
            };

            const data = `data: ${JSON.stringify(chunk)}\n\n`;
            controller.enqueue(new TextEncoder().encode(data));
          }

          // Send final chunk
          const finalChunk: ChatCompletionStreamResponse = {
            id,
            object: "chat.completion.chunk",
            created,
            model: request.model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: "stop",
              },
            ],
          };

          const finalData = `data: ${JSON.stringify(finalChunk)}\n\n`;
          const finalDone = `data: [DONE]\n\n`;

          controller.enqueue(new TextEncoder().encode(finalData));
          controller.enqueue(new TextEncoder().encode(finalDone));
        }

        controller.close();
      },
    });
  }

  getModels(): ModelsResponse {
    const models = this.duckAI.getAvailableModels();
    const created = this.getCurrentTimestamp();

    const modelData: Model[] = models.map((modelId) => ({
      id: modelId,
      object: "model",
      created,
      owned_by: "duckai",
    }));

    return {
      object: "list",
      data: modelData,
    };
  }

  validateRequest(request: any): ChatCompletionRequest {
    if (!request.messages || !Array.isArray(request.messages)) {
      throw new Error("messages field is required and must be an array");
    }

    if (request.messages.length === 0) {
      throw new Error("messages array cannot be empty");
    }

    for (const message of request.messages) {
      if (
        !message.role ||
        !["system", "user", "assistant", "tool"].includes(message.role)
      ) {
        throw new Error(
          "Each message must have a valid role (system, user, assistant, or tool)"
        );
      }

      // Tool messages have different validation rules
      if (message.role === "tool") {
        if (!message.tool_call_id) {
          throw new Error("Tool messages must have a tool_call_id");
        }
        if (typeof message.content !== "string") {
          throw new Error("Tool messages must have content as a string");
        }
      } else {
        // For non-tool messages, content can be null if there are tool_calls
        if (
          message.content === undefined ||
          (message.content !== null && typeof message.content !== "string")
        ) {
          throw new Error("Each message must have content as a string or null");
        }
      }
    }

    // Validate tools if provided
    if (request.tools) {
      const validation = this.toolService.validateTools(request.tools);
      if (!validation.valid) {
        throw new Error(`Invalid tools: ${validation.errors.join(", ")}`);
      }
    }

    return {
      model: request.model || "mistralai/Mistral-Small-24B-Instruct-2501",
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: request.max_tokens,
      stream: request.stream || false,
      top_p: request.top_p,
      frequency_penalty: request.frequency_penalty,
      presence_penalty: request.presence_penalty,
      stop: request.stop,
      tools: request.tools,
      tool_choice: request.tool_choice,
    };
  }

  async executeToolCall(toolCall: ToolCall): Promise<string> {
    return this.toolService.executeFunctionCall(
      toolCall,
      this.availableFunctions
    );
  }

  /**
   * Get current rate limit status from DuckAI
   */
  getRateLimitStatus() {
    return this.duckAI.getRateLimitStatus();
  }
}
