import {
  ToolDefinition,
  ToolCall,
  ToolChoice,
  ChatCompletionMessage,
  FunctionDefinition,
} from "./types";

export class ToolService {
  /**
   * Generates a system prompt that instructs the AI how to use the provided tools
   */
  generateToolSystemPrompt(
    tools: ToolDefinition[],
    toolChoice: ToolChoice = "auto"
  ): string {
    const toolDescriptions = tools
      .map((tool) => {
        const func = tool.function;
        let description = `${func.name}`;

        if (func.description) {
          description += `: ${func.description}`;
        }

        if (func.parameters) {
          const params = func.parameters.properties || {};
          const required = func.parameters.required || [];

          const paramDescriptions = Object.entries(params)
            .map(([name, schema]: [string, any]) => {
              const isRequired = required.includes(name);
              const type = schema.type || "any";
              const desc = schema.description || "";
              return `  - ${name} (${type}${isRequired ? ", required" : ", optional"}): ${desc}`;
            })
            .join("\n");

          if (paramDescriptions) {
            description += `\nParameters:\n${paramDescriptions}`;
          }
        }

        return description;
      })
      .join("\n\n");

    let prompt = `You are an AI assistant with access to the following functions. When you need to call a function, respond with a JSON object in this exact format:

{
  "tool_calls": [
    {
      "id": "call_<unique_id>",
      "type": "function",
      "function": {
        "name": "<function_name>",
        "arguments": "<json_string_of_arguments>"
      }
    }
  ]
}

Available functions:
${toolDescriptions}

Important rules:
1. Only call functions when necessary to answer the user's question
2. Use the exact function names provided
3. Provide arguments as a JSON string
4. Generate unique IDs for each tool call (e.g., call_1, call_2, etc.)
5. If you don't need to call any functions, respond normally without the tool_calls format`;

    if (toolChoice === "required") {
      prompt +=
        "\n6. You MUST call at least one function to answer this request";
    } else if (toolChoice === "none") {
      prompt += "\n6. Do NOT call any functions, respond normally";
    } else if (
      typeof toolChoice === "object" &&
      toolChoice.type === "function"
    ) {
      prompt += `\n6. You MUST call the function "${toolChoice.function.name}"`;
    }

    return prompt;
  }

  /**
   * Detects if a response contains function calls
   */
  detectFunctionCalls(content: string): boolean {
    try {
      const parsed = JSON.parse(content.trim());
      return (
        parsed.tool_calls &&
        Array.isArray(parsed.tool_calls) &&
        parsed.tool_calls.length > 0
      );
    } catch {
      // Try to find tool_calls pattern in the text
      return /["']?tool_calls["']?\s*:\s*\[/.test(content);
    }
  }

  /**
   * Extracts function calls from AI response
   */
  extractFunctionCalls(content: string): ToolCall[] {
    try {
      // First try to parse as complete JSON
      const parsed = JSON.parse(content.trim());
      if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
        return parsed.tool_calls.map((call: any, index: number) => ({
          id: call.id || `call_${Date.now()}_${index}`,
          type: "function",
          function: {
            name: call.function.name,
            arguments:
              typeof call.function.arguments === "string"
                ? call.function.arguments
                : JSON.stringify(call.function.arguments),
          },
        }));
      }
    } catch {
      // Try to extract from partial or malformed JSON
      const toolCallsMatch = content.match(
        /["']?tool_calls["']?\s*:\s*\[(.*?)\]/s
      );
      if (toolCallsMatch) {
        try {
          const toolCallsStr = `[${toolCallsMatch[1]}]`;
          const toolCalls = JSON.parse(toolCallsStr);
          return toolCalls.map((call: any, index: number) => ({
            id: call.id || `call_${Date.now()}_${index}`,
            type: "function",
            function: {
              name: call.function.name,
              arguments:
                typeof call.function.arguments === "string"
                  ? call.function.arguments
                  : JSON.stringify(call.function.arguments),
            },
          }));
        } catch {
          // Fallback: try to extract individual function calls
          return this.extractFunctionCallsFromText(content);
        }
      }
    }

    return [];
  }

  /**
   * Fallback method to extract function calls from text
   */
  private extractFunctionCallsFromText(content: string): ToolCall[] {
    const calls: ToolCall[] = [];

    // Look for function call patterns
    const functionPattern =
      /["']?function["']?\s*:\s*\{[^}]*["']?name["']?\s*:\s*["']([^"']+)["'][^}]*["']?arguments["']?\s*:\s*["']([^"']*)["']/g;
    let match;
    let index = 0;

    while ((match = functionPattern.exec(content)) !== null) {
      calls.push({
        id: `call_${Date.now()}_${index}`,
        type: "function",
        function: {
          name: match[1],
          arguments: match[2],
        },
      });
      index++;
    }

    return calls;
  }

  /**
   * Executes a function call (mock implementation - in real use, this would call actual functions)
   */
  async executeFunctionCall(
    toolCall: ToolCall,
    availableFunctions: Record<string, Function>
  ): Promise<string> {
    const functionName = toolCall.function.name;
    const functionToCall = availableFunctions[functionName];

    if (!functionToCall) {
      return JSON.stringify({
        error: `Function '${functionName}' not found`,
        available_functions: Object.keys(availableFunctions),
      });
    }

    try {
      const args = JSON.parse(toolCall.function.arguments);
      const result = await functionToCall(args);
      return typeof result === "string" ? result : JSON.stringify(result);
    } catch (error) {
      return JSON.stringify({
        error: `Error executing function '${functionName}': ${error instanceof Error ? error.message : "Unknown error"}`,
        arguments_received: toolCall.function.arguments,
      });
    }
  }

  /**
   * Creates a tool result message
   */
  createToolResultMessage(
    toolCallId: string,
    result: string
  ): ChatCompletionMessage {
    return {
      role: "tool",
      content: result,
      tool_call_id: toolCallId,
    };
  }

  /**
   * Validates tool definitions
   */
  validateTools(tools: ToolDefinition[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!Array.isArray(tools)) {
      errors.push("Tools must be an array");
      return { valid: false, errors };
    }

    tools.forEach((tool, index) => {
      if (!tool.type || tool.type !== "function") {
        errors.push(`Tool at index ${index}: type must be "function"`);
      }

      if (!tool.function) {
        errors.push(`Tool at index ${index}: function definition is required`);
        return;
      }

      if (!tool.function.name || typeof tool.function.name !== "string") {
        errors.push(
          `Tool at index ${index}: function name is required and must be a string`
        );
      }

      if (tool.function.parameters) {
        if (tool.function.parameters.type !== "object") {
          errors.push(
            `Tool at index ${index}: function parameters type must be "object"`
          );
        }
      }
    });

    return { valid: errors.length === 0, errors };
  }

  /**
   * Checks if the request requires function calling
   */
  shouldUseFunctionCalling(
    tools?: ToolDefinition[],
    toolChoice?: ToolChoice
  ): boolean {
    if (!tools || tools.length === 0) {
      return false;
    }

    if (toolChoice === "none") {
      return false;
    }

    return true;
  }

  /**
   * Generates a unique ID for tool calls
   */
  generateToolCallId(): string {
    return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
