import UserAgent from "user-agents";
import { JSDOM } from "jsdom";
import type {
  ChatCompletionMessage,
  VQDResponse,
  DuckAIRequest,
} from "./types";

const userAgent = new UserAgent();

export class DuckAI {
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
