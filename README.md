# Duck.ai OpenAI-Compatible Server

A high-performance HTTP server built with Bun that provides OpenAI-compatible API endpoints using Duck.ai as the backend. This allows you to use any OpenAI SDK or tool with Duck.ai's free AI models.

## 🚀 Features

- **OpenAI API Compatible**: Drop-in replacement for OpenAI API
- **Multiple Models**: Support for GPT-4o-mini, Claude-3-Haiku, Llama, Mistral, and more
- **Streaming Support**: Real-time streaming responses
- **Built with Bun**: Ultra-fast TypeScript runtime
- **CORS Enabled**: Ready for web applications
- **Comprehensive Testing**: Full test suite ensuring compatibility

## 📋 Available Models

- `gpt-4o-mini`
- `o3-mini`
- `claude-3-haiku-20240307`
- `meta-llama/Llama-3.3-70B-Instruct-Turbo`
- `mistralai/Mistral-Small-24B-Instruct-2501`

## 🛠️ Installation

1. **Install Bun** (if not already installed):
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. **Clone and setup the project**:
   ```bash
   git clone <your-repo>
   cd duckai-openai-server
   bun install
   ```

3. **Start the server**:
   ```bash
   bun run dev
   ```

The server will start on `http://localhost:3000` by default.

## 🔧 Usage

### Basic cURL Example

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ]
  }'
```

### Streaming Example

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "Count from 1 to 10"}
    ],
    "stream": true
  }'
```

### Using with OpenAI SDK (Python)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="dummy-key"  # Not required, but SDK expects it
)

# Non-streaming
response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)
print(response.choices[0].message.content)

# Streaming
stream = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {"role": "user", "content": "Tell me a story"}
    ],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content is not None:
        print(chunk.choices[0].delta.content, end="")
```

### Using with OpenAI SDK (Node.js)

```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'dummy-key', // Not required, but SDK expects it
});

// Non-streaming
const completion = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [
    { role: 'user', content: 'Hello!' }
  ],
});

console.log(completion.choices[0].message.content);

// Streaming
const stream = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [
    { role: 'user', content: 'Tell me a story' }
  ],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

## 🌐 API Endpoints

### `GET /health`
Health check endpoint.

**Response:**
```json
{"status": "ok"}
```

### `GET /v1/models`
List available models.

**Response:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-4o-mini",
      "object": "model",
      "created": 1640995200,
      "owned_by": "duckai"
    }
  ]
}
```

### `POST /v1/chat/completions`
Create chat completions (OpenAI compatible).

**Request Body:**
```json
{
  "model": "gpt-4o-mini",
  "messages": [
    {"role": "user", "content": "Hello!"}
  ],
  "stream": false,
  "temperature": 0.7,
  "max_tokens": 150
}
```

**Response (Non-streaming):**
```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1640995200,
  "model": "gpt-4o-mini",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  }
}
```

**Response (Streaming):**
```
data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk",...}

data: [DONE]
```

## 🧪 Testing

### Run All Tests
```bash
bun test
```

### Run Specific Test Suites
```bash
# Run server API tests
bun test tests/server.test.ts

# Run OpenAI JavaScript library compatibility tests
bun run test:openai

# Run comprehensive OpenAI library tests (more extensive)
bun run test:openai-full

# Run all core tests together
bun run test:all
```

### Run Manual OpenAI SDK Compatibility Test
```bash
# Start the server first
bun run dev

# In another terminal, run the manual compatibility test
bun run tests/openai-sdk-test.ts
```

### Manual Testing with Different Tools

**Test with HTTPie:**
```bash
http POST localhost:3000/v1/chat/completions \
  model=gpt-4o-mini \
  messages:='[{"role":"user","content":"Hello!"}]'
```

**Test with Postman:**
- URL: `http://localhost:3000/v1/chat/completions`
- Method: POST
- Headers: `Content-Type: application/json`
- Body: Raw JSON with the request format above

## 🔧 Configuration

### Environment Variables

- `PORT`: Server port (default: 3000)

### Custom Model Selection

You can specify any of the available models in your requests:

```json
{
  "model": "claude-3-haiku-20240307",
  "messages": [{"role": "user", "content": "Hello!"}]
}
```

## 🏗️ Development

### Project Structure
```
src/
├── types.ts          # TypeScript type definitions
├── duckai.ts         # Duck.ai integration
├── openai-service.ts # OpenAI compatibility layer
└── server.ts         # Main HTTP server

tests/
├── server.test.ts         # Server API unit tests
├── openai-simple.test.ts  # OpenAI library compatibility tests
├── openai-library.test.ts # Comprehensive OpenAI library tests
└── openai-sdk-test.ts     # Manual SDK compatibility demo
```

### Adding New Features

1. **Add new types** in `src/types.ts`
2. **Extend Duck.ai integration** in `src/duckai.ts`
3. **Update OpenAI service** in `src/openai-service.ts`
4. **Add tests** in `tests/`

### Building for Production

```bash
bun run build
bun run start
```

## 🐛 Troubleshooting

### Common Issues

1. **"fetch is not defined"**: Make sure you're using Bun, not Node.js
2. **CORS errors**: The server includes CORS headers, but check your client configuration
3. **Model not found**: Use one of the supported models listed above
4. **Streaming not working**: Ensure your client properly handles Server-Sent Events

### Debug Mode

Set environment variable for verbose logging:
```bash
DEBUG=1 bun run dev
```

## 📝 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## 🙏 Acknowledgments

- Built on top of the reverse-engineered Duck.ai API
- Compatible with OpenAI API specification
- Powered by Bun runtime 