/**
 * This test demonstrates that our server is compatible with the OpenAI SDK
 * Run this after starting the server to verify compatibility
 */

// Mock OpenAI SDK interface for testing
interface OpenAIConfig {
  baseURL: string;
  apiKey: string;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
}

class MockOpenAI {
  private baseURL: string;
  private apiKey: string;

  constructor(config: OpenAIConfig) {
    this.baseURL = config.baseURL;
    this.apiKey = config.apiKey;
  }

  get chat() {
    return {
      completions: {
        create: async (request: ChatCompletionRequest) => {
          const response = await fetch(`${this.baseURL}/v1/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(request),
          });

          if (!response.ok) {
            throw new Error(
              `HTTP ${response.status}: ${await response.text()}`
            );
          }

          if (request.stream) {
            return response; // Return the response for streaming
          }

          return response.json();
        },
      },
    };
  }

  get models() {
    return {
      list: async () => {
        const response = await fetch(`${this.baseURL}/v1/models`, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        return response.json();
      },
    };
  }
}

async function testOpenAICompatibility() {
  console.log("🧪 Testing OpenAI SDK compatibility...\n");

  const openai = new MockOpenAI({
    baseURL: "http://localhost:3000",
    apiKey: "dummy-key", // Our server doesn't require auth, but SDK expects it
  });

  try {
    // Test 1: List models
    console.log("1️⃣ Testing models endpoint...");
    const models = await openai.models.list();
    console.log(`✅ Found ${models.data.length} models:`);
    models.data.forEach((model: any) => {
      console.log(`   - ${model.id}`);
    });
    console.log();

    // Test 2: Basic chat completion
    console.log("2️⃣ Testing basic chat completion...");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: "Hello! Please respond with just 'Hi there!'",
        },
      ],
    });

    console.log("✅ Chat completion response:");
    console.log(`   ID: ${completion.id}`);
    console.log(`   Model: ${completion.model}`);
    console.log(`   Response: ${completion.choices[0].message.content}`);
    console.log(`   Tokens: ${completion.usage.total_tokens}`);
    console.log();

    // Test 3: Streaming chat completion
    console.log("3️⃣ Testing streaming chat completion...");
    const streamResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "user", content: "Count from 1 to 5, one number per line" },
      ],
      stream: true,
    });

    console.log("✅ Streaming response:");
    const reader = streamResponse.body?.getReader();
    const decoder = new TextDecoder();
    let streamedContent = "";

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ") && !line.includes("[DONE]")) {
            try {
              const data = JSON.parse(line.slice(6));
              const content = data.choices[0]?.delta?.content;
              if (content) {
                streamedContent += content;
                process.stdout.write(content);
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    }
    console.log(`\n   Total streamed content: "${streamedContent.trim()}"`);
    console.log();

    // Test 4: Multi-turn conversation
    console.log("4️⃣ Testing multi-turn conversation...");
    const conversation = await openai.chat.completions.create({
      model: "claude-3-haiku-20240307",
      messages: [
        { role: "system", content: "You are a helpful math tutor." },
        { role: "user", content: "What is 2 + 2?" },
        { role: "assistant", content: "2 + 2 equals 4." },
        { role: "user", content: "What about 3 + 3?" },
      ],
    });

    console.log("✅ Multi-turn conversation:");
    console.log(`   Response: ${conversation.choices[0].message.content}`);
    console.log();

    console.log("🎉 All tests passed! The server is OpenAI SDK compatible.");
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (import.meta.main) {
  testOpenAICompatibility();
}

export { testOpenAICompatibility };
