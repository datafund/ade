import { describe, it, expect } from "bun:test";
import { getVersion } from "../src/update";

describe("update", () => {
  describe("getVersion", () => {
    it("should return current version", () => {
      const version = getVersion();
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it("should return 0.1.0 as initial version", () => {
      const version = getVersion();
      expect(version).toBe("0.1.0");
    });
  });

  // Note: update() function makes real HTTP requests and modifies files
  // Integration tests for update should be done separately with mocked fetch
});
