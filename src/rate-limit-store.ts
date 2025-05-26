import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

interface RateLimitData {
  // Support both old and new formats for backward compatibility
  requestCount?: number; // Old format
  windowStart?: number; // Old format
  requestTimestamps?: number[]; // New sliding window format
  lastRequestTime: number;
  isLimited: boolean;
  retryAfter?: number;
  processId: string;
  lastUpdated: number;
}

export class RateLimitStore {
  private readonly storeDir: string;
  private readonly storeFile: string;
  private readonly processId: string;

  constructor() {
    this.storeDir = join(tmpdir(), "duckai");
    this.storeFile = join(this.storeDir, "rate-limit.json");
    this.processId = `${process.pid}-${Date.now()}`;

    // Ensure directory exists
    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true });
    }
  }

  /**
   * Read rate limit data from shared store
   */
  read(): RateLimitData | null {
    try {
      if (!existsSync(this.storeFile)) {
        return null;
      }

      const data = readFileSync(this.storeFile, "utf8");

      // Handle empty file
      if (!data.trim()) {
        return null;
      }

      const parsed: RateLimitData = JSON.parse(data);

      // Check if data is stale (older than 5 minutes)
      const now = Date.now();
      if (now - parsed.lastUpdated > 5 * 60 * 1000) {
        return null;
      }

      return parsed;
    } catch (error) {
      // Don't log warnings for expected cases like empty files
      return null;
    }
  }

  /**
   * Write rate limit data to shared store
   */
  write(data: Omit<RateLimitData, "processId" | "lastUpdated">): void {
    try {
      const storeData: RateLimitData = {
        ...data,
        processId: this.processId,
        lastUpdated: Date.now(),
      };

      writeFileSync(this.storeFile, JSON.stringify(storeData, null, 2));
    } catch (error) {
      console.warn("Failed to write rate limit store:", error);
    }
  }

  /**
   * Update rate limit data atomically
   */
  update(updater: (current: RateLimitData | null) => RateLimitData): void {
    const current = this.read();
    const updated = updater(current);
    this.write(updated);
  }

  /**
   * Clear the store
   */
  clear(): void {
    try {
      if (existsSync(this.storeFile)) {
        const fs = require("fs");
        fs.unlinkSync(this.storeFile);
      }
    } catch (error) {
      console.warn("Failed to clear rate limit store:", error);
    }
  }

  /**
   * Get store file path for debugging
   */
  getStorePath(): string {
    return this.storeFile;
  }
}
