import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { apiFetch, apiPost, getBaseUrl } from "../src/api";
import { CLIError } from "../src/errors";

// Mock fetch for all tests
const originalFetch = globalThis.fetch;

describe("api", () => {
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    mockFetch = mock(() => Promise.resolve(new Response("{}", { status: 200 })));
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.SX_API;
  });

  describe("getBaseUrl", () => {
    it("should return default URL when SX_API not set", () => {
      delete process.env.SX_API;
      expect(getBaseUrl()).toBe("https://agents.datafund.io");
    });

    it("should return custom URL from SX_API env var", () => {
      process.env.SX_API = "https://custom.api.com";
      expect(getBaseUrl()).toBe("https://custom.api.com");
    });

    it("should trim whitespace from SX_API", () => {
      process.env.SX_API = "  https://api.test.com  ";
      expect(getBaseUrl()).toBe("https://api.test.com");
    });
  });

  describe("apiFetch", () => {
    it("should make GET request to correct URL", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('{"data":"test"}', { status: 200 }))
      );

      const result = await apiFetch("/skills");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://agents.datafund.io/api/v1/skills");
      expect(opts.headers).toEqual({ "Content-Type": "application/json" });
    });

    it("should return parsed JSON response", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('{"id":1,"name":"test"}', { status: 200 }))
      );

      const result = await apiFetch<{ id: number; name: string }>("/test");
      expect(result).toEqual({ id: 1, name: "test" });
    });

    it("should throw ERR_NOT_FOUND for 404", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response("", { status: 404 }))
      );

      try {
        await apiFetch("/missing");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CLIError);
        expect((err as CLIError).code).toBe("ERR_NOT_FOUND");
      }
    });

    it("should throw ERR_RATE_LIMITED for 429", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response("", { status: 429 }))
      );

      try {
        await apiFetch("/limited");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CLIError);
        expect((err as CLIError).code).toBe("ERR_RATE_LIMITED");
        expect((err as CLIError).retryable).toBe(true);
      }
    });

    it("should throw ERR_API_ERROR for other HTTP errors", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response("Server Error", { status: 500 }))
      );

      try {
        await apiFetch("/error");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CLIError);
        expect((err as CLIError).code).toBe("ERR_API_ERROR");
        expect((err as CLIError).message).toContain("500");
      }
    });

    it("should throw ERR_NETWORK_TIMEOUT on timeout", async () => {
      mockFetch.mockImplementation(() => {
        const error = new DOMException("Timeout", "TimeoutError");
        return Promise.reject(error);
      });

      try {
        await apiFetch("/slow");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CLIError);
        expect((err as CLIError).code).toBe("ERR_NETWORK_TIMEOUT");
        expect((err as CLIError).retryable).toBe(true);
      }
    });

    it("should throw ERR_API_ERROR on network error", async () => {
      mockFetch.mockImplementation(() =>
        Promise.reject(new Error("Connection refused"))
      );

      try {
        await apiFetch("/unreachable");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CLIError);
        expect((err as CLIError).code).toBe("ERR_API_ERROR");
        expect((err as CLIError).message).toContain("Connection refused");
      }
    });
  });

  describe("apiPost", () => {
    it("should make POST request with body", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('{"success":true}', { status: 200 }))
      );

      await apiPost("/create", { title: "test" });

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(opts.method).toBe("POST");
      expect(opts.body).toBe('{"title":"test"}');
    });

    it("should add auth headers when privateKey provided", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('{"success":true}', { status: 200 }))
      );

      // Use a valid test private key
      const testKey = "0x1234567890123456789012345678901234567890123456789012345678901234";
      await apiPost("/vote", { direction: "up" }, testKey as `0x${string}`);

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers["X-Address"]).toBeDefined();
      expect(headers["X-Address"]).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(headers["X-Signature"]).toBeDefined();
      expect(headers["X-Timestamp"]).toBeDefined();
      expect(parseInt(headers["X-Timestamp"])).toBeGreaterThan(0);
    });

    it("should not add auth headers when no privateKey", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('{"success":true}', { status: 200 }))
      );

      await apiPost("/public", { data: "test" });

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers["X-Address"]).toBeUndefined();
      expect(headers["X-Signature"]).toBeUndefined();
    });
  });
});
