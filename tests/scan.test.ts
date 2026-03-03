import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { writeFile, rm, mkdir } from "fs/promises";
import { join } from "path";
import * as mockKeychain from "./keychain/mock";

const originalFetch = globalThis.fetch;

describe("scan-bounties command", () => {
  let mockFetch: ReturnType<typeof mock>;
  const testDir = join(import.meta.dir, ".test-scan-files");

  beforeEach(async () => {
    mockKeychain.clear();
    await mkdir(testDir, { recursive: true });
    // Create test files
    await writeFile(join(testDir, "climate-research.csv"), "data");
    await writeFile(join(testDir, "ml-dataset.json"), "data");
    await writeFile(join(testDir, "vacation-photos.jpg"), "data");
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.SX_KEY;
    try {
      await rm(testDir, { recursive: true });
    } catch {}
  });

  describe("scoring and matching", () => {
    let scanModule: typeof import("../src/scan");

    beforeEach(async () => {
      scanModule = await import("../src/scan");
    });

    it("should match files with bounty terms", async () => {
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              bounties: [
                {
                  id: "b1",
                  title: "Climate Research Data",
                  description: "Looking for climate datasets",
                  rewardAmount: "0.1",
                  tags: ["climate", "research"],
                  category: "research",
                  status: "open",
                  creator: "0x123",
                },
              ],
            }),
            { status: 200 }
          )
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await scanModule.scanBounties(
        { dir: testDir },
        mockKeychain
      );

      expect(result.scanned).toBeGreaterThan(0);
      // climate-research.csv should match "Climate Research Data" bounty
      const climateMatch = result.matches.find(
        (m) => m.file === "climate-research.csv"
      );
      expect(climateMatch).toBeDefined();
      expect(climateMatch!.score).toBeGreaterThan(0);
      expect(climateMatch!.matchedTerms.length).toBeGreaterThan(0);
    });

    it("should score zero for unrelated files", async () => {
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              bounties: [
                {
                  id: "b1",
                  title: "Blockchain Transaction Analysis",
                  description: "Need blockchain data",
                  rewardAmount: "0.5",
                  tags: ["blockchain", "transactions"],
                  category: "data",
                  status: "open",
                  creator: "0x123",
                },
              ],
            }),
            { status: 200 }
          )
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await scanModule.scanBounties(
        { dir: testDir, minScore: 0.5 },
        mockKeychain
      );

      // vacation-photos.jpg should not match blockchain bounty at 0.5 threshold
      const photoMatch = result.matches.find(
        (m) => m.file === "vacation-photos.jpg"
      );
      expect(photoMatch).toBeUndefined();
    });

    it("should handle empty bounties response", async () => {
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ bounties: [] }), { status: 200 })
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await scanModule.scanBounties(
        { dir: testDir },
        mockKeychain
      );

      expect(result.matches).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.scanned).toBeGreaterThan(0);
    });
  });

  describe("security filters", () => {
    let scanModule: typeof import("../src/scan");

    beforeEach(async () => {
      scanModule = await import("../src/scan");
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ bounties: [] }), { status: 200 })
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;
    });

    it("should exclude hidden files", async () => {
      await writeFile(join(testDir, ".hidden-file"), "secret");
      const result = await scanModule.scanBounties(
        { dir: testDir },
        mockKeychain
      );
      expect(result.excluded).toBeGreaterThan(0);
    });

    it("should exclude sensitive file patterns by default", async () => {
      await writeFile(join(testDir, "secret.env"), "SECRET=foo");
      await writeFile(join(testDir, "server.pem"), "-----BEGIN-----");
      await writeFile(join(testDir, "id_rsa_backup"), "key");

      const result = await scanModule.scanBounties(
        { dir: testDir },
        mockKeychain
      );
      expect(result.excluded).toBeGreaterThanOrEqual(3);
    });

    it("should apply user exclude patterns", async () => {
      await writeFile(join(testDir, "notes.txt"), "notes");
      const result = await scanModule.scanBounties(
        { dir: testDir, exclude: "*.txt" },
        mockKeychain
      );
      // notes.txt should be excluded
      expect(result.excluded).toBeGreaterThan(0);
    });
  });

  describe("respond mode safety", () => {
    let scanModule: typeof import("../src/scan");

    beforeEach(async () => {
      scanModule = await import("../src/scan");
    });

    it("should require --max-value with --respond --yes", async () => {
      await expect(
        scanModule.scanBounties(
          { dir: testDir, respond: true, yes: true },
          mockKeychain
        )
      ).rejects.toThrow(/--max-value/);
    });

    it("should force minScore 0.5 in --respond --yes mode", async () => {
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              bounties: [
                {
                  id: "b1",
                  title: "Test Bounty",
                  description: "",
                  rewardAmount: "0.01",
                  tags: [],
                  category: "other",
                  status: "open",
                  creator: "0x123",
                },
              ],
            }),
            { status: 200 }
          )
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await scanModule.scanBounties(
        {
          dir: testDir,
          respond: true,
          yes: true,
          maxValue: "0.01",
          minScore: 0.1,
        },
        mockKeychain
      );

      // minScore should be forced to 0.5, not 0.1
      expect(result.minScore).toBeGreaterThanOrEqual(0.5);
    });
  });
});
