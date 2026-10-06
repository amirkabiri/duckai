import { JSDOM } from "jsdom";
import { RateLimitStore } from "./rate-limit-store";
import { SharedRateLimitMonitor } from "./shared-rate-limit-monitor";
import type {
  ChatCompletionMessage,
  VQDResponse,
  DuckAIRequest,
  DuckAIChatResult,
  DuckAIStreamChunk,
  DuckChatCompletionMessage,
  ChatCompletionRequest,
  DuckChatCompletionContentPartImage,
  DuckChatCompletionContentPartFile,
} from "./types";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { DUCKAI_MODELS } from "./models";
import { ChatCompletionContentPart } from "openai/src/resources.js";
import { sleep } from "bun";

// Rate limiting tracking with sliding window
interface RateLimitInfo {
  requestTimestamps: number[]; // Array of request timestamps for sliding window
  lastRequestTime: number;
  isLimited: boolean;
  retryAfter?: number;
}

export class DuckAI {
  private rateLimitInfo: RateLimitInfo = {
    requestTimestamps: [],
    lastRequestTime: 0,
    isLimited: false,
  };
  private rateLimitStore: RateLimitStore;
  private rateLimitMonitor: SharedRateLimitMonitor;

  // Conservative rate limiting - adjust based on observed limits
  private readonly MAX_REQUESTS_PER_MINUTE = 20;
  private readonly WINDOW_SIZE_MS = 60 * 1000; // 1 minute
  private readonly MIN_REQUEST_INTERVAL_MS = 1000; // 1 second between requests

  // Defaults used when the corresponding env var is unset. These mimic what
  // duck.ai's web client currently sends and need to match what gets hashed
  // into the VQD challenge response.
  private static readonly DEFAULT_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
  private static readonly DEFAULT_VQD_STACK =
    "l@https://duck.ai/dist/duckai-dist/entry.duckai.c9340e95bd2f7fdc3302.js:2:1308110\n";

  private get userAgent(): string {
    return process.env.X_USER_AGENT || DuckAI.DEFAULT_USER_AGENT;
  }

  private get vqdStack(): string {
    return process.env.X_VQD_STACK || DuckAI.DEFAULT_VQD_STACK;
  }

  private get emitReasoning(): boolean {
    const v = process.env.X_EMIT_REASONING;
    return v === "1" || v === "true";
  }

  constructor() {
    this.rateLimitStore = new RateLimitStore();
    this.rateLimitMonitor = new SharedRateLimitMonitor();
    this.loadRateLimitFromStore();
  }

  /**
   * Clean old timestamps outside the sliding window
   */
  private cleanOldTimestamps(): void {
    const now = Date.now();
    const cutoff = now - this.WINDOW_SIZE_MS;
    this.rateLimitInfo.requestTimestamps =
      this.rateLimitInfo.requestTimestamps.filter(
        (timestamp) => timestamp > cutoff,
      );
  }

  /**
   * Get current request count in sliding window
   */
  private getCurrentRequestCount(): number {
    this.cleanOldTimestamps();
    return this.rateLimitInfo.requestTimestamps.length;
  }

  /**
   * Load rate limit data from shared store
   */
  private loadRateLimitFromStore(): void {
    const stored = this.rateLimitStore.read();
    if (stored) {
      // Convert old format to new sliding window format if needed
      const storedAny = stored as any;
      if ("requestCount" in storedAny && "windowStart" in storedAny) {
        // Old format - convert to new format (start fresh)
        this.rateLimitInfo = {
          requestTimestamps: [],
          lastRequestTime: storedAny.lastRequestTime || 0,
          isLimited: storedAny.isLimited || false,
          retryAfter: storedAny.retryAfter,
        };
      } else {
        // New format
        this.rateLimitInfo = {
          requestTimestamps: storedAny.requestTimestamps || [],
          lastRequestTime: storedAny.lastRequestTime || 0,
          isLimited: storedAny.isLimited || false,
          retryAfter: storedAny.retryAfter,
        };
      }
      // Clean old timestamps after loading
      this.cleanOldTimestamps();
    }
  }

  /**
   * Save rate limit data to shared store
   */
  private saveRateLimitToStore(): void {
    this.cleanOldTimestamps();
    this.rateLimitStore.write({
      requestTimestamps: this.rateLimitInfo.requestTimestamps,
      lastRequestTime: this.rateLimitInfo.lastRequestTime,
      isLimited: this.rateLimitInfo.isLimited,
      retryAfter: this.rateLimitInfo.retryAfter,
    } as any);
  }

  /**
   * Get current rate limit status
   */
  getRateLimitStatus(): {
    requestsInCurrentWindow: number;
    maxRequestsPerMinute: number;
    timeUntilWindowReset: number;
    isCurrentlyLimited: boolean;
    recommendedWaitTime: number;
  } {
    // Load latest data from store first
    this.loadRateLimitFromStore();

    const now = Date.now();
    const currentRequestCount = this.getCurrentRequestCount();

    // For sliding window, there's no fixed reset time
    // The "reset" happens continuously as old requests fall out of the window
    const oldestTimestamp = this.rateLimitInfo.requestTimestamps[0];
    const timeUntilReset = oldestTimestamp
      ? Math.max(0, oldestTimestamp + this.WINDOW_SIZE_MS - now)
      : 0;

    const timeSinceLastRequest = now - this.rateLimitInfo.lastRequestTime;
    const recommendedWait = Math.max(
      0,
      this.MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest,
    );

    return {
      requestsInCurrentWindow: currentRequestCount,
      maxRequestsPerMinute: this.MAX_REQUESTS_PER_MINUTE,
      timeUntilWindowReset: timeUntilReset,
      isCurrentlyLimited: this.rateLimitInfo.isLimited,
      recommendedWaitTime: recommendedWait,
    };
  }

  /**
   * Check if we should wait before making a request
   */
  private shouldWaitBeforeRequest(): { shouldWait: boolean; waitTime: number } {
    // Load latest data from store first
    this.loadRateLimitFromStore();

    const now = Date.now();
    const currentRequestCount = this.getCurrentRequestCount();

    // Check if we're hitting the rate limit
    if (currentRequestCount >= this.MAX_REQUESTS_PER_MINUTE) {
      // Find the oldest request timestamp
      const oldestTimestamp = this.rateLimitInfo.requestTimestamps[0];
      if (oldestTimestamp) {
        // Wait until the oldest request falls out of the window
        const waitTime = oldestTimestamp + this.WINDOW_SIZE_MS - now + 100; // +100ms buffer
        return { shouldWait: true, waitTime: Math.max(0, waitTime) };
      }
    }

    // Check minimum interval between requests
    const timeSinceLastRequest = now - this.rateLimitInfo.lastRequestTime;
    if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL_MS) {
      const waitTime = this.MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest;
      return { shouldWait: true, waitTime };
    }

    return { shouldWait: false, waitTime: 0 };
  }

  /**
   * Wait if necessary before making a request
   */
  private async waitIfNeeded(): Promise<void> {
    const { shouldWait, waitTime } = this.shouldWaitBeforeRequest();

    if (shouldWait) {
      console.log(`Rate limiting: waiting ${waitTime}ms before next request`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  private async getEncodedVqdHash(vqdHash: string): Promise<string> {
    const jsScript = Buffer.from(vqdHash, "base64").toString("utf-8");

    const dom = new JSDOM(
      `<iframe id="jsa" sandbox="allow-scripts allow-same-origin" srcdoc="<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Security-Policy"; content="default-src 'none'; script-src 'unsafe-inline'">
</head>
<body></body>
</html>" style="position: absolute; left: -9999px; top: -9999px;"></iframe>`,
      { runScripts: "dangerously" },
    );
    dom.window.top.__DDG_BE_VERSION__ = 1;
    dom.window.top.__DDG_FE_CHAT_HASH__ = 1;
    const jsa = dom.window.top.document.querySelector(
      "#jsa",
    ) as HTMLIFrameElement;
    const contentDoc = jsa.contentDocument || jsa.contentWindow!.document;

    const meta = contentDoc.createElement("meta");
    meta.setAttribute("http-equiv", "Content-Security-Policy");
    meta.setAttribute(
      "content",
      "default-src 'none'; script-src 'unsafe-inline';",
    );
    contentDoc.head.appendChild(meta);
    const result = (await dom.window.eval(jsScript)) as {
      client_hashes: string[];
      [key: string]: any;
    };

    result.client_hashes[0] = this.userAgent;
    result.client_hashes = result.client_hashes.map((t) => {
      const hash = createHash("sha256");
      hash.update(t);

      return hash.digest("base64");
    });

    // duck.ai validates these meta fields; JSDOM can't produce them on its own
    if (result.meta && typeof result.meta === "object") {
      (result.meta as any).origin = "https://duck.ai";
      (result.meta as any).stack = this.vqdStack;
      (result.meta as any).duration = String(20 + Math.floor(Math.random() * 30));
    }

    return btoa(JSON.stringify(result));
  }

  private async getVQD(userAgent: string): Promise<VQDResponse> {
    const response = await fetch("https://duck.ai/duckchat/v1/status", {
      headers: {
        accept: "*/*",
        "accept-language": "en-US,en;q=0.9,fa;q=0.8",
        "cache-control": "no-store",
        pragma: "no-cache",
        priority: "u=1, i",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "x-vqd-accept": "1",
        "User-Agent": userAgent,
      },
      referrer: "https://duck.ai/",
      referrerPolicy: "origin",
      method: "GET",
      mode: "cors",
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(
        `Failed to get VQD: ${response.status} ${response.statusText}`,
      );
    }

    const hashHeader = response.headers.get("x-Vqd-hash-1");

    if (!hashHeader) {
      throw new Error(`Missing VQD headers: hash=${!!hashHeader}`);
    }

    const encodedHash = await this.getEncodedVqdHash(hashHeader);

    return { hash: encodedHash };
  }

  private async hashClientHashes(clientHashes: string[]): Promise<string[]> {
    return Promise.all(
      clientHashes.map(async (hash) => {
        const encoder = new TextEncoder();
        const data = encoder.encode(hash);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = new Uint8Array(hashBuffer);
        return btoa(
          hashArray.reduce((str, byte) => str + String.fromCharCode(byte), ""),
        );
      }),
    );
  }

  private async fetchDuckAIEndpoint(
    request: DuckAIRequest,
    userAgent: string,
    vqd: VQDResponse,
  ): Promise<Response> {
    return await fetch("https://duck.ai/duckchat/v1/chat", {
      headers: {
        accept: "text/event-stream",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        "content-type": "application/json",
        pragma: "no-cache",
        priority: "u=0",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "x-fe-signals": process.env.X_FE_SIGNALS,
        "x-fe-version": process.env.X_FE_VERSION,
        "User-Agent": userAgent,
        "x-vqd-hash-1": vqd.hash,
      },
      referrer: "https://duck.ai/",
      referrerPolicy: "origin",
      body: JSON.stringify(request),
      method: "POST",
      mode: "cors",
      credentials: "include",
    });
  }

  // retry in increasing intervals when 418 error code
  private async safeFetchDuckAIEndpoint(
    request: DuckAIRequest,
    userAgent: string,
    vqd: VQDResponse,
    attempt?: number,
  ): Promise<Response> {
    const response: Response = await this.fetchDuckAIEndpoint(
      request,
      userAgent,
      vqd,
    );
    var currentAttempt = attempt || 0;
    if (response.status == 418 && currentAttempt < 5) {
      const waitTime = currentAttempt + 1;
      console.warn(`⚠️ Encountered error 418, waiting for ${waitTime} seconds before refetching. Attempt: ${currentAttempt + 1}`)
      return await sleep(waitTime * 1000).then(() => this.safeFetchDuckAIEndpoint(request, userAgent, vqd, currentAttempt + 1))
    }
    return response;
  }

  async chat(
    request: DuckAIRequest,
    attempt?: number,
  ): Promise<DuckAIChatResult> {
    // Wait if rate limiting is needed
    await this.waitIfNeeded();

    const userAgent = this.userAgent;
    const vqd = await this.getVQD(userAgent);

    // Update rate limit tracking BEFORE making the request
    const now = Date.now();
    this.rateLimitInfo.requestTimestamps.push(now);
    this.rateLimitInfo.lastRequestTime = now;
    this.saveRateLimitToStore();

    // Show compact rate limit status in server console
    this.rateLimitMonitor.printCompactStatus();

    // const response = await this.fetchDuckAIEndpoint(request, userAgent, vqd);
    const response = await this.safeFetchDuckAIEndpoint(request, userAgent, vqd);

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000; // Default 1 minute
      throw new Error(
        `Rate limited. Retry after ${waitTime}ms. Status: ${response.status}`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `DuckAI API error: ${response.status} ${response.statusText}`,
      );
    }

    const text = await response.text();

    // Check for errors
    try {
      const parsed = JSON.parse(text);
      if (parsed.action === "error") {
        throw new Error(`Duck.ai error: ${JSON.stringify(parsed)}`);
      }
    } catch (e) {
      // Not JSON, continue processing
    }

    // Extract content and reasoning from the streamed response
    let content = "";
    let reasoning = "";
    const lines = text.split("\n");
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        if (json.role === "reasoning" && typeof json.text === "string") {
          reasoning += json.text;
        } else if (typeof json.message === "string") {
          content += json.message;
        }
      } catch (e) {
        // Skip invalid JSON lines (incl. [CHAT_TITLE:...] and [PING] sentinels)
      }
    }

    const finalContent = content.trim();

    // If content is empty, retry up to 5 times then fall back
    var currentAttempt = attempt || 0;
    if (!finalContent && currentAttempt <= 5) {
      console.warn("Duck.ai returned empty response, retrying call");
      return this.chat(request, currentAttempt + 1);
    } else if (currentAttempt > 5) {
      return {
        content:
          "I apologize, but I'm unable to provide a response at the moment. Please try again.",
      };
    }

    const result: DuckAIChatResult = { content: finalContent };
    if (this.emitReasoning && reasoning) result.reasoning = reasoning;
    return result;
  }

  async chatStream(
    request: DuckAIRequest,
  ): Promise<ReadableStream<DuckAIStreamChunk>> {
    // Wait if rate limiting is needed
    await this.waitIfNeeded();

    const userAgent = this.userAgent;
    const vqd = await this.getVQD(userAgent);

    // Update rate limit tracking BEFORE making the request
    const now = Date.now();
    this.rateLimitInfo.requestTimestamps.push(now);
    this.rateLimitInfo.lastRequestTime = now;
    this.saveRateLimitToStore();

    // Show compact rate limit status in server console
    this.rateLimitMonitor.printCompactStatus();

    // const response = await this.fetchDuckAIEndpoint(request, userAgent, vqd);
    const response = await this.safeFetchDuckAIEndpoint(request, userAgent, vqd);

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000; // Default 1 minute
      throw new Error(
        `Rate limited. Retry after ${waitTime}ms. Status: ${response.status}`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `DuckAI API error: ${response.status} ${response.statusText}`,
      );
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    const emitReasoning = this.emitReasoning;

    return new ReadableStream({
      start(controller) {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        function handleLine(line: string) {
          if (!line.startsWith("data: ")) return;
          const payload = line.slice(6);
          if (payload === "[DONE]") return;
          try {
            const json = JSON.parse(payload);
            if (
              emitReasoning &&
              json.role === "reasoning" &&
              typeof json.text === "string" &&
              json.text.length > 0
            ) {
              controller.enqueue({ type: "reasoning", text: json.text });
            } else if (typeof json.message === "string") {
              controller.enqueue({ type: "content", text: json.message });
            }
          } catch (e) {
            // Skip invalid JSON (incl. [CHAT_TITLE:...] / [PING] sentinels)
          }
        }

        function pump(): Promise<void> {
          return reader.read().then(({ done, value }) => {
            if (done) {
              if (buf.length > 0) handleLine(buf);
              controller.close();
              return;
            }

            buf += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf("\n")) >= 0) {
              handleLine(buf.slice(0, idx));
              buf = buf.slice(idx + 1);
            }

            return pump();
          });
        }

        return pump();
      },
    });
  }

  getAvailableModels(): string[] {
    return Object.keys(DUCKAI_MODELS);
  }

  static transformToDuckAIRequest(
    request: ChatCompletionRequest,
  ): DuckAIRequest {
    // Use the model from request, fallback to default
    const model = request.model || "gpt-5-mini";

    if (!(model in DUCKAI_MODELS)) {
      throw new Error(
        `Model ${model} is not a valid model, valid models: ${Object.keys(DUCKAI_MODELS).join(", ")}`,
      );
    }

    const transformedMessages: DuckChatCompletionMessage[] = [];

    for (const message of request.messages as ChatCompletionMessage[]) {
      if (Array.isArray(message.content)) {
        const transformedContent = [];
        for (const content of message.content as ChatCompletionContentPart[]) {
          if (content.type == "text") {
            if (typeof content.text !== "string" || content.type !== "text") {
              throw new Error("Image text must be a string of type text");
            }

            transformedContent.push(content);
          } else if (content.type == "image_url") {
            if (
              content.image_url === null ||
              typeof content.image_url?.url !== "string" ||
              content.type !== "image_url"
            ) {
              throw new Error("Image payload is incorrect");
            }

            // valid image, transform to DuckChatCompletionRequest
            // data:image/png;base64,fah
            console.log(content.image_url);
            const newImagePayload: DuckChatCompletionContentPartImage = {
              image: content.image_url.url,
              type: "image",
              mimeType: content.image_url.url.split(":")[1].split(";")[0],
            };
            //console.log(newImagePayload);
            transformedContent.push(newImagePayload);
          } else if (content.type == "file") {
            if (
              content.file === null ||
              typeof content.file.file_data != "string" ||
              typeof content.file.filename != "string"
            ) {
              throw new Error("File payload is incorrect or missing");
            }

            // valid file, transform to DuckChatCompletionContentPartFile
            const newFilePayload: DuckChatCompletionContentPartFile = {
              content: content.file.file_data.split(",")[1],
              encoding: content.file.file_data?.split(";")[1].split(",")[0],
              filename: content.file.filename,
              mimeType: content.file.file_data?.split(":")[1].split(";")[0],
              type: "file",
            };
            //console.log(newFilePayload);
            transformedContent.push(newFilePayload);
          }
        }

        // transform message
        const clonedMessage = structuredClone(message);
        const newMessage = {
          ...clonedMessage,
          content: transformedContent,
        };
        transformedMessages.push(newMessage as DuckChatCompletionMessage);
      } else {
        transformedMessages.push(message as DuckChatCompletionMessage);
      }
    }

    // validate reasoning effort
    const reasoning_effort =
      request.reasoning_effort || DUCKAI_MODELS[model].reasoning_effort;

    if (
      DUCKAI_MODELS[model].valid_reasoning_efforts != undefined &&
      !DUCKAI_MODELS[model].valid_reasoning_efforts?.includes(reasoning_effort)
    ) {
      throw new Error(
        `Model ${model} does not support this reasoning effort (${reasoning_effort}),
        valid reasoning efforts: ${(DUCKAI_MODELS[model].valid_reasoning_efforts || []).join(", ")}`,
      );
    }

    return {
      canUseTools: true,
      messages: transformedMessages,
      metadata: request.metadata,
      model,
      reasoningEffort: reasoning_effort,
    };
  }
}
