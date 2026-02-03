import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { writeFile, rm, mkdir } from "fs/promises";
import { join } from "path";
import * as mockKeychain from "./keychain/mock";

// Store original fetch
const originalFetch = globalThis.fetch;

describe("sell command", () => {
  let mockFetch: ReturnType<typeof mock>;
  const testDir = join(import.meta.dir, ".test-files");
  const testFile = join(testDir, "test-data.txt");

  beforeEach(async () => {
    mockKeychain.clear();
    mockFetch = mock(() => Promise.resolve(new Response("{}", { status: 200 })));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    // Create test directory and file
    await mkdir(testDir, { recursive: true });
    await writeFile(testFile, "Hello, World! This is test data.");
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.SX_KEY;
    delete process.env.BEE_API;
    delete process.env.BEE_STAMP;

    // Clean up test files
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

    it("should require BEE_API before Swarm operations", async () => {
      // BEE_API is checked after file encryption but before Swarm upload
      await expect(
        commands.sell(
          { file: testFile, price: "0.1", yes: true },
          mockKeychain
        )
      ).rejects.toThrow(/BEE_API/);
    });

    it("should require BEE_STAMP", async () => {
      await mockKeychain.set("BEE_API", "http://localhost:1633");

      await expect(
        commands.sell(
          { file: testFile, price: "0.1", yes: true },
          mockKeychain
        )
      ).rejects.toThrow(/BEE_STAMP/);
    });

    it("should validate BEE_STAMP format", async () => {
      await mockKeychain.set("BEE_API", "http://localhost:1633");
      await mockKeychain.set("BEE_STAMP", "invalid");

      await expect(
        commands.sell(
          { file: testFile, price: "0.1", yes: true },
          mockKeychain
        )
      ).rejects.toThrow(/64 hex/);
    });

    it("should throw on file not found", async () => {
      await expect(
        commands.sell(
          { file: "/nonexistent/path/file.txt", price: "0.1", yes: true },
          mockKeychain
        )
      ).rejects.toThrow(/not found/i);
    });

    it("should require --yes flag in non-TTY mode", async () => {
      // Without --yes flag in non-TTY (test environment)
      await expect(
        commands.sell(
          { file: testFile, price: "0.1", yes: false },
          mockKeychain
        )
      ).rejects.toThrow(/--yes/);
    });

    it("should require SX_KEY for chain operations", async () => {
      await mockKeychain.set("BEE_API", "http://localhost:1633");
      await mockKeychain.set("BEE_STAMP", "a".repeat(64));

      // Mock stamp check and upload to succeed
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/stamps/")) {
          return Promise.resolve(
            new Response(JSON.stringify({ usable: true, depth: 20, amount: "1000" }))
          );
        }
        if (url.includes("/bytes") && !url.includes("/bytes/")) {
          return Promise.resolve(
            new Response(JSON.stringify({ reference: "b".repeat(64) }))
          );
        }
        return Promise.reject(new Error("unexpected call"));
      });

      // Should fail when trying to get chain client (requires SX_KEY)
      await expect(
        commands.sell(
          { file: testFile, price: "0.1", yes: true },
          mockKeychain
        )
      ).rejects.toThrow(/SX_KEY/);
    });

    it("create should be an alias for sell", async () => {
      const commands = await import("../src/commands");
      expect(commands.create).toBe(commands.sell);
    });
  });

  describe("file reading", () => {
    let commands: typeof import("../src/commands");

    beforeEach(async () => {
      commands = await import("../src/commands");
    });

    it("should read file contents", async () => {
      const testKey = "0x" + "1".repeat(64);
      await mockKeychain.set("SX_KEY", testKey);
      await mockKeychain.set("BEE_API", "http://localhost:1633");
      await mockKeychain.set("BEE_STAMP", "a".repeat(64));

      // Mock stamp check to succeed
      const reference = "b".repeat(64);
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/stamps/")) {
          return Promise.resolve(
            new Response(JSON.stringify({ usable: true, depth: 20, amount: "1000" }))
          );
        }
        if (url.includes("/bytes") && !url.includes("/bytes/")) {
          return Promise.resolve(
            new Response(JSON.stringify({ reference }))
          );
        }
        // Default - fail on chain calls (we're testing file reading)
        return Promise.reject(new Error("Chain call not expected in this test"));
      });

      // This will fail when it tries to connect to the chain, but that's OK
      // We're testing that it reads the file correctly
      try {
        await commands.sell(
          { file: testFile, price: "0.1", yes: true },
          mockKeychain
        );
      } catch {
        // Expected to fail on chain connection
      }

      // Verify stamp was checked (means file was read and encrypted first)
      const stampCall = mockFetch.mock.calls.find(
        ([url]) => (url as string).includes("/stamps/")
      );
      expect(stampCall).toBeDefined();
    });
  });

  describe("encryption flow", () => {
    it("should encrypt file before upload", async () => {
      const { encryptForEscrow } = await import("../src/crypto/escrow");

      const original = new TextEncoder().encode("test data");
      const result = encryptForEscrow(original);

      // Verify encryption produces expected structure
      expect(result.key.length).toBe(32);
      expect(result.salt.length).toBe(32);
      expect(result.encryptedData.length).toBeGreaterThan(original.length);
      expect(result.keyCommitment).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });
});
