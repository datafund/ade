import { describe, it, expect } from "bun:test";
import {
  encryptForEscrow,
  decryptFromEscrow,
  computeKeyCommitment,
  verifyKeyCommitment,
} from "../src/crypto/escrow";

describe("crypto/escrow", () => {
  describe("encryptForEscrow", () => {
    it("should encrypt empty data", () => {
      const plaintext = new Uint8Array(0);
      const result = encryptForEscrow(plaintext);

      expect(result.key.length).toBe(32);
      expect(result.salt.length).toBe(32);
      expect(result.encryptedData.length).toBe(12 + 16); // IV + authTag, no ciphertext
      expect(result.keyCommitment).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("should encrypt small data", () => {
      const plaintext = new TextEncoder().encode("Hello, World!");
      const result = encryptForEscrow(plaintext);

      expect(result.key.length).toBe(32);
      expect(result.salt.length).toBe(32);
      expect(result.encryptedData.length).toBeGreaterThan(12 + 16); // IV + ciphertext + authTag
      expect(result.keyCommitment).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("should encrypt 1KB data", () => {
      const plaintext = new Uint8Array(1024).fill(0x42);
      const result = encryptForEscrow(plaintext);

      expect(result.key.length).toBe(32);
      expect(result.encryptedData.length).toBe(12 + 1024 + 16);
    });

    it("should encrypt 1MB data", () => {
      const plaintext = new Uint8Array(1024 * 1024).fill(0x42);
      const result = encryptForEscrow(plaintext);

      expect(result.key.length).toBe(32);
      expect(result.encryptedData.length).toBe(12 + 1024 * 1024 + 16);
    });

    it("should generate unique keys and IVs each time", () => {
      const plaintext = new TextEncoder().encode("test");
      const result1 = encryptForEscrow(plaintext);
      const result2 = encryptForEscrow(plaintext);

      // Keys should be different
      expect(result1.key).not.toEqual(result2.key);
      expect(result1.salt).not.toEqual(result2.salt);

      // Encrypted data should be different (different IV)
      expect(result1.encryptedData).not.toEqual(result2.encryptedData);

      // Key commitments should be different
      expect(result1.keyCommitment).not.toBe(result2.keyCommitment);
    });
  });

  describe("decryptFromEscrow", () => {
    it("should decrypt to original plaintext", () => {
      const original = new TextEncoder().encode("Hello, World!");
      const { encryptedData, key } = encryptForEscrow(original);

      const decrypted = decryptFromEscrow({ encryptedData, key });

      expect(decrypted).toEqual(original);
    });

    it("should decrypt empty data", () => {
      const original = new Uint8Array(0);
      const { encryptedData, key } = encryptForEscrow(original);

      const decrypted = decryptFromEscrow({ encryptedData, key });

      expect(decrypted).toEqual(original);
    });

    it("should decrypt 1MB data", () => {
      const original = new Uint8Array(1024 * 1024);
      for (let i = 0; i < original.length; i++) {
        original[i] = i % 256;
      }
      const { encryptedData, key } = encryptForEscrow(original);

      const decrypted = decryptFromEscrow({ encryptedData, key });

      expect(decrypted).toEqual(original);
    });

    it("should fail with wrong key", () => {
      const original = new TextEncoder().encode("secret data");
      const { encryptedData } = encryptForEscrow(original);

      const wrongKey = new Uint8Array(32).fill(0x00);

      expect(() => {
        decryptFromEscrow({ encryptedData, key: wrongKey });
      }).toThrow();
    });

    it("should fail with corrupted ciphertext", () => {
      const original = new TextEncoder().encode("secret data");
      const { encryptedData, key } = encryptForEscrow(original);

      // Corrupt a byte in the middle
      const corrupted = new Uint8Array(encryptedData);
      corrupted[20] ^= 0xff;

      expect(() => {
        decryptFromEscrow({ encryptedData: corrupted, key });
      }).toThrow();
    });

    it("should fail with truncated data", () => {
      const original = new TextEncoder().encode("secret data");
      const { encryptedData, key } = encryptForEscrow(original);

      // Truncate data
      const truncated = encryptedData.slice(0, encryptedData.length - 10);

      expect(() => {
        decryptFromEscrow({ encryptedData: truncated, key });
      }).toThrow();
    });

    it("should fail with data too short", () => {
      expect(() => {
        decryptFromEscrow({
          encryptedData: new Uint8Array(10), // Less than IV + authTag
          key: new Uint8Array(32),
        });
      }).toThrow("Encrypted data too short");
    });
  });

  describe("computeKeyCommitment", () => {
    it("should return hex string", () => {
      const key = new Uint8Array(32).fill(0x42);
      const salt = new Uint8Array(32).fill(0x43);

      const commitment = computeKeyCommitment(key, salt);

      expect(commitment).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("should be deterministic", () => {
      const key = new Uint8Array(32).fill(0x42);
      const salt = new Uint8Array(32).fill(0x43);

      const commitment1 = computeKeyCommitment(key, salt);
      const commitment2 = computeKeyCommitment(key, salt);

      expect(commitment1).toBe(commitment2);
    });

    it("should differ with different salt", () => {
      const key = new Uint8Array(32).fill(0x42);
      const salt1 = new Uint8Array(32).fill(0x43);
      const salt2 = new Uint8Array(32).fill(0x44);

      const commitment1 = computeKeyCommitment(key, salt1);
      const commitment2 = computeKeyCommitment(key, salt2);

      expect(commitment1).not.toBe(commitment2);
    });

    it("should differ with different key", () => {
      const key1 = new Uint8Array(32).fill(0x42);
      const key2 = new Uint8Array(32).fill(0x43);
      const salt = new Uint8Array(32).fill(0x44);

      const commitment1 = computeKeyCommitment(key1, salt);
      const commitment2 = computeKeyCommitment(key2, salt);

      expect(commitment1).not.toBe(commitment2);
    });
  });

  describe("verifyKeyCommitment", () => {
    it("should verify correct commitment", () => {
      const { key, salt, keyCommitment } = encryptForEscrow(new Uint8Array(100));

      expect(verifyKeyCommitment(key, salt, keyCommitment)).toBe(true);
    });

    it("should reject wrong key", () => {
      const { salt, keyCommitment } = encryptForEscrow(new Uint8Array(100));
      const wrongKey = new Uint8Array(32).fill(0x00);

      expect(verifyKeyCommitment(wrongKey, salt, keyCommitment)).toBe(false);
    });

    it("should reject wrong salt", () => {
      const { key, keyCommitment } = encryptForEscrow(new Uint8Array(100));
      const wrongSalt = new Uint8Array(32).fill(0x00);

      expect(verifyKeyCommitment(key, wrongSalt, keyCommitment)).toBe(false);
    });

    it("should be case insensitive for commitment", () => {
      const { key, salt, keyCommitment } = encryptForEscrow(new Uint8Array(100));

      expect(verifyKeyCommitment(key, salt, keyCommitment.toUpperCase() as `0x${string}`)).toBe(true);
      expect(verifyKeyCommitment(key, salt, keyCommitment.toLowerCase() as `0x${string}`)).toBe(true);
    });
  });

  describe("roundtrip integration", () => {
    it("should encrypt and decrypt various data types", () => {
      const testCases = [
        new Uint8Array(0), // Empty
        new TextEncoder().encode("text"), // Small text
        new Uint8Array(1000).fill(0xff), // Binary data
        new TextEncoder().encode(JSON.stringify({ key: "value", nested: { array: [1, 2, 3] } })), // JSON
      ];

      for (const original of testCases) {
        const { encryptedData, key, salt, keyCommitment } = encryptForEscrow(original);

        // Verify commitment
        expect(verifyKeyCommitment(key, salt, keyCommitment)).toBe(true);

        // Verify decryption
        const decrypted = decryptFromEscrow({ encryptedData, key });
        expect(decrypted).toEqual(original);
      }
    });
  });
});
