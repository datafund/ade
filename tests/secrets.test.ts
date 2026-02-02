import { describe, it, expect, beforeEach } from "bun:test";
import { setSecret, getSecret, removeSecret, listSecrets } from "../src/secrets";
import * as mock from "./keychain/mock";

describe("secrets", () => {
  beforeEach(() => {
    mock.clear();
  });

  describe("setSecret", () => {
    it("should store a secret and return success", async () => {
      const result = await setSecret("api-key", "sk-123", mock);
      expect(result).toEqual({ success: true });
    });

    it("should actually store the value in keychain", async () => {
      await setSecret("api-key", "sk-123", mock);
      const value = await mock.get("api-key");
      expect(value).toBe("sk-123");
    });
  });

  describe("getSecret", () => {
    it("should return value when secret exists", async () => {
      await mock.set("my-key", "my-value");
      const result = await getSecret("my-key", mock);
      expect(result).toEqual({ success: true, value: "my-value" });
    });

    it("should return not_found error when secret does not exist", async () => {
      const result = await getSecret("non-existent", mock);
      expect(result).toEqual({ success: false, error: "not_found" });
    });
  });

  describe("removeSecret", () => {
    it("should remove existing secret and return success", async () => {
      await mock.set("to-delete", "value");
      const result = await removeSecret("to-delete", mock);
      expect(result).toEqual({ success: true });
    });

    it("should actually remove the secret from keychain", async () => {
      await mock.set("to-delete", "value");
      await removeSecret("to-delete", mock);
      const value = await mock.get("to-delete");
      expect(value).toBeNull();
    });

    it("should return not_found error when secret does not exist", async () => {
      const result = await removeSecret("non-existent", mock);
      expect(result).toEqual({ success: false, error: "not_found" });
    });
  });

  describe("listSecrets", () => {
    it("should return empty array when no secrets", async () => {
      const result = await listSecrets(mock);
      expect(result).toEqual({ keys: [] });
    });

    it("should return all stored keys", async () => {
      await mock.set("key1", "value1");
      await mock.set("key2", "value2");
      const result = await listSecrets(mock);
      expect(result.keys).toContain("key1");
      expect(result.keys).toContain("key2");
      expect(result.keys.length).toBe(2);
    });
  });
});
