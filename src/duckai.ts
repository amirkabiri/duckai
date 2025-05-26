import UserAgent from "user-agents";
import { JSDOM } from "jsdom";
import { RateLimitStore } from "./rate-limit-store";
import type {
  ChatCompletionMessage,
  VQDResponse,
  DuckAIRequest,
} from "./types";

const userAgent = new UserAgent();

// Rate limiting tracking
interface RateLimitInfo {
  requestCount: number;
  windowStart: number;
  lastRequestTime: number;
  isLimited: boolean;
  retryAfter?: number;
}

export class DuckAI {
  private rateLimitInfo: RateLimitInfo = {
    requestCount: 0,
    windowStart: Date.now(),
    lastRequestTime: 0,
    isLimited: false,
  };
  private rateLimitStore: RateLimitStore;

  // Conservative rate limiting - adjust based on observed limits
  private readonly MAX_REQUESTS_PER_MINUTE = 20;
  private readonly WINDOW_SIZE_MS = 60 * 1000; // 1 minute
  private readonly MIN_REQUEST_INTERVAL_MS = 1000; // 1 second between requests

  constructor() {
    this.rateLimitStore = new RateLimitStore();
    this.loadRateLimitFromStore();
  }

  /**
   * Load rate limit data from shared store
   */
  private loadRateLimitFromStore(): void {
    const stored = this.rateLimitStore.read();
    if (stored) {
      this.rateLimitInfo = {
        requestCount: stored.requestCount,
        windowStart: stored.windowStart,
        lastRequestTime: stored.lastRequestTime,
        isLimited: stored.isLimited,
        retryAfter: stored.retryAfter,
      };
    }
  }

  /**
   * Save rate limit data to shared store
   */
  private saveRateLimitToStore(): void {
    this.rateLimitStore.write({
      requestCount: this.rateLimitInfo.requestCount,
      windowStart: this.rateLimitInfo.windowStart,
      lastRequestTime: this.rateLimitInfo.lastRequestTime,
      isLimited: this.rateLimitInfo.isLimited,
      retryAfter: this.rateLimitInfo.retryAfter,
    });
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
    const windowElapsed = now - this.rateLimitInfo.windowStart;

    // Reset window if it's been more than a minute
    if (windowElapsed >= this.WINDOW_SIZE_MS) {
      this.rateLimitInfo.requestCount = 0;
      this.rateLimitInfo.windowStart = now;
      this.saveRateLimitToStore();
    }

    const timeUntilReset = Math.max(0, this.WINDOW_SIZE_MS - windowElapsed);
    const timeSinceLastRequest = now - this.rateLimitInfo.lastRequestTime;
    const recommendedWait = Math.max(
      0,
      this.MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest
    );

    return {
      requestsInCurrentWindow: this.rateLimitInfo.requestCount,
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
    const windowElapsed = now - this.rateLimitInfo.windowStart;

    // Reset window if needed
    if (windowElapsed >= this.WINDOW_SIZE_MS) {
      this.rateLimitInfo.requestCount = 0;
      this.rateLimitInfo.windowStart = now;
      this.rateLimitInfo.isLimited = false;
      this.saveRateLimitToStore();
    }

    // Check if we're hitting the rate limit
    if (this.rateLimitInfo.requestCount >= this.MAX_REQUESTS_PER_MINUTE) {
      const timeUntilReset = this.WINDOW_SIZE_MS - windowElapsed;
      return { shouldWait: true, waitTime: timeUntilReset };
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
   * Update rate limit tracking after a request
   */
  private updateRateLimitTracking(response: Response) {
    const now = Date.now();
    this.rateLimitInfo.requestCount++;
    this.rateLimitInfo.lastRequestTime = now;

    // Check for rate limit headers (DuckDuckGo might not send these, but we'll check)
    const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
    const rateLimitReset = response.headers.get("x-ratelimit-reset");
    const retryAfter = response.headers.get("retry-after");

    if (response.status === 429) {
      this.rateLimitInfo.isLimited = true;
      if (retryAfter) {
        this.rateLimitInfo.retryAfter = parseInt(retryAfter) * 1000; // Convert to ms
      }
      console.warn("Rate limited by DuckAI API:", {
        status: response.status,
        retryAfter: retryAfter,
        rateLimitRemaining,
        rateLimitReset,
      });
    }

    // Log rate limit info if headers are present
    if (rateLimitRemaining || rateLimitReset) {
      console.log("DuckAI Rate Limit Info:", {
        remaining: rateLimitRemaining,
        reset: rateLimitReset,
        currentCount: this.rateLimitInfo.requestCount,
      });
    }

    // Save updated rate limit info to store
    this.saveRateLimitToStore();
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

  private async getVQD(): Promise<VQDResponse> {
    const response = await fetch("https://duckduckgo.com/duckchat/v1/status", {
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
        "User-Agent": userAgent.toString(),
      },
      referrer: "https://duckduckgo.com/",
      referrerPolicy: "origin",
      method: "GET",
      mode: "cors",
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(
        `Failed to get VQD: ${response.status} ${response.statusText}`
      );
    }

    const vqd = response.headers.get("x-Vqd-4");
    const hashHeader = response.headers.get("x-Vqd-hash-1");

    if (!vqd || !hashHeader) {
      throw new Error(
        `Missing VQD headers: vqd=${!!vqd}, hash=${!!hashHeader}`
      );
    }

    let hash: string;
    try {
      hash = atob(hashHeader);
    } catch (e) {
      throw new Error(`Failed to decode VQD hash: ${e}`);
    }

    return { vqd, hash };
  }

  private async hashClientHashes(clientHashes: string[]): Promise<string[]> {
    return Promise.all(
      clientHashes.map(async (hash) => {
        const encoder = new TextEncoder();
        const data = encoder.encode(hash);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = new Uint8Array(hashBuffer);
        return btoa(
          hashArray.reduce((str, byte) => str + String.fromCharCode(byte), "")
        );
      })
    );
  }

  async chat(request: DuckAIRequest): Promise<string> {
    // Wait if rate limiting is needed
    await this.waitIfNeeded();

    const vqd = await this.getVQD();

    const { window } = new JSDOM(
      `<html><body><script>window.hash = ${vqd.hash}</script></body></html>`,
      { runScripts: "dangerously" }
    );
    const hash = (window as any).hash;

    if (!hash || !hash.client_hashes || !Array.isArray(hash.client_hashes)) {
      throw new Error(`Invalid hash structure: ${JSON.stringify(hash)}`);
    }

    const clientHashes = await this.hashClientHashes(hash.client_hashes);

    // Update rate limit tracking BEFORE making the request
    const now = Date.now();
    this.rateLimitInfo.requestCount++;
    this.rateLimitInfo.lastRequestTime = now;
    this.saveRateLimitToStore();

    const response = await fetch("https://duckduckgo.com/duckchat/v1/chat", {
      headers: {
        accept: "text/event-stream",
        "accept-language": "en-US,en;q=0.9,fa;q=0.8",
        "cache-control": "no-cache",
        "content-type": "application/json",
        pragma: "no-cache",
        priority: "u=1, i",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "x-fe-version": "serp_20250401_100419_ET-19d438eb199b2bf7c300",
        "x-vqd-4": vqd.vqd,
        "User-Agent": userAgent.toString(),
        "x-vqd-hash-1": btoa(
          JSON.stringify({
            server_hashes: hash.server_hashes,
            client_hashes: clientHashes,
            signals: hash.signal,
          })
        ),
      },
      referrer: "https://duckduckgo.com/",
      referrerPolicy: "origin",
      body: JSON.stringify(request),
      method: "POST",
      mode: "cors",
      credentials: "include",
    });

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000; // Default 1 minute
      throw new Error(
        `Rate limited. Retry after ${waitTime}ms. Status: ${response.status}`
      );
    }

    if (!response.ok) {
      throw new Error(
        `DuckAI API error: ${response.status} ${response.statusText}`
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

    // Extract the LLM response from the streamed response
    let llmResponse = "";
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const json = JSON.parse(line.slice(6));
          if (json.message) {
            llmResponse += json.message;
          }
        } catch (e) {
          // Skip invalid JSON lines
        }
      }
    }

    const finalResponse = llmResponse.trim();

    // If response is empty, provide a fallback
    if (!finalResponse) {
      console.warn("Duck.ai returned empty response, using fallback");
      return "I apologize, but I'm unable to provide a response at the moment. Please try again.";
    }

    return finalResponse;
  }

  async chatStream(request: DuckAIRequest): Promise<ReadableStream<string>> {
    // Wait if rate limiting is needed
    await this.waitIfNeeded();

    const vqd = await this.getVQD();

    const { window } = new JSDOM(
      `<html><body><script>window.hash = ${vqd.hash}</script></body></html>`,
      { runScripts: "dangerously" }
    );
    const hash = (window as any).hash;

    if (!hash || !hash.client_hashes || !Array.isArray(hash.client_hashes)) {
      throw new Error(`Invalid hash structure: ${JSON.stringify(hash)}`);
    }

    const clientHashes = await this.hashClientHashes(hash.client_hashes);

    // Update rate limit tracking BEFORE making the request
    const now = Date.now();
    this.rateLimitInfo.requestCount++;
    this.rateLimitInfo.lastRequestTime = now;
    this.saveRateLimitToStore();

    const response = await fetch("https://duckduckgo.com/duckchat/v1/chat", {
      headers: {
        accept: "text/event-stream",
        "accept-language": "en-US,en;q=0.9,fa;q=0.8",
        "cache-control": "no-cache",
        "content-type": "application/json",
        pragma: "no-cache",
        priority: "u=1, i",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "x-fe-version": "serp_20250401_100419_ET-19d438eb199b2bf7c300",
        "x-vqd-4": vqd.vqd,
        "User-Agent": userAgent.toString(),
        "x-vqd-hash-1": btoa(
          JSON.stringify({
            server_hashes: hash.server_hashes,
            client_hashes: clientHashes,
            signals: hash.signal,
          })
        ),
      },
      referrer: "https://duckduckgo.com/",
      referrerPolicy: "origin",
      body: JSON.stringify(request),
      method: "POST",
      mode: "cors",
      credentials: "include",
    });

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000; // Default 1 minute
      throw new Error(
        `Rate limited. Retry after ${waitTime}ms. Status: ${response.status}`
      );
    }

    if (!response.ok) {
      throw new Error(
        `DuckAI API error: ${response.status} ${response.statusText}`
      );
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    return new ReadableStream({
      start(controller) {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();

        function pump(): Promise<void> {
          return reader.read().then(({ done, value }) => {
            if (done) {
              controller.close();
              return;
            }

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  const json = JSON.parse(line.slice(6));
                  if (json.message) {
                    controller.enqueue(json.message);
                  }
                } catch (e) {
                  // Skip invalid JSON
                }
              }
            }

            return pump();
          });
        }

        return pump();
      },
    });
  }

  getAvailableModels(): string[] {
    return [
      "gpt-4o-mini",
      "o3-mini",
      "claude-3-haiku-20240307",
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "mistralai/Mistral-Small-24B-Instruct-2501",
    ];
  }
}
