#!/usr/bin/env bun

console.log("Starting demo script...");

import { OpenAIService } from "./src/openai-service";

console.log("OpenAI service imported successfully");

const openAIService = new OpenAIService();

console.log("OpenAI service initialized");

// Demo function calling scenarios
async function demoFunctionCalling() {
  console.log("🚀 DuckAI Function Calling Demo\n");

  // Scenario 1: Time function with tool_choice required
  console.log("📅 Scenario 1: Getting current time (tool_choice: required)");
  try {
    const timeRequest = {
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
      tool_choice: "required" as const,
    };

    const timeResponse = await openAIService.createChatCompletion(timeRequest);
    console.log("Response:", JSON.stringify(timeResponse, null, 2));

    // Execute the tool call if present
    if (timeResponse.choices[0].message.tool_calls) {
      const toolCall = timeResponse.choices[0].message.tool_calls[0];
      const result = await openAIService.executeToolCall(toolCall);
      console.log("Tool execution result:", result);
    }
  } catch (error) {
    console.error("Error:", error);
  }

  console.log("\n" + "=".repeat(60) + "\n");

  // Scenario 2: Calculator function
  console.log("🧮 Scenario 2: Mathematical calculation");
  try {
    const calcRequest = {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Calculate 25 * 4 + 10" }],
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
      tool_choice: "required" as const,
    };

    const calcResponse = await openAIService.createChatCompletion(calcRequest);
    console.log("Response:", JSON.stringify(calcResponse, null, 2));

    // Execute the tool call if present
    if (calcResponse.choices[0].message.tool_calls) {
      const toolCall = calcResponse.choices[0].message.tool_calls[0];
      const result = await openAIService.executeToolCall(toolCall);
      console.log("Tool execution result:", result);
    }
  } catch (error) {
    console.error("Error:", error);
  }

  console.log("\n✅ Demo completed!");
}

// Run the demo
console.log("About to run demo...");
demoFunctionCalling().catch(console.error);
