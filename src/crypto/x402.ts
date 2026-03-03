/**
 * Encryption utilities for x402 micropayments.
 * Implements AES-256-GCM with server-compatible format: IV(12) + authTag(16) + ciphertext.
 *
 * Key difference from escrow.ts:
 *   - Escrow format: IV(12) + ciphertext + authTag(16)
 *   - x402 format:   IV(12) + authTag(16) + ciphertext
 *
 * The x402 format matches what the agents-api x402-download handler expects.
 * No salt or key commitment needed (those are escrow-specific).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH = 32

export interface X402EncryptionResult {
  /** IV(12) + authTag(16) + ciphertext */
  encryptedData: Uint8Array
  /** 32-byte AES-256-GCM key */
  key: Uint8Array
}

/**
 * Encrypt plaintext for x402 micropayment delivery.
 * Generates a random 32-byte AES key and 12-byte IV,
 * encrypts with AES-256-GCM, and packs as IV + authTag + ciphertext.
 *
 * @param plaintext - Data to encrypt (must be non-empty)
 * @returns Encrypted data and key
 * @throws Error if plaintext is empty
 */
export function encryptForX402(plaintext: Uint8Array): X402EncryptionResult {
  if (plaintext.length === 0) {
    throw new Error('Plaintext must not be empty')
  }

  const key = randomBytes(KEY_LENGTH)
  const iv = randomBytes(IV_LENGTH)

  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  // x402 format: IV(12) + authTag(16) + ciphertext
  const encryptedData = new Uint8Array(IV_LENGTH + AUTH_TAG_LENGTH + encrypted.length)
  encryptedData.set(iv, 0)
  encryptedData.set(authTag, IV_LENGTH)
  encryptedData.set(encrypted, IV_LENGTH + AUTH_TAG_LENGTH)

  return {
    encryptedData,
    key: new Uint8Array(key),
  }
}

/**
 * Decrypt x402 data using server-compatible format.
 * Extracts IV(12), authTag(16), and ciphertext from the packed data.
 *
 * @param encryptedData - IV(12) + authTag(16) + ciphertext
 * @param key - 32-byte AES-256-GCM key
 * @returns Decrypted plaintext
 * @throws Error if data is too short or decryption fails
 */
export function decryptFromX402(encryptedData: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Key must be ${KEY_LENGTH} bytes, got ${key.length}`)
  }
  if (encryptedData.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Encrypted data too short')
  }

  const iv = encryptedData.slice(0, IV_LENGTH)
  const authTag = encryptedData.slice(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = encryptedData.slice(IV_LENGTH + AUTH_TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, Buffer.from(key), Buffer.from(iv))
  decipher.setAuthTag(Buffer.from(authTag))

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])

  return new Uint8Array(decrypted)
}
