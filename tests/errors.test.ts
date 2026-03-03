import { describe, it, expect } from "bun:test";
import { CLIError, type ErrorCode } from "../src/errors";

describe("CLIError", () => {
  describe("constructor", () => {
    it("should create error with code, message, and exitCode", () => {
      const err = new CLIError("ERR_MISSING_KEY", "Key not found");
      expect(err.code).toBe("ERR_MISSING_KEY");
      expect(err.message).toBe("Key not found");
      expect(err.exitCode).toBe(2);
      expect(err.name).toBe("CLIError");
    });

    it("should include optional suggestion", () => {
      const err = new CLIError("ERR_MISSING_RPC", "RPC not set", "Set SX_RPC");
      expect(err.suggestion).toBe("Set SX_RPC");
    });

    it("should mark network errors as retryable", () => {
      const retryable: ErrorCode[] = [
        "ERR_GAS_TOO_HIGH",
        "ERR_RATE_LIMITED",
        "ERR_NETWORK_TIMEOUT",
        "ERR_API_ERROR",
      ];
      for (const code of retryable) {
        const err = new CLIError(code, "test");
        expect(err.retryable).toBe(true);
      }
    });

    it("should mark config errors as non-retryable", () => {
      const nonRetryable: ErrorCode[] = [
        "ERR_INVALID_ADDRESS",
        "ERR_INVALID_ARGUMENT",
        "ERR_MISSING_KEY",
        "ERR_MISSING_RPC",
        "ERR_MISSING_TOKEN",
        "ERR_CONFIRMATION_REQUIRED",
        "ERR_INVALID_SIGNATURE",
        "ERR_WRONG_CHAIN",
        "ERR_INSUFFICIENT_BALANCE",
        "ERR_TX_REVERTED",
        "ERR_NOT_FOUND",
      ];
      for (const code of nonRetryable) {
        const err = new CLIError(code, "test");
        expect(err.retryable).toBe(false);
      }
    });
  });

  describe("exit codes", () => {
    it("should use exit code 1 for invalid input errors", () => {
      expect(new CLIError("ERR_INVALID_ADDRESS", "").exitCode).toBe(1);
      expect(new CLIError("ERR_INVALID_ARGUMENT", "").exitCode).toBe(1);
      expect(new CLIError("ERR_CONFIRMATION_REQUIRED", "").exitCode).toBe(1);
    });

    it("should use exit code 2 for config errors", () => {
      expect(new CLIError("ERR_MISSING_KEY", "").exitCode).toBe(2);
      expect(new CLIError("ERR_MISSING_RPC", "").exitCode).toBe(2);
      expect(new CLIError("ERR_MISSING_TOKEN", "").exitCode).toBe(2);
      expect(new CLIError("ERR_INVALID_SIGNATURE", "").exitCode).toBe(2);
    });

    it("should use exit code 3 for chain errors", () => {
      expect(new CLIError("ERR_WRONG_CHAIN", "").exitCode).toBe(3);
      expect(new CLIError("ERR_INSUFFICIENT_BALANCE", "").exitCode).toBe(3);
      expect(new CLIError("ERR_GAS_TOO_HIGH", "").exitCode).toBe(3);
      expect(new CLIError("ERR_TX_REVERTED", "").exitCode).toBe(3);
    });

    it("should use exit code 4 for network/API errors", () => {
      expect(new CLIError("ERR_NOT_FOUND", "").exitCode).toBe(4);
      expect(new CLIError("ERR_RATE_LIMITED", "").exitCode).toBe(4);
      expect(new CLIError("ERR_NETWORK_TIMEOUT", "").exitCode).toBe(4);
      expect(new CLIError("ERR_API_ERROR", "").exitCode).toBe(4);
    });
  });

  describe("toJSON", () => {
    it("should return structured error object", () => {
      const err = new CLIError("ERR_NOT_FOUND", "Resource missing");
      expect(err.toJSON()).toEqual({
        success: false,
        error: {
          code: "ERR_NOT_FOUND",
          message: "Resource missing",
          retryable: false,
          suggestion: null,
          retryAfterSeconds: null,
          suggestedCommand: null,
        },
      });
    });

    it("should include suggestion when present", () => {
      const err = new CLIError("ERR_MISSING_KEY", "Key not set", "Use ade set SX_KEY");
      const json = err.toJSON();
      expect(json.error.suggestion).toBe("Use ade set SX_KEY");
    });
  });

  describe("toHuman", () => {
    it("should format error for human output", () => {
      const err = new CLIError("ERR_NOT_FOUND", "Skill not found");
      expect(err.toHuman()).toBe("error: ERR_NOT_FOUND — Skill not found");
    });

    it("should append suggestion when present", () => {
      const err = new CLIError("ERR_MISSING_KEY", "Key not set", "Use ade set SX_KEY");
      expect(err.toHuman()).toBe("error: ERR_MISSING_KEY — Key not set. Use ade set SX_KEY");
    });
  });
});
