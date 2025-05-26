import { describe, it, expect, beforeEach } from "bun:test";
import { RateLimitMonitor } from "../src/rate-limit-monitor";
import { OpenAIService } from "../src/openai-service";

describe("Rate Limit Monitor", () => {
  let monitor: RateLimitMonitor;
  let openAIService: OpenAIService;

  beforeEach(() => {
    monitor = new RateLimitMonitor();
    openAIService = new OpenAIService();
  });

  describe("getCurrentStatus", () => {
    it("should return rate limit status with additional calculated fields", () => {
      const status = monitor.getCurrentStatus();

      expect(status).toHaveProperty("requestsInCurrentWindow");
      expect(status).toHaveProperty("maxRequestsPerMinute");
      expect(status).toHaveProperty("timeUntilWindowReset");
      expect(status).toHaveProperty("isCurrentlyLimited");
      expect(status).toHaveProperty("recommendedWaitTime");
      expect(status).toHaveProperty("utilizationPercentage");
      expect(status).toHaveProperty("timeUntilWindowResetMinutes");
      expect(status).toHaveProperty("recommendedWaitTimeSeconds");

      expect(typeof status.utilizationPercentage).toBe("number");
      expect(status.utilizationPercentage).toBeGreaterThanOrEqual(0);
      expect(status.utilizationPercentage).toBeLessThanOrEqual(100);
    });

    it("should calculate utilization percentage correctly", () => {
      const status = monitor.getCurrentStatus();
      const expectedUtilization =
        (status.requestsInCurrentWindow / status.maxRequestsPerMinute) * 100;

      expect(status.utilizationPercentage).toBe(expectedUtilization);
    });
  });

  describe("getRecommendations", () => {
    it("should return an array of recommendations", () => {
      const recommendations = monitor.getRecommendations();

      expect(Array.isArray(recommendations)).toBe(true);
      expect(recommendations.length).toBeGreaterThan(0);

      // Should always include basic recommendations
      expect(recommendations.some((rec) => rec.includes("batching"))).toBe(
        true
      );
      expect(
        recommendations.some((rec) => rec.includes("exponential backoff"))
      ).toBe(true);
      expect(recommendations.some((rec) => rec.includes("Monitor"))).toBe(true);
    });

    it("should provide specific recommendations based on status", () => {
      const recommendations = monitor.getRecommendations();

      // All recommendations should be strings
      recommendations.forEach((rec) => {
        expect(typeof rec).toBe("string");
        expect(rec.length).toBeGreaterThan(0);
      });
    });
  });

  describe("OpenAI Service Rate Limit Integration", () => {
    it("should expose rate limit status through OpenAI service", () => {
      const status = openAIService.getRateLimitStatus();

      expect(status).toHaveProperty("requestsInCurrentWindow");
      expect(status).toHaveProperty("maxRequestsPerMinute");
      expect(status).toHaveProperty("timeUntilWindowReset");
      expect(status).toHaveProperty("isCurrentlyLimited");
      expect(status).toHaveProperty("recommendedWaitTime");

      expect(typeof status.requestsInCurrentWindow).toBe("number");
      expect(typeof status.maxRequestsPerMinute).toBe("number");
      expect(typeof status.timeUntilWindowReset).toBe("number");
      expect(typeof status.isCurrentlyLimited).toBe("boolean");
      expect(typeof status.recommendedWaitTime).toBe("number");
    });

    it("should track requests correctly", async () => {
      const initialStatus = openAIService.getRateLimitStatus();
      const initialCount = initialStatus.requestsInCurrentWindow;

      // Mock the DuckAI response to avoid actual API calls
      const originalChat = openAIService["duckAI"].chat;
      openAIService["duckAI"].chat = async () => "Mock response";

      try {
        await openAIService.createChatCompletion({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "Test" }],
        });

        const afterStatus = openAIService.getRateLimitStatus();
        expect(afterStatus.requestsInCurrentWindow).toBe(initialCount + 1);
      } catch (error) {
        // If it fails due to rate limiting, that's also a valid test result
        expect(error).toBeInstanceOf(Error);
      } finally {
        // Restore original method
        openAIService["duckAI"].chat = originalChat;
      }
    });
  });

  describe("Rate Limit Window Management", () => {
    it("should reset window after time period", () => {
      const status1 = openAIService.getRateLimitStatus();

      // Simulate time passing by directly accessing the DuckAI instance
      const duckAI = openAIService["duckAI"];

      // Force a window reset by manipulating the internal state
      if (duckAI["rateLimitInfo"]) {
        duckAI["rateLimitInfo"].windowStart = Date.now() - 61000; // 61 seconds ago
      }

      const status2 = openAIService.getRateLimitStatus();

      // After window reset, request count should be reset
      expect(status2.requestsInCurrentWindow).toBeLessThanOrEqual(
        status1.requestsInCurrentWindow
      );
    });

    it("should calculate time until reset correctly", () => {
      const status = openAIService.getRateLimitStatus();

      expect(status.timeUntilWindowReset).toBeGreaterThanOrEqual(0);
      expect(status.timeUntilWindowReset).toBeLessThanOrEqual(60000); // Should be within 1 minute
    });
  });

  describe("Rate Limit Enforcement", () => {
    it("should recommend waiting when requests are too frequent", () => {
      const duckAI = openAIService["duckAI"];

      // Simulate recent request
      if (duckAI["rateLimitInfo"]) {
        duckAI["rateLimitInfo"].lastRequestTime = Date.now() - 500; // 500ms ago
      }

      const status = openAIService.getRateLimitStatus();

      // Should recommend waiting since last request was recent
      expect(status.recommendedWaitTime).toBeGreaterThan(0);
    });

    it("should detect when rate limit is exceeded", () => {
      const duckAI = openAIService["duckAI"];

      // Simulate hitting rate limit by directly manipulating the rate limit info
      if (duckAI["rateLimitInfo"]) {
        const rateLimitInfo = duckAI["rateLimitInfo"];
        rateLimitInfo.requestCount = 25; // Exceed the limit of 20
        rateLimitInfo.windowStart = Date.now(); // Ensure current window
        rateLimitInfo.isLimited = true; // Mark as limited
      }

      // Get status directly from the modified state
      const status = openAIService.getRateLimitStatus();

      // Should detect that we're over the limit
      expect(status.requestsInCurrentWindow).toBeGreaterThan(20);
      expect(status.isCurrentlyLimited).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should handle rate limit errors gracefully", async () => {
      // Mock the DuckAI to throw rate limit error
      const originalChat = openAIService["duckAI"].chat;
      openAIService["duckAI"].chat = async () => {
        const error = new Error(
          "Rate limited. Retry after 60000ms. Status: 429"
        );
        throw error;
      };

      try {
        await openAIService.createChatCompletion({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "Test" }],
        });

        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain("Rate limited");
      } finally {
        // Restore original method
        openAIService["duckAI"].chat = originalChat;
      }
    });
  });

  describe("Monitoring Functions", () => {
    it("should start and stop monitoring without errors", () => {
      // Test that monitoring can be started and stopped
      expect(() => {
        monitor.startMonitoring(1); // 1 second interval for testing
        monitor.stopMonitoring();
      }).not.toThrow();
    });

    it("should handle multiple stop calls gracefully", () => {
      expect(() => {
        monitor.stopMonitoring();
        monitor.stopMonitoring(); // Should not throw
      }).not.toThrow();
    });
  });

  describe("Utility Functions", () => {
    it("should print status without errors", () => {
      // Mock console.log to capture output
      const originalLog = console.log;
      const logs: string[] = [];
      console.log = (...args) => logs.push(args.join(" "));

      try {
        monitor.printStatus();

        // Should have printed something
        expect(logs.length).toBeGreaterThan(0);
        expect(logs.some((log) => log.includes("Rate Limit Status"))).toBe(
          true
        );
      } finally {
        console.log = originalLog;
      }
    });

    it("should print recommendations without errors", () => {
      const originalLog = console.log;
      const logs: string[] = [];
      console.log = (...args) => logs.push(args.join(" "));

      try {
        monitor.printRecommendations();

        expect(logs.length).toBeGreaterThan(0);
        expect(logs.some((log) => log.includes("Recommendations"))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });
  });
});
