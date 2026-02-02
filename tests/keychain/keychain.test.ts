import { describe, it, expect, beforeEach } from "bun:test";
import * as mock from "./mock";

describe("keychain (mock)", () => {
  beforeEach(() => {
    mock.clear();
  });

  describe("set", () => {
    it("should store a secret", async () => {
      await mock.set("test-key", "test-value");
      const value = await mock.get("test-key");
      expect(value).toBe("test-value");
    });

    it("should overwrite existing secret", async () => {
      await mock.set("test-key", "value1");
      await mock.set("test-key", "value2");
      const value = await mock.get("test-key");
      expect(value).toBe("value2");
    });
  });

  describe("get", () => {
    it("should return null for non-existent key", async () => {
      const value = await mock.get("non-existent");
      expect(value).toBeNull();
    });

    it("should return stored value", async () => {
      await mock.set("my-key", "my-value");
      const value = await mock.get("my-key");
      expect(value).toBe("my-value");
    });
  });

  describe("remove", () => {
    it("should remove existing key and return true", async () => {
      await mock.set("to-remove", "value");
      const result = await mock.remove("to-remove");
      expect(result).toBe(true);
      expect(await mock.get("to-remove")).toBeNull();
    });

    it("should return false for non-existent key", async () => {
      const result = await mock.remove("non-existent");
      expect(result).toBe(false);
    });
  });

  describe("list", () => {
    it("should return empty array when no secrets", async () => {
      const keys = await mock.list();
      expect(keys).toEqual([]);
    });

    it("should return all stored keys", async () => {
      await mock.set("key1", "value1");
      await mock.set("key2", "value2");
      await mock.set("key3", "value3");
      const keys = await mock.list();
      expect(keys).toContain("key1");
      expect(keys).toContain("key2");
      expect(keys).toContain("key3");
      expect(keys.length).toBe(3);
    });
  });
});
