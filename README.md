# DuckAI OpenAI Server

A high-performance OpenAI-compatible HTTP server that uses DuckDuckGo's AI backend, providing free access to multiple AI models through the familiar OpenAI API interface.

> **Fork notice** — this repository is a fork of [amirkabiri/duckai](https://github.com/amirkabiri/duckai). It adds newer models, reasoning-model support, image/file uploads, system prompts and automatic recovery from DuckDuckGo's `418` challenge. See [What's new in this fork](#whats-new-in-this-fork) for the full list of changes.

## Features

- ✅ Chat completions (streaming and non-streaming)
- ✅ Function/tool calling
- ✅ Multiple models — `gpt-6-luna`, `gpt-5.4-mini`, `gpt-5-mini`, `gpt-5.4-nano`, `tinfoil/gpt-oss-120b`, `claude-haiku-4-5`, `mistral-small-2603`
- ✅ Reasoning models with per-model `reasoning_effort` and `reasoning_content` passthrough
- ✅ System prompt support (a leading `system` message is forwarded as DuckDuckGo custom instructions)
- ✅ `developer` role normalization to `system`
- ✅ Image upload support\*
- ✅ File upload support\*
- ✅ Dynamic model list through the `X_MODELS_JSON` environment variable
- ✅ Automatic recovery from DuckDuckGo's `418 I'm a teapot` challenge (retry with backoff)
- ✅ Automatic retry when DuckDuckGo returns an empty response
- ✅ Rate limiting with intelligent backoff
- ✅ OpenAI-compatible error handling
- ✅ CORS support
- ✅ Health check endpoint

\*On models that support it

## Quick Start

### Option 1: Docker (Recommended)

```bash
# Pull the Docker image
docker pull cobbdzon/duckai

# Run the container
docker run -p 3000:3000 --env-file .env cobbdzon/duckai
```

The server will be available at `http://localhost:3000`.

The upstream image `amirkabiri/duckai` is still available on Docker Hub, but it does not contain the features listed above.

### Option 2: Docker Compose

```bash
# Create your local configuration
cp .env.example .env

# Fill in the values captured from your browser session (see Configuration)

# Build and start the server
docker compose up --build
```

`compose.yml` reads the `.env` file automatically, so the DuckDuckGo headers are picked up without extra flags.

### Option 3: Manual Setup

1. Clone the repository:
```bash
git clone git@github.com:cobbdzon/duckai.git
cd duckai
```

2. Install dependencies:
```bash
bun install
```

3. Create your configuration:
```bash
cp .env.example .env
```

4. Start the server:
```bash
bun run dev
```

The server will start on `http://localhost:3000` by default.

### Option 4: Native binary + systemd user service (Arch Linux)

```bash
bun build --compile --target=bun-linux-x64 src/server.ts --outfile ~/.local/bin/duckai
```

See [Installing on Arch Linux](#installing-on-arch-linux) for the full setup,
including the systemd unit.

### Basic Usage Example

```javascript
import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "http://localhost:3000/v1",
  apiKey: "dummy-key", // Any string works, the server does not authenticate
});

// Chat completion
const completion = await openai.chat.completions.create({
  model: "gpt-6-luna", // Default model
  messages: [
    { role: "user", content: "Hello! How are you?" }
  ],
});

console.log(completion.choices[0].message.content);
```

## Installing on Arch Linux

This compiles the server into a single self-contained binary and runs it as a
[systemd user service](https://wiki.archlinux.org/title/Systemd/User).

### 1. Prerequisites

```bash
sudo pacman -S --needed git
yay -S bun-bin
```

`bun-bin` (AUR) installs `/usr/bin/bun`. The official installer
(`curl -fsSL https://bun.sh/install | bash`) puts it in `~/.bun/bin` instead.
Bun is only needed to build the binary — the compiled binary carries its own
runtime and does not need Bun installed.

### 2. Compile the binary

```bash
git clone https://github.com/cobbdzon/duckai.git
cd duckai
bun install --frozen-lockfile
bun build --compile --target=bun-linux-x64 src/server.ts --outfile ~/.local/bin/duckai
```

`--compile` bundles the Bun runtime together with `jsdom`, `openai` and
`user-agents` into one executable (~75 MB, ~72 MB with `--minify`). Writing
the output straight to `~/.local/bin` keeps the clone free of build artifacts.

For other architectures use `--target=bun-linux-aarch64` (ARM) or
`--target=bun-linux-x64-musl` (Alpine/musl).

### 3. Configure

```bash
mkdir -p ~/.config/duckai
cp .env.example ~/.config/duckai/duckai.env
chmod 600 ~/.config/duckai/duckai.env
$EDITOR ~/.config/duckai/duckai.env
```

Fill in `X_FE_SIGNALS`, `X_FE_VERSION` and `X_VQD_STACK` as described in
[Capturing the DuckDuckGo headers](#capturing-the-duckduckgo-headers). The
example ships `HOST=0.0.0.0`; set it to `127.0.0.1` to keep the server
reachable from localhost only.

This file is parsed by systemd, not by a shell, so the syntax differs slightly
from the `.env` file used by Docker:

- No `export` prefix.
- Values containing spaces have to be quoted.
- Single quotes keep a value completely literal. That matters for
  `X_MODELS_JSON`, which contains JSON quotes:
  `X_MODELS_JSON='{"my-model":{"reasoning_effort":"none"}}'`.

Variables set here override the ones set in the unit file.

### 4. Install the unit

```bash
mkdir -p ~/.local/share/duckai ~/.config/systemd/user

cat > ~/.config/systemd/user/duckai.service <<'EOF'
[Unit]
Description=DuckAI OpenAI-compatible server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=%h/.local/bin/duckai
WorkingDirectory=%h/.local/share/duckai
EnvironmentFile=-%h/.config/duckai/duckai.env
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=127.0.0.1
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
```

`%h` expands to your home directory. The `Environment=` lines are fallbacks for
when `duckai.env` is missing — the env file wins, so `HOST` and `PORT` are
taken from `duckai.env`. The `-` in front of the `EnvironmentFile=` path makes
the file optional.

### 5. Start it

```bash
systemctl --user daemon-reload
systemctl --user enable --now duckai.service
```

User services start with your session. To also start them at boot without
logging in, enable lingering:

```bash
loginctl enable-linger $USER
```

### 6. Verify

```bash
curl -s http://127.0.0.1:3000/health
# {"status":"ok"}

curl -s http://127.0.0.1:3000/v1/models

systemctl --user status duckai
journalctl --user -u duckai -f
```

### Updating

```bash
cd duckai
git pull
bun install --frozen-lockfile
bun build --compile --target=bun-linux-x64 src/server.ts --outfile ~/.local/bin/duckai.new
mv ~/.local/bin/duckai.new ~/.local/bin/duckai
systemctl --user restart duckai
```

Building to a temporary name and renaming it avoids replacing a binary that is
currently running.

### Uninstalling

```bash
systemctl --user disable --now duckai.service
rm ~/.config/systemd/user/duckai.service
rm ~/.config/duckai/duckai.env
rm ~/.local/bin/duckai
systemctl --user daemon-reload
```

### Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `418 I'm a teapot` in the logs | `X_FE_SIGNALS`, `X_FE_VERSION` or `X_VQD_STACK` are stale. Capture them again from a live duck.ai session. |
| `Failed to start server. Is port 3000 in use?` | Another process holds the port. Change `PORT` in `duckai.env` and restart the unit. |
| The unit fails to start | `journalctl --user -u duckai -n 50` shows the reason. A missing binary shows up as `status=203/EXEC`. |
| Configuration changes have no effect | The env file is read when the service starts. Run `systemctl --user restart duckai`. |

### Running from source instead

If you would rather not compile anything, run the server with Bun directly.
`~/.bun/bin` is not on the `PATH` of the systemd user manager, so use the
absolute path to the `bun` binary:

```ini
[Service]
Type=simple
ExecStart=/home/%u/.bun/bin/bun run /home/%u/duckai/src/server.ts
WorkingDirectory=%h/duckai
```

Bun loads `duckai/.env` automatically in this setup, so keep the configuration
in the clone instead of `~/.config/duckai/duckai.env`.

## Configuration

The server talks to DuckDuckGo's internal chat API, which expects a couple of browser headers. Capture them once from a real duck.ai session and put them in a `.env` file next to the project.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PORT` | No | `3000` | Port the HTTP server listens on |
| `HOST` | No | `0.0.0.0` | Address the HTTP server binds to |
| `X_USER_AGENT` | Recommended | Built-in Chrome UA | `User-Agent` used for the VQD challenge and the chat request |
| `X_VQD_STACK` | Recommended | Built-in stack | Stack string of the DuckDuckGo frontend bundle used to answer the VQD challenge |
| `X_FE_SIGNALS` | Yes | – | Value of the `x-fe-signals` header |
| `X_FE_VERSION` | Yes | – | Value of the `x-fe-version` header |
| `X_EMIT_REASONING` | No | Off | Set to `1` or `true` to expose model reasoning as `reasoning_content` |
| `X_MODELS_JSON` | No | Built-in list | JSON object that replaces the built-in model list |
| `NODE_ENV` | No | – | `development` or `production` |

### Capturing the DuckDuckGo headers

1. Open <https://duck.ai> in a browser and send any message.
2. Open DevTools → **Network** and pick the `https://duck.ai/duckchat/v1/chat` request.
3. Under **Request Headers**, copy the values of `x-fe-signals`, `x-fe-version` and `User-Agent` into `X_FE_SIGNALS`, `X_FE_VERSION` and `X_USER_AGENT`.
4. For `X_VQD_STACK`, run `new Error().stack` in the DevTools console while on duck.ai and copy the line pointing at `https://duck.ai/dist/duckai-dist/entry.duckai.<hash>.js`. It has to match the bundle DuckDuckGo currently serves — a stale value makes duck.ai reject the VQD challenge with `418`.

### `.env` example

```bash
PORT=3000
HOST=0.0.0.0

X_USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
X_VQD_STACK=https://duck.ai/dist/duckai-dist/entry.duckai.750f07285be2b4e5c6de.js
X_FE_SIGNALS=...
X_FE_VERSION=serp_20260731_072906_ET-752772fde29f2a1b71d25121171ff64c52a12fc1

# Optional
# X_EMIT_REASONING=1
# X_MODELS_JSON={"my-model":{"reasoning_effort":"none"}}
```

## Supported Models

The list below is the built-in model list from `src/models.ts`.

| Model | Default `reasoning_effort` | Valid `reasoning_efforts` |
| --- | --- | --- |
| `gpt-6-luna` *(default)* | `low` | `low` |
| `gpt-5.4-mini` | `none` | `none`, `low` |
| `gpt-5-mini` | `minimal` | `minimal`, `low` |
| `gpt-5.4-nano` | `none` | `none`, `low` |
| `tinfoil/gpt-oss-120b` | `low` | `low` |
| `claude-haiku-4-5` | `none` | `none`, `low` |
| `mistral-small-2603` | – | – (no reasoning support) |

`gpt-6-luna` is used whenever a request does not specify a `model`. Requesting a model that is not on the list returns an error.

`mistral-small-2603` has no reasoning effort — a `reasoning_effort` sent along with a request for it is ignored and no reasoning effort is forwarded to duck.ai.

### Custom models via `X_MODELS_JSON`

`X_MODELS_JSON` **replaces** the built-in list entirely — it is not merged with it. The value has to be a JSON object that maps model IDs to their defaults:

```bash
X_MODELS_JSON={"my-model":{"reasoning_effort":"none","valid_reasoning_efforts":["none","low"]}}
```

```json
{
  "my-model": {
    "reasoning_effort": "none",
    "valid_reasoning_efforts": ["none", "low"]
  }
}
```

If the value is not valid JSON, the server logs a warning and falls back to the built-in list.

## Usage

### Prerequisites

- [Bun](https://bun.sh/) runtime (recommended) or Node.js 18+

### Using with OpenAI JavaScript Library

```javascript
import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "http://localhost:3000/v1",
  apiKey: "dummy-key", // Any string works
});

// Basic chat completion
const completion = await openai.chat.completions.create({
  model: "gpt-6-luna",
  messages: [
    { role: "user", content: "Hello! How are you?" }
  ],
});

console.log(completion.choices[0].message.content);
```

### Streaming Responses

```javascript
const stream = await openai.chat.completions.create({
  model: "gpt-6-luna",
  messages: [
    { role: "user", content: "Tell me a story" }
  ],
  stream: true
});

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content;
  if (content) {
    process.stdout.write(content);
  }
}
```

### Tool Calling Example

```javascript
const tools = [
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
            description: "Mathematical expression to evaluate"
          }
        },
        required: ["expression"]
      }
    }
  }
];

const completion = await openai.chat.completions.create({
  model: "gpt-6-luna",
  messages: [
    { role: "user", content: "What is 15 * 8?" }
  ],
  tools: tools,
  tool_choice: "auto"
});

// The AI will call the calculate function
console.log(completion.choices[0].message.tool_calls);
```

### Reasoning Models

Reasoning models accept a `reasoning_effort` of `none`, `minimal`, `low`, `medium` or `high`. Each model only accepts a subset of those values — sending an unsupported value returns an error that lists the valid ones. When `model` is omitted, the model's default effort is used. Models without reasoning support (such as `mistral-small-2603`) ignore the parameter.

```javascript
const completion = await openai.chat.completions.create({
  model: "gpt-6-luna",
  reasoning_effort: "low",
  messages: [
    { role: "user", content: "A train leaves at 14:05 and arrives at 19:47. How long is the trip?" }
  ],
});
```

Reasoning output is only returned when `X_EMIT_REASONING=1` is set. It is then exposed as `reasoning_content`, both on the message and on the streaming deltas:

```javascript
console.log(completion.choices[0].message.reasoning_content);
```

```javascript
// Streaming
for await (const chunk of stream) {
  const reasoning = chunk.choices[0]?.delta?.reasoning_content;
  if (reasoning) {
    process.stdout.write(reasoning);
  }
}
```

### System Prompts

A leading `system` message is sent to DuckDuckGo as custom instructions instead of a regular chat message. The `developer` role is treated the same way and normalized to `system`.

```javascript
const completion = await openai.chat.completions.create({
  model: "gpt-6-luna",
  messages: [
    { role: "system", content: "You are a helpful assistant that answers in one sentence." },
    { role: "user", content: "What is the capital of France?" }
  ],
});
```

### Image Upload

Images are passed as base64 data URLs in the standard OpenAI content-part format:

```javascript
const completion = await openai.chat.completions.create({
  model: "gpt-6-luna",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "What is in this image?" },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg..." }
        }
      ]
    }
  ],
});
```

### File Upload

Files follow the same idea, with the payload encoded as a data URL and the original filename preserved:

```javascript
const completion = await openai.chat.completions.create({
  model: "gpt-6-luna",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "Summarize this document." },
        {
          type: "file",
          file: {
            filename: "report.pdf",
            file_data: "data:application/pdf;base64,JVBERi0xLjQK..."
          }
        }
      ]
    }
  ],
});
```

### Using with curl

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dummy-key" \
  -d '{
    "model": "gpt-6-luna",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

### API Endpoints

- `POST /v1/chat/completions` - Chat completions (compatible with OpenAI)
- `GET /v1/models` - List available models
- `GET /health` - Health check endpoint

## Reliability

DuckDuckGo's chat API answers with `418 I'm a teapot` whenever the client fingerprint does not add up. The server handles this for you:

- The `User-Agent` used for the VQD challenge and the chat request is always the same, and the browser-only VQD meta fields (`origin`, `stack`, `duration`) are filled in, so the challenge passes validation.
- A `418` response is retried up to 5 times with an increasing delay between attempts.
- An empty response is retried as well; only after all attempts fail does the server return an apology message.

On top of that the server applies its own rate limiting: at most 20 requests per minute and at least one second between two requests.

## Usage with Docker

### Building the Docker Image

```bash
docker build -t duckai .
```

### Running with Docker

```bash
docker run -p 3000:3000 --env-file .env duckai
```

### Docker Compose

```bash
docker compose up --build
```

## Development

```bash
bun install
bun run dev
```

### Tests

```bash
bun test              # all tests
bun run test:openai   # simple OpenAI SDK test
bun run test:tools    # tool calling tests
bun run test:e2e      # end-to-end tool calling test
```

The test suite talks to the live duck.ai backend, so it depends on your `.env` values and on DuckDuckGo being reachable.

## What's new in this fork

### Models and routing

- `59d3c88` add `claude-haiku-4-5`
- `4731736` set `gpt-5-mini` as default, small refactor
- `0b369e3` update models and add support for dynamic models via `X_MODELS_JSON` env
- `3228241` feat(luna): add GPT6-Luna model

### Reasoning

- `41bcc3a` added `x-fe-signals` and `x-fe-version` environment variables, handle reasoning efforts for reasoning models
- `b48de2d` forward reasoning tokens to OpenAI `reasoning_content`

### Multimodal input

- `31d5738` add support for image upload
- `bb7eb0e` fix contentpart handling to work with Cherry Studio
- `d83acc4` file upload support

### Prompts and roles

- `2a2f596` support system prompts through duck.ai metadata entry in json
- `b464623` normalize role developer to role system in messages

### Anti-bot and 418 handling

- `2ffe15e` call api again when receiving a 418 im a teapot from duck.ai
- `1c7541d` fix 418 ERR_CHALLENGE by using consistent UA and injecting browser-only VQD meta fields
- `9635ff4` clean up 418 error handling code
- `684685d` retry if duck.ai returns empty response

### Ops, dependencies and cleanups

- `9f04be4` add compose.yml for docker compose
- `10005ec` include .env file in docker compose.yml
- `1c06cc2` use full bun docker image in dockerfile
- `2c14d91` dependencies update, openai 4.104.0, use-agents 1.1.669, typescript 5.8.3
- `c96ebfd` fix types, use openai types instead of my own written types for ChatCompletionContentPart types
- `249f672` fix type warnings and remove some debug logging
- `5820b24` small hotfixes
- `092da29` remove patch file

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run the test suite
6. Submit a pull request

## License

MIT License.

## Disclaimer

This project is not affiliated with DuckDuckGo or OpenAI. It's an unofficial bridge service for educational and development purposes. Please respect DuckDuckGo's terms of service and rate limits.
