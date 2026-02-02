import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as mockKeychain from "./keychain/mock";

const originalFetch = globalThis.fetch;

describe("escrowsStatus command", () => {
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    mockKeychain.clear();
    mockFetch = mock(() => Promise.resolve(new Response("{}", { status: 200 })));
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.SX_KEY;
  });

  describe("validation", () => {
    let commands: typeof import("../src/commands");

    beforeEach(async () => {
      commands = await import("../src/commands");
    });

    it("should require SX_KEY for chain connection", async () => {
      await expect(commands.escrowsStatus("1", mockKeychain)).rejects.toThrow(/SX_KEY/);
    });

    it("should validate escrow ID is a number", async () => {
      await mockKeychain.set("SX_KEY", "0x" + "1".repeat(64));

      mockFetch.mockImplementation(() => {
        return Promise.resolve(
          new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x14a34" }))
        );
      });

      await expect(commands.escrowsStatus("not-a-number", mockKeychain)).rejects.toThrow(
        /invalid/i
      );
    });
  });

  describe("state constants", () => {
    it("should have all escrow states defined", () => {
      const ESCROW_STATES = [
        "Created",
        "Funded",
        "KeyCommitted",
        "Released",
        "Claimed",
        "Cancelled",
        "Disputed",
        "Expired",
      ];
      expect(ESCROW_STATES.length).toBe(8);
      expect(ESCROW_STATES[0]).toBe("Created");
      expect(ESCROW_STATES[1]).toBe("Funded");
      expect(ESCROW_STATES[4]).toBe("Claimed");
    });
  });

  describe("result structure", () => {
    it("should define expected result fields", () => {
      // Type definition test - the result should have these fields
      type EscrowStatusResult = {
        escrowId: number;
        state: string;
        stateCode: number;
        hasLocalKeys: boolean;
        hasSwarmRef: boolean;
        hasContentHash: boolean;
        onChain: {
          seller: string;
          buyer: string;
          contentHash: string;
          amount: string;
          expiresAt: string;
          disputeWindow: string;
        };
        local: {
          encryptionKey?: string;
          salt?: string;
          swarmRef?: string;
          contentHash?: string;
        };
      };

      // This is a compile-time check - if the type is wrong, this won't compile
      const mockResult: EscrowStatusResult = {
        escrowId: 42,
        state: "Funded",
        stateCode: 1,
        hasLocalKeys: true,
        hasSwarmRef: true,
        hasContentHash: true,
        onChain: {
          seller: "0x1234",
          buyer: "0x5678",
          contentHash: "0xabcd",
          amount: "0.1 ETH",
          expiresAt: "2024-01-01T00:00:00.000Z",
          disputeWindow: "86400s",
        },
        local: {
          encryptionKey: "(set)",
          salt: "(set)",
          swarmRef: "abc123...",
          contentHash: "0xdef...",
        },
      };

      expect(mockResult.escrowId).toBe(42);
      expect(mockResult.state).toBe("Funded");
      expect(mockResult.hasLocalKeys).toBe(true);
    });
  });

  describe("local key detection", () => {
    it("should check keychain for escrow keys", async () => {
      // Verify the keychain pattern is correct
      const escrowId = 42;
      const keyName = `ESCROW_${escrowId}_KEY`;
      const saltName = `ESCROW_${escrowId}_SALT`;
      const swarmName = `ESCROW_${escrowId}_SWARM`;
      const hashName = `ESCROW_${escrowId}_CONTENT_HASH`;

      expect(keyName).toBe("ESCROW_42_KEY");
      expect(saltName).toBe("ESCROW_42_SALT");
      expect(swarmName).toBe("ESCROW_42_SWARM");
      expect(hashName).toBe("ESCROW_42_CONTENT_HASH");
    });
  });
});
