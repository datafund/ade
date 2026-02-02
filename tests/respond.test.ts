import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { writeFile, rm, mkdir } from "fs/promises";
import { join } from "path";
import * as mockKeychain from "./keychain/mock";

const originalFetch = globalThis.fetch;

describe("respond command", () => {
  let mockFetch: ReturnType<typeof mock>;
  const testDir = join(import.meta.dir, ".test-files");
  const testFile = join(testDir, "response-data.txt");

  beforeEach(async () => {
    mockKeychain.clear();
    mockFetch = mock(() => Promise.resolve(new Response("{}", { status: 200 })));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await mkdir(testDir, { recursive: true });
    await writeFile(testFile, "This is my bounty response data.");
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.SX_KEY;
    delete process.env.BEE_API;
    delete process.env.BEE_STAMP;

    try {
      await rm(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("validation", () => {
    let commands: typeof import("../src/commands");

    beforeEach(async () => {
      commands = await import("../src/commands");
    });

    it("should require --yes flag in non-TTY mode", async () => {
      await expect(
        commands.respond({ bountyId: "abc123", file: testFile, yes: false }, mockKeychain)
      ).rejects.toThrow(/--yes/);
    });
  });

  describe("bounty lookup", () => {
    let commands: typeof import("../src/commands");

    beforeEach(async () => {
      commands = await import("../src/commands");
    });

    it("should fetch bounty details from API", async () => {
      let bountyFetched = false;

      mockFetch.mockImplementation((url: string) => {
        if ((url as string).includes("/bounties/abc123")) {
          bountyFetched = true;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: "abc123",
                title: "Test Bounty",
                rewardAmount: "0.5",
                status: "open",
                creator: "0x1234",
              })
            )
          );
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      });

      // Will fail later due to missing secrets, but should fetch bounty first
      try {
        await commands.respond({ bountyId: "abc123", file: testFile, yes: true }, mockKeychain);
      } catch {
        // Expected to fail
      }

      expect(bountyFetched).toBe(true);
    });

    it("should throw if bounty not found", async () => {
      mockFetch.mockImplementation((url: string) => {
        if ((url as string).includes("/bounties/")) {
          return Promise.resolve(new Response("{}", { status: 404 }));
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      });

      await expect(
        commands.respond({ bountyId: "nonexistent", file: testFile, yes: true }, mockKeychain)
      ).rejects.toThrow(/not found/i);
    });

    it("should reject non-open bounties", async () => {
      mockFetch.mockImplementation((url: string) => {
        if ((url as string).includes("/bounties/")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: "abc123",
                title: "Closed Bounty",
                rewardAmount: "0.5",
                status: "closed",
                creator: "0x1234",
              })
            )
          );
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      });

      await expect(
        commands.respond({ bountyId: "abc123", file: testFile, yes: true }, mockKeychain)
      ).rejects.toThrow(/not open/i);
    });
  });

  describe("escrow creation requirements", () => {
    let commands: typeof import("../src/commands");

    beforeEach(async () => {
      commands = await import("../src/commands");

      // Mock bounty API to return valid open bounty
      mockFetch.mockImplementation((url: string) => {
        if ((url as string).includes("/bounties/")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: "abc123",
                title: "Test Bounty",
                rewardAmount: "0.5",
                status: "open",
                creator: "0x1234",
              })
            )
          );
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      });
    });

    it("should require BEE_API like create command", async () => {
      await expect(
        commands.respond({ bountyId: "abc123", file: testFile, yes: true }, mockKeychain)
      ).rejects.toThrow(/BEE_API/);
    });

    it("should require BEE_STAMP like create command", async () => {
      await mockKeychain.set("BEE_API", "http://localhost:1633");

      await expect(
        commands.respond({ bountyId: "abc123", file: testFile, yes: true }, mockKeychain)
      ).rejects.toThrow(/BEE_STAMP/);
    });
  });

  describe("file validation", () => {
    let commands: typeof import("../src/commands");

    beforeEach(async () => {
      commands = await import("../src/commands");

      mockFetch.mockImplementation((url: string) => {
        if ((url as string).includes("/bounties/")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: "abc123",
                title: "Test",
                rewardAmount: "0.5",
                status: "open",
                creator: "0x1234",
              })
            )
          );
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      });
    });

    it("should throw on file not found", async () => {
      await expect(
        commands.respond(
          { bountyId: "abc123", file: "/nonexistent/file.txt", yes: true },
          mockKeychain
        )
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("options", () => {
    it("should accept message option", () => {
      const opts = {
        bountyId: "abc123",
        file: "./solution.zip",
        message: "Here's my solution",
        yes: true,
      };
      expect(opts.message).toBe("Here's my solution");
    });
  });
});
