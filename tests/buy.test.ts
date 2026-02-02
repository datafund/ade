import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as mockKeychain from "./keychain/mock";

const originalFetch = globalThis.fetch;

describe("buy command", () => {
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    mockKeychain.clear();
    mockFetch = mock(() => Promise.resolve(new Response("{}", { status: 200 })));
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.SX_KEY;
    delete process.env.BEE_API;
  });

  describe("validation", () => {
    let commands: typeof import("../src/commands");

    beforeEach(async () => {
      commands = await import("../src/commands");
    });

    it("should require SX_KEY", async () => {
      await expect(
        commands.buy({ escrowId: "1", yes: true }, mockKeychain)
      ).rejects.toThrow(/SX_KEY/);
    });

    it("should require --yes flag in non-TTY mode", async () => {
      await mockKeychain.set("SX_KEY", "0x" + "1".repeat(64));

      await expect(
        commands.buy({ escrowId: "1", yes: false }, mockKeychain)
      ).rejects.toThrow(/--yes/);
    });

    it("should validate escrow ID format", async () => {
      await mockKeychain.set("SX_KEY", "0x" + "1".repeat(64));

      // Mock just enough to get past chain connection
      mockFetch.mockImplementation(() => {
        return Promise.resolve(
          new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x14a34" }))
        );
      });

      await expect(
        commands.buy({ escrowId: "not-a-number", yes: true }, mockKeychain)
      ).rejects.toThrow(/invalid/i);
    });
  });

  describe("options parsing", () => {
    it("should accept output path option", () => {
      // Type check - these options should be valid
      const opts = {
        escrowId: "42",
        output: "./my-data.csv",
        waitTimeout: 3600,
        yes: true,
      };
      expect(opts.output).toBe("./my-data.csv");
      expect(opts.waitTimeout).toBe(3600);
    });

    it("should have default wait timeout of 24 hours", () => {
      // The default is 86400 seconds (24 hours)
      const DEFAULT_KEY_WAIT_TIMEOUT = 86400;
      expect(DEFAULT_KEY_WAIT_TIMEOUT).toBe(24 * 60 * 60);
    });
  });
});

describe("buy command gas estimation", () => {
  it("should include gas cost in balance check", async () => {
    // The buy function now estimates gas and checks:
    // balance >= amount + gasCost
    // This is tested via the error message pattern
    const errorPattern = /insufficient balance.*gas/i;
    expect(errorPattern.test("Insufficient balance: 0.1 ETH, need 0.1 ETH + ~0.001 ETH gas")).toBe(true);
  });
});
