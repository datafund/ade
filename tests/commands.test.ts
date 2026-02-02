import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as mockKeychain from "./keychain/mock";

// Store original fetch
const originalFetch = globalThis.fetch;

describe("commands", () => {
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    mockKeychain.clear();
    mockFetch = mock(() => Promise.resolve(new Response("{}", { status: 200 })));
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.SX_API;
  });

  // Helper to set up mock responses
  const setupFetchResponse = (data: unknown, status = 200) => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(data), { status }))
    );
  };

  describe("read commands", () => {
    // Import inside describe to allow mock setup
    let commands: typeof import("../src/commands");

    beforeEach(async () => {
      commands = await import("../src/commands");
    });

    describe("statsFn", () => {
      it("should fetch protocol stats", async () => {
        setupFetchResponse({ totalSkills: 100, totalAgents: 50 });

        const result = await commands.statsFn();

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url] = mockFetch.mock.calls[0] as [string];
        expect(url).toContain("/api/v1/stats");
        expect(result).toEqual({ totalSkills: 100, totalAgents: 50 });
      });
    });

    describe("skillsList", () => {
      it("should fetch skills with default pagination", async () => {
        setupFetchResponse([{ id: 1, title: "Skill 1" }]);

        await commands.skillsList({});

        const [url] = mockFetch.mock.calls[0] as [string];
        expect(url).toContain("/skills?");
        expect(url).toContain("limit=50");
        expect(url).toContain("offset=0");
      });

      it("should apply category filter", async () => {
        setupFetchResponse([]);

        await commands.skillsList({ category: "ai" });

        const [url] = mockFetch.mock.calls[0] as [string];
        expect(url).toContain("category=ai");
      });

      it("should apply status filter", async () => {
        setupFetchResponse([]);

        await commands.skillsList({ status: "active" });

        const [url] = mockFetch.mock.calls[0] as [string];
        expect(url).toContain("status=active");
      });

      it("should respect limit and offset", async () => {
        setupFetchResponse([]);

        await commands.skillsList({ limit: "10", offset: "20" });

        const [url] = mockFetch.mock.calls[0] as [string];
        expect(url).toContain("limit=10");
        expect(url).toContain("offset=20");
      });
    });

    describe("skillsShow", () => {
      it("should fetch skill by ID", async () => {
        setupFetchResponse({ id: "abc", title: "Test Skill" });

        const result = await commands.skillsShow("abc");

        const [url] = mockFetch.mock.calls[0] as [string];
        expect(url).toContain("/skills/abc");
        expect(result).toEqual({ id: "abc", title: "Test Skill" });
      });

      it("should URL-encode skill ID", async () => {
        setupFetchResponse({});

        await commands.skillsShow("skill with spaces");

        const [url] = mockFetch.mock.calls[0] as [string];
        expect(url).toContain("/skills/skill%20with%20spaces");
      });
    });

    describe("bountiesList", () => {
      it("should fetch bounties and extract from wrapper", async () => {
        setupFetchResponse({ bounties: [{ id: 1 }, { id: 2 }] });

        const result = await commands.bountiesList({});

        expect(result).toEqual([{ id: 1 }, { id: 2 }]);
      });

      it("should apply status filter", async () => {
        setupFetchResponse({ bounties: [] });

        await commands.bountiesList({ status: "open" });

        const [url] = mockFetch.mock.calls[0] as [string];
        expect(url).toContain("status=open");
      });
    });

    describe("agentsList", () => {
      it("should fetch agents and extract from wrapper", async () => {
        setupFetchResponse({ agents: [{ id: "a1" }] });

        const result = await commands.agentsList({});

        expect(result).toEqual([{ id: "a1" }]);
      });

      it("should apply sort parameter", async () => {
        setupFetchResponse({ agents: [] });

        await commands.agentsList({ sort: "reputation" });

        const [url] = mockFetch.mock.calls[0] as [string];
        expect(url).toContain("sort=reputation");
      });
    });

    describe("escrowsList", () => {
      it("should fetch escrows with state filter", async () => {
        setupFetchResponse({ escrows: [{ id: 1, state: "funded" }] });

        const result = await commands.escrowsList({ state: "funded" });

        const [url] = mockFetch.mock.calls[0] as [string];
        expect(url).toContain("state=funded");
        expect(result).toEqual([{ id: 1, state: "funded" }]);
      });
    });

    describe("escrowsShow", () => {
      it("should fetch escrow by ID", async () => {
        setupFetchResponse({ id: "123", state: "funded", amount: "1000000000000000000" });

        const result = await commands.escrowsShow("123");

        const [url] = mockFetch.mock.calls[0] as [string];
        expect(url).toContain("/escrows/123");
        expect(result).toEqual({ id: "123", state: "funded", amount: "1000000000000000000" });
      });

      it("should URL-encode escrow ID", async () => {
        setupFetchResponse({});

        await commands.escrowsShow("escrow/special");

        const [url] = mockFetch.mock.calls[0] as [string];
        expect(url).toContain("/escrows/escrow%2Fspecial");
      });
    });

    describe("bountiesShow", () => {
      it("should fetch bounty by ID", async () => {
        setupFetchResponse({ id: "bounty-1", title: "Fix Bug", reward: "0.5" });

        const result = await commands.bountiesShow("bounty-1");

        const [url] = mockFetch.mock.calls[0] as [string];
        expect(url).toContain("/bounties/bounty-1");
        expect(result).toEqual({ id: "bounty-1", title: "Fix Bug", reward: "0.5" });
      });

      it("should URL-encode bounty ID", async () => {
        setupFetchResponse({});

        await commands.bountiesShow("bounty with spaces");

        const [url] = mockFetch.mock.calls[0] as [string];
        expect(url).toContain("/bounties/bounty%20with%20spaces");
      });
    });

    describe("agentsShow", () => {
      it("should fetch agent reputation by ID", async () => {
        setupFetchResponse({ id: "agent-1", reputation: 95, totalJobs: 50 });

        const result = await commands.agentsShow("agent-1");

        const [url] = mockFetch.mock.calls[0] as [string];
        expect(url).toContain("/agents/agent-1/reputation");
        expect(result).toEqual({ id: "agent-1", reputation: 95, totalJobs: 50 });
      });

      it("should URL-encode agent ID", async () => {
        setupFetchResponse({});

        await commands.agentsShow("agent/special");

        const [url] = mockFetch.mock.calls[0] as [string];
        expect(url).toContain("/agents/agent%2Fspecial/reputation");
      });
    });

    describe("walletsList", () => {
      it("should fetch wallets with role filter", async () => {
        setupFetchResponse({ wallets: [{ address: "0x123" }] });

        const result = await commands.walletsList({ role: "seller" });

        const [url] = mockFetch.mock.calls[0] as [string];
        expect(url).toContain("role=seller");
        expect(result).toEqual([{ address: "0x123" }]);
      });
    });
  });

  describe("write commands (API + signing)", () => {
    let commands: typeof import("../src/commands");

    beforeEach(async () => {
      commands = await import("../src/commands");
    });

    describe("skillsVote", () => {
      it("should require SX_KEY from keychain", async () => {
        setupFetchResponse({ success: true });

        try {
          await commands.skillsVote("skill-1", "up", mockKeychain);
          expect.unreachable("should have thrown");
        } catch (err: unknown) {
          expect((err as Error).message).toContain("SX_KEY");
        }
      });

      it("should post vote with auth headers when key set", async () => {
        const testKey = "0x1234567890123456789012345678901234567890123456789012345678901234";
        await mockKeychain.set("SX_KEY", testKey);
        setupFetchResponse({ success: true });

        await commands.skillsVote("skill-1", "up", mockKeychain);

        const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(url).toContain("/skills/skill-1/vote");
        expect(opts.method).toBe("POST");
        expect(opts.body).toBe('{"direction":"up"}');
        const headers = opts.headers as Record<string, string>;
        expect(headers["X-Signature"]).toBeDefined();
      });

      it("should reject invalid direction", async () => {
        const testKey = "0x1234567890123456789012345678901234567890123456789012345678901234";
        await mockKeychain.set("SX_KEY", testKey);

        try {
          await commands.skillsVote("skill-1", "sideways", mockKeychain);
          expect.unreachable("should have thrown");
        } catch (err: unknown) {
          expect((err as Error).message).toContain("up");
          expect((err as Error).message).toContain("down");
        }
      });
    });

    describe("skillsComment", () => {
      it("should post comment with auth", async () => {
        const testKey = "0x1234567890123456789012345678901234567890123456789012345678901234";
        await mockKeychain.set("SX_KEY", testKey);
        setupFetchResponse({ success: true });

        await commands.skillsComment("skill-1", "Great skill!", mockKeychain);

        const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(url).toContain("/skills/skill-1/comments");
        expect(opts.body).toBe('{"body":"Great skill!"}');
      });
    });

    describe("skillsCreate", () => {
      it("should create skill with required fields", async () => {
        const testKey = "0x1234567890123456789012345678901234567890123456789012345678901234";
        await mockKeychain.set("SX_KEY", testKey);
        setupFetchResponse({ id: "new-skill" });

        await commands.skillsCreate({ title: "My Skill", price: "0.1" }, mockKeychain);

        const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(url).toContain("/skills");
        const body = JSON.parse(opts.body as string);
        expect(body.title).toBe("My Skill");
        expect(body.price).toBe("0.1");
      });
    });

    describe("bountiesCreate", () => {
      it("should create bounty with required fields", async () => {
        const testKey = "0x1234567890123456789012345678901234567890123456789012345678901234";
        await mockKeychain.set("SX_KEY", testKey);
        setupFetchResponse({ id: "new-bounty" });

        await commands.bountiesCreate({ title: "Fix Bug", reward: "0.5" }, mockKeychain);

        const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(url).toContain("/bounties");
        const body = JSON.parse(opts.body as string);
        expect(body.title).toBe("Fix Bug");
        expect(body.rewardAmount).toBe("0.5");
      });
    });
  });

  describe("chain commands (validation)", () => {
    let commands: typeof import("../src/commands");

    beforeEach(async () => {
      commands = await import("../src/commands");
    });

    describe("escrowsCreate", () => {
      it("should require SX_KEY", async () => {
        try {
          await commands.escrowsCreate({ contentHash: "0x" + "a".repeat(64), price: "0.1", yes: true }, mockKeychain);
          expect.unreachable("should have thrown");
        } catch (err: unknown) {
          expect((err as Error).message).toContain("SX_KEY");
        }
      });

      // Note: Content hash validation happens after RPC connection in the current implementation
      // These tests would require mocking viem's createPublicClient which is complex
    });

    describe("escrowsFund", () => {
      it("should require SX_KEY", async () => {
        try {
          await commands.escrowsFund("1", { yes: true }, mockKeychain);
          expect.unreachable("should have thrown");
        } catch (err: unknown) {
          expect((err as Error).message).toContain("SX_KEY");
        }
      });

      // Note: Escrow ID validation happens after RPC connection
    });

    describe("escrowsCommitKey", () => {
      it("should require SX_KEY", async () => {
        try {
          await commands.escrowsCommitKey("1", { yes: true }, mockKeychain);
          expect.unreachable("should have thrown");
        } catch (err: unknown) {
          expect((err as Error).message).toContain("SX_KEY");
        }
      });

      // Note: Key/salt validation happens after RPC connection
    });

    describe("escrowsRevealKey", () => {
      it("should require SX_KEY", async () => {
        try {
          await commands.escrowsRevealKey("1", { yes: true }, mockKeychain);
          expect.unreachable("should have thrown");
        } catch (err: unknown) {
          expect((err as Error).message).toContain("SX_KEY");
        }
      });
    });

    describe("escrowsClaim", () => {
      it("should require SX_KEY", async () => {
        try {
          await commands.escrowsClaim("1", { yes: true }, mockKeychain);
          expect.unreachable("should have thrown");
        } catch (err: unknown) {
          expect((err as Error).message).toContain("SX_KEY");
        }
      });
    });
  });

  describe("private key validation", () => {
    let commands: typeof import("../src/commands");

    beforeEach(async () => {
      commands = await import("../src/commands");
    });

    it("should accept key with 0x prefix", async () => {
      const testKey = "0x1234567890123456789012345678901234567890123456789012345678901234";
      await mockKeychain.set("SX_KEY", testKey);
      setupFetchResponse({ success: true });

      // This should not throw for key format
      await commands.skillsVote("skill-1", "up", mockKeychain);
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should accept key without 0x prefix", async () => {
      const testKey = "1234567890123456789012345678901234567890123456789012345678901234";
      await mockKeychain.set("SX_KEY", testKey);
      setupFetchResponse({ success: true });

      // This should not throw for key format
      await commands.skillsVote("skill-1", "up", mockKeychain);
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should accept uppercase key", async () => {
      const testKey = "0xABCDEF0123456789012345678901234567890123456789012345678901234567";
      await mockKeychain.set("SX_KEY", testKey);
      setupFetchResponse({ success: true });

      await commands.skillsVote("skill-1", "up", mockKeychain);
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should reject key that is too short", async () => {
      const shortKey = "0x1234";
      await mockKeychain.set("SX_KEY", shortKey);

      try {
        await commands.skillsVote("skill-1", "up", mockKeychain);
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect((err as Error).message).toContain("32 bytes");
      }
    });

    it("should reject key that is too long", async () => {
      const longKey = "0x" + "1".repeat(70);
      await mockKeychain.set("SX_KEY", longKey);

      try {
        await commands.skillsVote("skill-1", "up", mockKeychain);
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect((err as Error).message).toContain("32 bytes");
      }
    });

    it("should reject key with invalid characters", async () => {
      const invalidKey = "0xGGGG567890123456789012345678901234567890123456789012345678901234";
      await mockKeychain.set("SX_KEY", invalidKey);

      try {
        await commands.skillsVote("skill-1", "up", mockKeychain);
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect((err as Error).message).toContain("32 bytes");
      }
    });

    it("should trim whitespace from key", async () => {
      const keyWithWhitespace = "  0x1234567890123456789012345678901234567890123456789012345678901234  ";
      await mockKeychain.set("SX_KEY", keyWithWhitespace);
      setupFetchResponse({ success: true });

      await commands.skillsVote("skill-1", "up", mockKeychain);
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe("configShow", () => {
    let commands: typeof import("../src/commands");

    beforeEach(async () => {
      commands = await import("../src/commands");
    });

    it("should return config with masked secrets", async () => {
      await mockKeychain.set("SX_KEY", "0x1234567890123456789012345678901234567890123456789012345678901234");
      await mockKeychain.set("SX_RPC", "https://rpc.example.com");

      const config = await commands.configShow(mockKeychain);

      expect(config.SX_API).toBe("https://agents.datafund.io");
      expect(config.SX_KEY).toContain("...");
      expect(config.SX_KEY).not.toContain("1234567890");
      expect(config.SX_RPC).toBe("https://rpc.example.com");
      expect(config.supportedChains).toBeDefined();
      expect(config.supportedChains.length).toBeGreaterThan(0);
    });

    it("should use default RPC when not configured", async () => {
      const config = await commands.configShow(mockKeychain);

      expect(config.SX_KEY).toBe("(not set)");
      expect(config.SX_RPC).toBe("https://mainnet.base.org"); // Default RPC
      expect(config.SX_RPC_SOURCE).toBe("default");
    });
  });
});
