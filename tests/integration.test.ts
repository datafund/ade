/**
 * Integration tests for CLI entry point and error handling flow.
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { CLIError } from "../src/errors";
import { output, detectFormat } from "../src/format";

describe("integration", () => {
  describe("CLIError flow", () => {
    it("should format error as JSON when format is json", () => {
      const error = new CLIError("ERR_NOT_FOUND", "Resource not found", "Check the ID");
      const json = error.toJSON();

      expect(json.success).toBe(false);
      expect(json.error.code).toBe("ERR_NOT_FOUND");
      expect(json.error.message).toBe("Resource not found");
      expect(json.error.suggestion).toBe("Check the ID");
    });

    it("should format error as human-readable", () => {
      const error = new CLIError("ERR_NOT_FOUND", "Resource not found", "Check the ID");
      const human = error.toHuman();

      expect(human).toContain("error:");
      expect(human).toContain("ERR_NOT_FOUND");
      expect(human).toContain("Resource not found");
      expect(human).toContain("Check the ID");
    });

    it("should have correct exit code for different error types", () => {
      expect(new CLIError("ERR_INVALID_ARGUMENT", "Bad input").exitCode).toBe(1);
      expect(new CLIError("ERR_MISSING_KEY", "No key").exitCode).toBe(2);
      expect(new CLIError("ERR_WRONG_CHAIN", "Wrong chain").exitCode).toBe(3);
      expect(new CLIError("ERR_API_ERROR", "API failed").exitCode).toBe(4);
      expect(new CLIError("ERR_NOT_FOUND", "Not found").exitCode).toBe(4);
      expect(new CLIError("ERR_TX_REVERTED", "Reverted").exitCode).toBe(3);
    });
  });

  describe("output formatting", () => {
    let consoleOutput: string[];
    let originalLog: typeof console.log;

    beforeEach(() => {
      consoleOutput = [];
      originalLog = console.log;
      console.log = (...args: unknown[]) => {
        consoleOutput.push(args.map(String).join(" "));
      };
    });

    afterEach(() => {
      console.log = originalLog;
    });

    it("should output JSON for objects when format is json", () => {
      output({ id: 1, name: "test" }, "json");
      expect(consoleOutput[0]).toContain('"id": 1');
      expect(consoleOutput[0]).toContain('"name": "test"');
    });

    it("should output human-readable for objects when format is human", () => {
      output({ id: 1, name: "test" }, "human");
      expect(consoleOutput.join("\n")).toContain("id");
      expect(consoleOutput.join("\n")).toContain("name");
    });

    it("should output JSON array", () => {
      output([{ id: 1 }, { id: 2 }], "json");
      const parsed = JSON.parse(consoleOutput[0]);
      expect(parsed).toHaveLength(2);
    });

    it("should output table for arrays in human format", () => {
      output([{ id: 1, name: "a" }, { id: 2, name: "b" }], "human");
      const text = consoleOutput.join("\n");
      expect(text).toContain("id");
      expect(text).toContain("name");
    });

    it("should output '(no results)' for empty arrays in human format", () => {
      output([], "human");
      expect(consoleOutput.join("\n")).toContain("(no results)");
    });
  });

  describe("format detection", () => {
    let originalEnv: string | undefined;

    beforeEach(() => {
      originalEnv = process.env.SX_FORMAT;
    });

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.SX_FORMAT = originalEnv;
      } else {
        delete process.env.SX_FORMAT;
      }
    });

    it("should use explicit format when provided", () => {
      expect(detectFormat("json")).toBe("json");
      expect(detectFormat("human")).toBe("human");
    });

    it("should use SX_FORMAT env var", () => {
      process.env.SX_FORMAT = "json";
      expect(detectFormat()).toBe("json");
    });

    it("should ignore invalid SX_FORMAT values", () => {
      process.env.SX_FORMAT = "invalid";
      // Should fall back to TTY detection, which in tests is typically human
      const result = detectFormat();
      expect(["json", "human"]).toContain(result);
    });
  });

  describe("error message clarity", () => {
    it("should provide actionable suggestion for missing key", () => {
      const error = new CLIError("ERR_MISSING_KEY", "SX_KEY not found", "Use: ade set SX_KEY");
      expect(error.suggestion).toContain("ade set SX_KEY");
    });

    it("should provide suggestion for wrong chain", () => {
      const error = new CLIError("ERR_WRONG_CHAIN", "Chain 1 not supported", "Use Base (8453) or Base Sepolia (84532)");
      expect(error.suggestion).toContain("Base");
    });

    it("should mark network errors as retryable", () => {
      const error = new CLIError("ERR_NETWORK_TIMEOUT", "Request timed out");
      expect(error.retryable).toBe(true);
    });

    it("should mark config errors as non-retryable", () => {
      const error = new CLIError("ERR_MISSING_KEY", "No key configured");
      expect(error.retryable).toBe(false);
    });
  });
});

describe("list options parsing", () => {
  it("should handle string limit and offset", async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const commands = await import("../src/commands");
      await commands.skillsList({ limit: "10", offset: "5" });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain("limit=10");
      expect(url).toContain("offset=5");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should clamp limit to valid range", async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const commands = await import("../src/commands");

      // Test max limit - should be capped at 100
      await commands.skillsList({ limit: "1000" });
      let [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain("limit=100"); // Capped at 100

      // Test negative limit - falls back to default (50) due to || 50 in parseInt
      mockFetch.mockClear();
      await commands.skillsList({ limit: "-5" });
      [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain("limit=1"); // Math.max(1, -5) = 1
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should handle invalid limit/offset gracefully", async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const commands = await import("../src/commands");
      await commands.skillsList({ limit: "abc", offset: "xyz" });

      const [url] = mockFetch.mock.calls[0] as [string];
      // Should fall back to defaults
      expect(url).toContain("limit=50");
      expect(url).toContain("offset=0");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
