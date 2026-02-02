/**
 * Encryption utilities for data escrow.
 * Implements AES-256-GCM encryption with keccak256 key commitment.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { keccak256, concat, toHex, type Hex } from 'viem'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH = 32
const SALT_LENGTH = 32

export interface EncryptionResult {
  /** IV (12B) + ciphertext + authTag (16B) */
  encryptedData: Uint8Array
  /** 32-byte encryption key */
  key: Uint8Array
  /** 32-byte salt for key commitment */
  salt: Uint8Array
  /** keccak256(key || salt) */
  keyCommitment: Hex
}

export interface DecryptionInput {
  encryptedData: Uint8Array
  key: Uint8Array
}

/**
 * Encrypt plaintext for escrow.
 * Generates random key and salt, computes key commitment.
 *
 * @param plaintext - Data to encrypt
 * @returns Encrypted data, key, salt, and key commitment
 */
export function encryptForEscrow(plaintext: Uint8Array): EncryptionResult {
  // Generate random key, salt, and IV
  const key = randomBytes(KEY_LENGTH)
  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)

  // Encrypt with AES-256-GCM
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  // Combine IV + ciphertext + authTag
  const encryptedData = new Uint8Array(IV_LENGTH + encrypted.length + AUTH_TAG_LENGTH)
  encryptedData.set(iv, 0)
  encryptedData.set(encrypted, IV_LENGTH)
  encryptedData.set(authTag, IV_LENGTH + encrypted.length)

  // Compute key commitment
  const keyCommitment = computeKeyCommitment(key, salt)

  return {
    encryptedData,
    key: new Uint8Array(key),
    salt: new Uint8Array(salt),
    keyCommitment,
  }
}

/**
 * Compute key commitment for escrow.
 * This locks the seller to a specific key.
 *
 * @param key - 32-byte encryption key
 * @param salt - 32-byte salt
 * @returns keccak256(key || salt)
 */
export function computeKeyCommitment(key: Uint8Array, salt: Uint8Array): Hex {
  const keyHex = toHex(key)
  const saltHex = toHex(salt)
  return keccak256(concat([keyHex, saltHex]))
}

/**
 * Decrypt escrow data.
 *
 * @param input - Encrypted data and key
 * @returns Decrypted plaintext
 * @throws Error if decryption fails (wrong key or corrupted data)
 */
export function decryptFromEscrow(input: DecryptionInput): Uint8Array {
  const { encryptedData, key } = input

  if (encryptedData.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Encrypted data too short')
  }

  // Extract IV, ciphertext, and auth tag
  const iv = encryptedData.slice(0, IV_LENGTH)
  const authTag = encryptedData.slice(encryptedData.length - AUTH_TAG_LENGTH)
  const ciphertext = encryptedData.slice(IV_LENGTH, encryptedData.length - AUTH_TAG_LENGTH)

  // Decrypt
  const decipher = createDecipheriv(ALGORITHM, Buffer.from(key), Buffer.from(iv))
  decipher.setAuthTag(Buffer.from(authTag))

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])

  return new Uint8Array(decrypted)
}

/**
 * Verify that a key matches a commitment.
 *
 * @param key - 32-byte encryption key
 * @param salt - 32-byte salt
 * @param commitment - Expected key commitment
 * @returns true if key + salt produce the expected commitment
 */
export function verifyKeyCommitment(
  key: Uint8Array,
  salt: Uint8Array,
  commitment: Hex
): boolean {
  const computed = computeKeyCommitment(key, salt)
  return computed.toLowerCase() === commitment.toLowerCase()
}
