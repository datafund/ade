import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as keychain from "../../src/keychain";

// Integration tests against real OS keychain
// These tests use a unique prefix to avoid conflicts
const TEST_PREFIX = `ade-test-${Date.now()}`;

describe.skipIf(process.env.CI === "true")("keychain integration", () => {
  const testKey = `${TEST_PREFIX}-key`;

  afterAll(async () => {
    // Cleanup: remove test key
    await keychain.remove(testKey);
  });

  it("should set and get a secret", async () => {
    await keychain.set(testKey, "integration-test-value");
    const value = await keychain.get(testKey);
    expect(value).toBe("integration-test-value");
  });

  it("should list the secret", async () => {
    const keys = await keychain.list();
    expect(keys).toContain(testKey);
  });

  it("should remove the secret", async () => {
    const result = await keychain.remove(testKey);
    expect(result).toBe(true);
    const value = await keychain.get(testKey);
    expect(value).toBeNull();
  });

  it("should return null for non-existent key", async () => {
    const value = await keychain.get(`${TEST_PREFIX}-nonexistent`);
    expect(value).toBeNull();
  });

  it("should return false when removing non-existent key", async () => {
    const result = await keychain.remove(`${TEST_PREFIX}-nonexistent`);
    expect(result).toBe(false);
  });
});
