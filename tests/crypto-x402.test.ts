import { describe, it, expect } from "bun:test"
import { createDecipheriv } from "crypto"
import { encryptForX402, decryptFromX402 } from "../src/crypto/x402"
import { encryptForEscrow, decryptFromEscrow } from "../src/crypto/escrow"

const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const HEADER_LENGTH = IV_LENGTH + AUTH_TAG_LENGTH // 28

describe("crypto/x402", () => {
  describe("encryptForX402", () => {
    it("should round-trip: encrypt then decrypt returns original data", () => {
      const original = new TextEncoder().encode("Hello, x402 micropayments!")
      const { encryptedData, key } = encryptForX402(original)

      const decrypted = decryptFromX402(encryptedData, key)

      expect(decrypted).toEqual(original)
    })

    it("should produce correct format: IV(12) + authTag(16) + ciphertext", () => {
      const plaintext = new TextEncoder().encode("test data")
      const { encryptedData } = encryptForX402(plaintext)

      // Total length = IV(12) + authTag(16) + ciphertext(same length as plaintext for GCM)
      expect(encryptedData.length).toBe(HEADER_LENGTH + plaintext.length)

      // First 12 bytes = IV (non-zero, random)
      const iv = encryptedData.slice(0, IV_LENGTH)
      expect(iv.length).toBe(IV_LENGTH)

      // Bytes 12-28 = authTag
      const authTag = encryptedData.slice(IV_LENGTH, HEADER_LENGTH)
      expect(authTag.length).toBe(AUTH_TAG_LENGTH)

      // Remaining bytes = ciphertext
      const ciphertext = encryptedData.slice(HEADER_LENGTH)
      expect(ciphertext.length).toBe(plaintext.length)
    })

    it("should use different format than escrow: IV+tag+ct vs IV+ct+tag", () => {
      const plaintext = new TextEncoder().encode("format comparison test")
      const x402Result = encryptForX402(plaintext)
      const escrowResult = encryptForEscrow(plaintext)

      // Both should be same total length
      expect(x402Result.encryptedData.length).toBe(escrowResult.encryptedData.length)

      // Escrow format: IV(12) + ciphertext + authTag(16)
      // x402 format:   IV(12) + authTag(16) + ciphertext
      // The auth tag position differs, so verify by extracting and cross-decrypting

      // Extract escrow authTag (last 16 bytes)
      const escrowAuthTag = escrowResult.encryptedData.slice(
        escrowResult.encryptedData.length - AUTH_TAG_LENGTH,
      )
      // Extract escrow ciphertext (between IV and authTag)
      const escrowCiphertext = escrowResult.encryptedData.slice(
        IV_LENGTH,
        escrowResult.encryptedData.length - AUTH_TAG_LENGTH,
      )

      // Extract x402 authTag (bytes 12-28)
      const x402AuthTag = x402Result.encryptedData.slice(IV_LENGTH, HEADER_LENGTH)
      // Extract x402 ciphertext (after byte 28)
      const x402Ciphertext = x402Result.encryptedData.slice(HEADER_LENGTH)

      // Both authTags should be 16 bytes
      expect(escrowAuthTag.length).toBe(AUTH_TAG_LENGTH)
      expect(x402AuthTag.length).toBe(AUTH_TAG_LENGTH)

      // Both ciphertexts should equal plaintext length
      expect(escrowCiphertext.length).toBe(plaintext.length)
      expect(x402Ciphertext.length).toBe(plaintext.length)

      // Prove format incompatibility: x402 data fails with escrow decryptor
      expect(() => {
        decryptFromEscrow({ encryptedData: x402Result.encryptedData, key: x402Result.key })
      }).toThrow()

      // Prove format incompatibility: escrow data fails with x402 decryptor
      expect(() => {
        decryptFromX402(escrowResult.encryptedData, escrowResult.key)
      }).toThrow()
    })

    it("should fail to decrypt with wrong key", () => {
      const plaintext = new TextEncoder().encode("secret data")
      const { encryptedData } = encryptForX402(plaintext)

      const wrongKey = new Uint8Array(32).fill(0x00)

      expect(() => {
        decryptFromX402(encryptedData, wrongKey)
      }).toThrow()
    })

    it("should throw on empty data", () => {
      const empty = new Uint8Array(0)

      expect(() => {
        encryptForX402(empty)
      }).toThrow()
    })

    it("should generate different keys for same data", () => {
      const plaintext = new TextEncoder().encode("same data twice")
      const result1 = encryptForX402(plaintext)
      const result2 = encryptForX402(plaintext)

      expect(result1.key).not.toEqual(result2.key)
      expect(result1.encryptedData).not.toEqual(result2.encryptedData)
    })
  })

  describe("decryptFromX402", () => {
    it("should throw on wrong key length", () => {
      const plaintext = new TextEncoder().encode("key length test")
      const { encryptedData } = encryptForX402(plaintext)

      const shortKey = new Uint8Array(16)
      expect(() => {
        decryptFromX402(encryptedData, shortKey)
      }).toThrow("Key must be 32 bytes, got 16")
    })

    it("should throw on data shorter than 28 bytes", () => {
      const tooShort = new Uint8Array(27) // Less than IV(12) + authTag(16)
      const key = new Uint8Array(32)

      expect(() => {
        decryptFromX402(tooShort, key)
      }).toThrow("Encrypted data too short")
    })

    it("should fail on corrupted ciphertext", () => {
      const plaintext = new TextEncoder().encode("tamper test data")
      const { encryptedData, key } = encryptForX402(plaintext)

      // Corrupt a byte in the ciphertext region (after header)
      const corrupted = new Uint8Array(encryptedData)
      corrupted[HEADER_LENGTH + 2] ^= 0xff

      expect(() => {
        decryptFromX402(corrupted, key)
      }).toThrow()
    })

    it("should be cross-compatible with server format: manual decrypt using same layout", () => {
      const original = new TextEncoder().encode("cross-compatibility test")
      const { encryptedData, key } = encryptForX402(original)

      // Manually extract components using the server's expected layout:
      // IV(12) + authTag(16) + ciphertext
      const iv = encryptedData.slice(0, IV_LENGTH)
      const authTag = encryptedData.slice(IV_LENGTH, HEADER_LENGTH)
      const ciphertext = encryptedData.slice(HEADER_LENGTH)

      // Decrypt manually using Node.js crypto (same as server would)
      const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(iv))
      decipher.setAuthTag(Buffer.from(authTag))
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])

      expect(new Uint8Array(decrypted)).toEqual(original)
    })
  })

  describe("roundtrip integration", () => {
    it("should encrypt and decrypt various data sizes", () => {
      const testCases = [
        new TextEncoder().encode("x"), // 1 byte
        new TextEncoder().encode("short text"), // Small
        new Uint8Array(1000).fill(0xff), // 1KB binary
        new Uint8Array(1024 * 100).fill(0x42), // 100KB
        new TextEncoder().encode(
          JSON.stringify({ key: "value", nested: { array: [1, 2, 3] } }),
        ), // JSON
      ]

      for (const original of testCases) {
        const { encryptedData, key } = encryptForX402(original)
        const decrypted = decryptFromX402(encryptedData, key)
        expect(decrypted).toEqual(original)
      }
    })
  })
})
