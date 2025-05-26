import { DuckAI } from "./duckai";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionStreamResponse,
  ChatCompletionMessage,
  ModelsResponse,
  Model,
  DuckAIRequest,
} from "./types";

export class OpenAIService {
  private duckAI: DuckAI;

  constructor() {
    this.duckAI = new DuckAI();
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
    const duckAIRequest = this.transformToDuckAIRequest(request);
    const response = await this.duckAI.chat(duckAIRequest);

    const id = this.generateId();
    const created = this.getCurrentTimestamp();

    // Calculate token usage
    const promptText = request.messages.map((m) => m.content).join(" ");
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
        !["system", "user", "assistant"].includes(message.role)
      ) {
        throw new Error(
          "Each message must have a valid role (system, user, or assistant)"
        );
      }
      if (!message.content || typeof message.content !== "string") {
        throw new Error("Each message must have content as a string");
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
    };
  }
}
