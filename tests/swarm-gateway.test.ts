import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { uploadToSwarm, downloadFromSwarm, SWARM_GATEWAY } from "../src/swarm";

/**
 * Integration tests for Swarm gateway.
 * Uses the FDS public gateway (no Bee node or postage stamp required).
 *
 * These tests hit the real gateway - use sparingly to avoid rate limits.
 */
describe("swarm gateway integration", () => {
  const testData = new TextEncoder().encode(`Test data from ade tests ${Date.now()}`);
  let swarmRef: string;

  describe("upload", () => {
    it("should upload to gateway without postage stamp", async () => {
      const result = await uploadToSwarm(testData, {
        beeApi: SWARM_GATEWAY,
        // No batchId - gateway handles this
      });

      expect(result.reference).toMatch(/^[0-9a-f]{64}$/);
      swarmRef = result.reference;
    }, 30_000); // 30s timeout for network
  });

  describe("download", () => {
    it("should download from gateway", async () => {
      // Skip if upload didn't succeed
      if (!swarmRef) {
        console.warn("Skipping download test - no swarmRef from upload");
        return;
      }

      const downloaded = await downloadFromSwarm(swarmRef, {
        beeApi: SWARM_GATEWAY,
      });

      expect(downloaded).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(downloaded)).toBe(new TextDecoder().decode(testData));
    }, 30_000);
  });

  describe("round-trip encryption", () => {
    it("should encrypt, upload, download, and decrypt", async () => {
      const { encryptForEscrow, decryptFromEscrow } = await import("../src/crypto/escrow");

      // Original data
      const original = new TextEncoder().encode("Sensitive escrow data for testing");

      // Encrypt
      const { encryptedData, key, salt } = encryptForEscrow(original);

      // Upload encrypted data
      const uploadResult = await uploadToSwarm(encryptedData, {
        beeApi: SWARM_GATEWAY,
      });
      expect(uploadResult.reference).toMatch(/^[0-9a-f]{64}$/);

      // Download encrypted data
      const downloaded = await downloadFromSwarm(uploadResult.reference, {
        beeApi: SWARM_GATEWAY,
      });

      // Decrypt
      const decrypted = decryptFromEscrow({
        encryptedData: downloaded,
        key,
        salt,
      });

      // Verify
      expect(new TextDecoder().decode(decrypted)).toBe("Sensitive escrow data for testing");
    }, 60_000);
  });
});
