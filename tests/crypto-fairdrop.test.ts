import { describe, it, expect } from "bun:test";
import {
  generateKeyPair,
  encryptKeyForBuyer,
  decryptKeyAsBuyer,
  serializeEncryptedKey,
  deserializeEncryptedKey,
  publicKeyToAddress,
  publicKeyToHex,
  addressToHex,
  hexToBytes,
} from "../src/crypto/fairdrop";

describe("fairdrop crypto", () => {
  describe("generateKeyPair", () => {
    it("should generate valid keypair", () => {
      const keypair = generateKeyPair();

      expect(keypair.privateKey).toBeInstanceOf(Uint8Array);
      expect(keypair.publicKey).toBeInstanceOf(Uint8Array);
      expect(keypair.privateKey.length).toBe(32);
      expect(keypair.publicKey.length).toBe(33); // compressed
    });

    it("should generate different keypairs each time", () => {
      const keypair1 = generateKeyPair();
      const keypair2 = generateKeyPair();

      expect(Buffer.from(keypair1.privateKey).toString("hex")).not.toBe(
        Buffer.from(keypair2.privateKey).toString("hex")
      );
    });
  });

  describe("ECDH key exchange", () => {
    it("should encrypt and decrypt a key", () => {
      const buyer = generateKeyPair();
      const aesKey = new Uint8Array(32).fill(42);

      const encrypted = encryptKeyForBuyer(aesKey, buyer.publicKey);
      const decrypted = decryptKeyAsBuyer(encrypted, buyer.privateKey);

      expect(Buffer.from(decrypted).equals(Buffer.from(aesKey))).toBe(true);
    });

    it("should produce different ciphertext for same key", () => {
      const buyer = generateKeyPair();
      const aesKey = new Uint8Array(32).fill(42);

      const encrypted1 = encryptKeyForBuyer(aesKey, buyer.publicKey);
      const encrypted2 = encryptKeyForBuyer(aesKey, buyer.publicKey);

      // Different ephemeral keys means different ciphertext
      expect(
        Buffer.from(encrypted1.encryptedKey).toString("hex")
      ).not.toBe(Buffer.from(encrypted2.encryptedKey).toString("hex"));

      // But both should decrypt to same key
      const decrypted1 = decryptKeyAsBuyer(encrypted1, buyer.privateKey);
      const decrypted2 = decryptKeyAsBuyer(encrypted2, buyer.privateKey);
      expect(Buffer.from(decrypted1).equals(Buffer.from(aesKey))).toBe(true);
      expect(Buffer.from(decrypted2).equals(Buffer.from(aesKey))).toBe(true);
    });

    it("should fail with wrong private key", () => {
      const buyer = generateKeyPair();
      const wrongBuyer = generateKeyPair();
      const aesKey = new Uint8Array(32).fill(42);

      const encrypted = encryptKeyForBuyer(aesKey, buyer.publicKey);

      // Decryption with wrong key should throw
      expect(() => {
        decryptKeyAsBuyer(encrypted, wrongBuyer.privateKey);
      }).toThrow();
    });
  });

  describe("serialization", () => {
    it("should serialize and deserialize encrypted key", () => {
      const buyer = generateKeyPair();
      const aesKey = new Uint8Array(32).fill(42);

      const encrypted = encryptKeyForBuyer(aesKey, buyer.publicKey);
      const serialized = serializeEncryptedKey(encrypted);
      const deserialized = deserializeEncryptedKey(serialized);

      // Verify deserialized fields match
      expect(Buffer.from(deserialized.ephemeralPubkey).toString("hex")).toBe(
        Buffer.from(encrypted.ephemeralPubkey).toString("hex")
      );
      expect(Buffer.from(deserialized.iv).toString("hex")).toBe(
        Buffer.from(encrypted.iv).toString("hex")
      );
      expect(Buffer.from(deserialized.encryptedKey).toString("hex")).toBe(
        Buffer.from(encrypted.encryptedKey).toString("hex")
      );

      // Verify decryption still works
      const decrypted = decryptKeyAsBuyer(deserialized, buyer.privateKey);
      expect(Buffer.from(decrypted).equals(Buffer.from(aesKey))).toBe(true);
    });

    it("should throw on invalid serialized data", () => {
      expect(() => {
        deserializeEncryptedKey(new Uint8Array(10)); // Too short
      }).toThrow(/too short/);
    });
  });

  describe("address derivation", () => {
    it("should derive address from public key", () => {
      const keypair = generateKeyPair();
      const address = publicKeyToAddress(keypair.publicKey);

      expect(address).toBeInstanceOf(Uint8Array);
      expect(address.length).toBe(20);
    });

    it("should format address as hex", () => {
      const keypair = generateKeyPair();
      const address = publicKeyToAddress(keypair.publicKey);
      const hex = addressToHex(address);

      expect(hex).toMatch(/^0x[0-9a-f]{40}$/);
    });

    it("should produce consistent addresses", () => {
      const keypair = generateKeyPair();
      const address1 = publicKeyToAddress(keypair.publicKey);
      const address2 = publicKeyToAddress(keypair.publicKey);

      expect(Buffer.from(address1).toString("hex")).toBe(
        Buffer.from(address2).toString("hex")
      );
    });
  });

  describe("hex conversion", () => {
    it("should convert public key to hex", () => {
      const keypair = generateKeyPair();
      const hex = publicKeyToHex(keypair.publicKey);

      expect(hex).toMatch(/^0x[0-9a-f]{66}$/); // 33 bytes = 66 hex chars
    });

    it("should convert hex to bytes", () => {
      const original = new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]);
      const hex = "0x0123456789abcdef";

      const bytes = hexToBytes(hex);
      expect(Buffer.from(bytes).toString("hex")).toBe("0123456789abcdef");
    });

    it("should handle hex without 0x prefix", () => {
      const bytes = hexToBytes("0123456789abcdef");
      expect(Buffer.from(bytes).toString("hex")).toBe("0123456789abcdef");
    });
  });
});
