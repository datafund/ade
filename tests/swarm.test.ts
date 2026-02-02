import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

// Store original fetch
const originalFetch = globalThis.fetch;

describe("swarm", () => {
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    mockFetch = mock(() => Promise.resolve(new Response("{}", { status: 200 })));
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // Helper to set up mock responses
  const setupFetchResponse = (data: unknown, status = 200, statusText = "OK") => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response(
        typeof data === "string" ? data : JSON.stringify(data),
        { status, statusText }
      ))
    );
  };

  const setupFetchError = (message: string) => {
    mockFetch.mockImplementation(() => Promise.reject(new Error(message)));
  };

  describe("uploadToSwarm", () => {
    let swarm: typeof import("../src/swarm");

    beforeEach(async () => {
      swarm = await import("../src/swarm");
    });

    it("should upload data and return reference", async () => {
      const reference = "a".repeat(64);
      setupFetchResponse({ reference });

      const result = await swarm.uploadToSwarm(new Uint8Array([1, 2, 3]), {
        beeApi: "http://localhost:1633",
        batchId: "b".repeat(64),
      });

      expect(result.reference).toBe(reference);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:1633/bytes");
      expect(opts.method).toBe("POST");
      expect(opts.headers).toHaveProperty("swarm-postage-batch-id", "b".repeat(64));
      expect(opts.headers).toHaveProperty("Content-Type", "application/octet-stream");
    });

    it("should normalize reference to lowercase", async () => {
      const reference = "A".repeat(64);
      setupFetchResponse({ reference });

      const result = await swarm.uploadToSwarm(new Uint8Array([1, 2, 3]), {
        beeApi: "http://localhost:1633",
        batchId: "b".repeat(64),
      });

      expect(result.reference).toBe("a".repeat(64));
    });

    it("should strip trailing slash from beeApi", async () => {
      setupFetchResponse({ reference: "a".repeat(64) });

      await swarm.uploadToSwarm(new Uint8Array([1]), {
        beeApi: "http://localhost:1633/",
        batchId: "b".repeat(64),
      });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe("http://localhost:1633/bytes");
    });

    it("should throw on invalid stamp (400)", async () => {
      setupFetchResponse("invalid batch", 400);

      await expect(
        swarm.uploadToSwarm(new Uint8Array([1]), {
          beeApi: "http://localhost:1633",
          batchId: "b".repeat(64),
        })
      ).rejects.toThrow(/stamp/i);
    });

    it("should throw on insufficient funds (402)", async () => {
      setupFetchResponse("payment required", 402);

      await expect(
        swarm.uploadToSwarm(new Uint8Array([1]), {
          beeApi: "http://localhost:1633",
          batchId: "b".repeat(64),
        })
      ).rejects.toThrow(/insufficient/i);
    });

    it("should throw on rate limit (429)", async () => {
      setupFetchResponse("too many requests", 429);

      await expect(
        swarm.uploadToSwarm(new Uint8Array([1]), {
          beeApi: "http://localhost:1633",
          batchId: "b".repeat(64),
        })
      ).rejects.toThrow(/rate/i);
    });

    it("should throw on connection error", async () => {
      setupFetchError("fetch failed");

      await expect(
        swarm.uploadToSwarm(new Uint8Array([1]), {
          beeApi: "http://localhost:1633",
          batchId: "b".repeat(64),
        })
      ).rejects.toThrow(/connect/i);
    });

    it("should throw on invalid reference format", async () => {
      setupFetchResponse({ reference: "invalid" });

      await expect(
        swarm.uploadToSwarm(new Uint8Array([1]), {
          beeApi: "http://localhost:1633",
          batchId: "b".repeat(64),
        })
      ).rejects.toThrow(/reference/i);
    });
  });

  describe("downloadFromSwarm", () => {
    let swarm: typeof import("../src/swarm");

    beforeEach(async () => {
      swarm = await import("../src/swarm");
    });

    it("should download data by reference", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(data, { status: 200 }))
      );

      const reference = "a".repeat(64);
      const result = await swarm.downloadFromSwarm(reference, {
        beeApi: "http://localhost:1633",
      });

      expect(result).toEqual(data);

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe(`http://localhost:1633/bytes/${reference}`);
    });

    it("should throw on invalid reference format", async () => {
      await expect(
        swarm.downloadFromSwarm("invalid", { beeApi: "http://localhost:1633" })
      ).rejects.toThrow(/reference/i);
    });

    it("should throw on not found (404)", async () => {
      setupFetchResponse("not found", 404);

      await expect(
        swarm.downloadFromSwarm("a".repeat(64), { beeApi: "http://localhost:1633" })
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("checkStampValid", () => {
    let swarm: typeof import("../src/swarm");

    beforeEach(async () => {
      swarm = await import("../src/swarm");
    });

    it("should return stamp info for valid stamp", async () => {
      const stampInfo = {
        batchID: "a".repeat(64),
        utilization: 0,
        usable: true,
        depth: 20,
        amount: "10000000",
        blockNumber: 12345,
      };
      setupFetchResponse(stampInfo);

      const result = await swarm.checkStampValid("a".repeat(64), {
        beeApi: "http://localhost:1633",
      });

      expect(result).toEqual(stampInfo);

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe(`http://localhost:1633/stamps/${"a".repeat(64)}`);
    });

    it("should throw on invalid batch ID format", async () => {
      await expect(
        swarm.checkStampValid("invalid", { beeApi: "http://localhost:1633" })
      ).rejects.toThrow(/batch ID/i);
    });

    it("should throw on not found (404)", async () => {
      setupFetchResponse("not found", 404);

      await expect(
        swarm.checkStampValid("a".repeat(64), { beeApi: "http://localhost:1633" })
      ).rejects.toThrow(/not found/i);
    });

    it("should throw on unusable stamp", async () => {
      setupFetchResponse({
        batchID: "a".repeat(64),
        usable: false,
        depth: 20,
        amount: "0",
      });

      await expect(
        swarm.checkStampValid("a".repeat(64), { beeApi: "http://localhost:1633" })
      ).rejects.toThrow(/not usable/i);
    });
  });

  describe("pingBeeNode", () => {
    let swarm: typeof import("../src/swarm");

    beforeEach(async () => {
      swarm = await import("../src/swarm");
    });

    it("should return true for healthy node", async () => {
      setupFetchResponse({ status: "ok" });

      const result = await swarm.pingBeeNode("http://localhost:1633");

      expect(result).toBe(true);

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe("http://localhost:1633/health");
    });

    it("should return false on error", async () => {
      setupFetchError("connection refused");

      const result = await swarm.pingBeeNode("http://localhost:1633");

      expect(result).toBe(false);
    });

    it("should return false on non-200 status", async () => {
      setupFetchResponse("error", 500);

      const result = await swarm.pingBeeNode("http://localhost:1633");

      expect(result).toBe(false);
    });
  });
});
