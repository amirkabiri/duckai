import { DuckAI } from "./duckai";

/**
 * Shared Rate Limit Tester
 *
 * This utility tests rate limits using the DuckAI class which writes to the shared store,
 * allowing cross-process monitoring to work correctly.
 */
export class SharedRateLimitTester {
  private duckAI: DuckAI;

  constructor() {
    this.duckAI = new DuckAI();
  }

  /**
   * Get current rate limit status
   */
  getCurrentStatus() {
    const status = this.duckAI.getRateLimitStatus();
    return {
      ...status,
      utilizationPercentage:
        (status.requestsInCurrentWindow / status.maxRequestsPerMinute) * 100,
      timeUntilWindowResetMinutes: Math.ceil(
        status.timeUntilWindowReset / 60000
      ),
      recommendedWaitTimeSeconds: Math.ceil(status.recommendedWaitTime / 1000),
    };
  }

  /**
   * Print current rate limit status to console
   */
  printStatus() {
    const status = this.getCurrentStatus();

    console.log("\n🔍 DuckAI Rate Limit Status (Shared Tester):");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(
      `📊 Requests in current window: ${status.requestsInCurrentWindow}/${status.maxRequestsPerMinute}`
    );
    console.log(`📈 Utilization: ${status.utilizationPercentage.toFixed(1)}%`);
    console.log(
      `⏰ Window resets in: ${status.timeUntilWindowResetMinutes} minutes`
    );
    console.log(
      `🚦 Currently limited: ${status.isCurrentlyLimited ? "❌ Yes" : "✅ No"}`
    );

    if (status.recommendedWaitTimeSeconds > 0) {
      console.log(
        `⏳ Recommended wait: ${status.recommendedWaitTimeSeconds} seconds`
      );
    }

    // Visual progress bar
    const barLength = 20;
    const filledLength = Math.round(
      (status.utilizationPercentage / 100) * barLength
    );
    const bar = "█".repeat(filledLength) + "░".repeat(barLength - filledLength);
    console.log(
      `📊 Usage: [${bar}] ${status.utilizationPercentage.toFixed(1)}%`
    );
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  }

  /**
   * Test rate limits by making a series of requests using DuckAI (writes to shared store)
   */
  async testRateLimits(
    numberOfRequests: number = 5,
    delayBetweenRequests: number = 1000
  ) {
    console.log(
      `🧪 Testing rate limits with ${numberOfRequests} requests (${delayBetweenRequests}ms delay)...`
    );
    console.log(
      "📡 Using DuckAI class - data will be shared across processes!"
    );

    for (let i = 1; i <= numberOfRequests; i++) {
      console.log(`\n📤 Making request ${i}/${numberOfRequests}...`);

      try {
        const startTime = Date.now();

        const response = await this.duckAI.chat({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: `Shared test request ${i}` }],
        });

        const endTime = Date.now();
        const responseTime = endTime - startTime;

        console.log(`✅ Request ${i} successful (${responseTime}ms)`);
        this.printStatus();

        if (i < numberOfRequests) {
          console.log(
            `⏳ Waiting ${delayBetweenRequests}ms before next request...`
          );
          await new Promise((resolve) =>
            setTimeout(resolve, delayBetweenRequests)
          );
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.log(`❌ Request ${i} failed:`, errorMessage);
        this.printStatus();

        // If rate limited, wait longer
        if (errorMessage.includes("Rate limited")) {
          const waitTime =
            this.getCurrentStatus().recommendedWaitTimeSeconds * 1000;
          console.log(`⏳ Rate limited! Waiting ${waitTime}ms...`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }
    }

    console.log("\n🏁 Shared rate limit test completed!");
    console.log(
      "📡 Data has been written to shared store for cross-process monitoring!"
    );
  }

  /**
   * Get recommendations for optimal usage
   */
  getRecommendations() {
    const status = this.getCurrentStatus();
    const recommendations: string[] = [];

    if (status.utilizationPercentage > 80) {
      recommendations.push(
        "⚠️  High utilization detected. Consider implementing request queuing."
      );
    }

    if (status.recommendedWaitTimeSeconds > 0) {
      recommendations.push(
        `⏳ Wait ${status.recommendedWaitTimeSeconds}s before next request.`
      );
    }

    if (status.isCurrentlyLimited) {
      recommendations.push(
        "🚫 Currently rate limited. Wait for window reset or implement exponential backoff."
      );
    }

    if (status.utilizationPercentage < 50) {
      recommendations.push(
        "✅ Good utilization level. You can safely increase request frequency."
      );
    }

    recommendations.push(
      "💡 Consider implementing request batching for better efficiency."
    );
    recommendations.push("🔄 Use exponential backoff for retry logic.");
    recommendations.push("📊 Monitor rate limits continuously in production.");
    recommendations.push(
      "📡 Use shared monitoring for cross-process visibility."
    );

    return recommendations;
  }

  /**
   * Print recommendations
   */
  printRecommendations() {
    const recommendations = this.getRecommendations();

    console.log("\n💡 Rate Limit Recommendations:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    recommendations.forEach((rec) => console.log(rec));
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  }
}

// CLI usage
if (require.main === module) {
  const tester = new SharedRateLimitTester();

  // Parse command line arguments
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "status":
      tester.printStatus();
      tester.printRecommendations();
      break;

    case "test":
      const requests = parseInt(args[1]) || 5;
      const delay = parseInt(args[2]) || 1000;
      tester.testRateLimits(requests, delay).then(() => {
        tester.printRecommendations();
        process.exit(0);
      });
      break;

    default:
      console.log("🔍 DuckAI Shared Rate Limit Tester");
      console.log("📡 Uses DuckAI class - data is shared across processes!");
      console.log("");
      console.log("Usage:");
      console.log(
        "  bun run src/shared-rate-limit-tester.ts status                    # Show current status"
      );
      console.log(
        "  bun run src/shared-rate-limit-tester.ts test [requests] [delay]  # Test rate limits (shared)"
      );
      console.log("");
      console.log("Examples:");
      console.log("  bun run src/shared-rate-limit-tester.ts status");
      console.log("  bun run src/shared-rate-limit-tester.ts test 10 2000");
      console.log("");
      console.log("💡 For cross-process monitoring, run this in one terminal:");
      console.log("  bun run src/shared-rate-limit-tester.ts test 20 3000");
      console.log("");
      console.log("And this in another terminal:");
      console.log("  bun run src/shared-rate-limit-monitor.ts monitor 2");
      break;
  }
}
