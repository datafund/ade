/**
 * Fairdrop keystore encryption/decryption.
 *
 * Implements Ethereum-style encrypted keystore format for securely storing
 * Fairdrop account credentials using scrypt key derivation and AES-128-CTR.
 */

import { ctr } from '@noble/ciphers/aes.js'
import { randomBytes } from '@noble/ciphers/utils.js'
import { scrypt } from '@noble/hashes/scrypt.js'
import { keccak_256 } from '@noble/hashes/sha3.js'

// Scrypt parameters (Ethereum standard)
const SCRYPT_N = 262144  // 2^18
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_DKLEN = 32

/**
 * Fairdrop keystore format following Ethereum keystore structure.
 */
export interface FairdropKeystore {
  version: number
  type: 'fairdrop'
  address: string
  crypto: {
    cipher: 'aes-128-ctr'
    ciphertext: string
    cipherparams: { iv: string }
    kdf: 'scrypt'
    kdfparams: {
      dklen: number
      n: number
      r: number
      p: number
      salt: string
    }
    mac: string
  }
}

/**
 * Payload stored inside the encrypted keystore.
 */
export interface KeystorePayload {
  /** User's chosen subdomain/name */
  subdomain: string
  /** Hex-encoded public key (with 0x prefix) */
  publicKey: string
  /** Hex-encoded private key (with 0x prefix) */
  privateKey: string
  /** Unix timestamp when created */
  created: number
}

/**
 * Convert bytes to hex string with 0x prefix.
 */
function toHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Convert hex string (with or without 0x) to bytes.
 */
function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Derive encryption key from password using scrypt.
 */
function deriveKey(password: string, salt: Uint8Array): Uint8Array {
  const passwordBytes = new TextEncoder().encode(password)
  return scrypt(passwordBytes, salt, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    dkLen: SCRYPT_DKLEN,
  })
}

/**
 * Compute MAC for integrity verification.
 * MAC = keccak256(derivedKey[16:32] || ciphertext)
 */
function computeMAC(derivedKey: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const macInput = new Uint8Array(16 + ciphertext.length)
  macInput.set(derivedKey.slice(16, 32), 0)
  macInput.set(ciphertext, 16)
  return keccak_256(macInput)
}

/**
 * Create an encrypted keystore from a payload.
 *
 * @param payload - The account data to encrypt
 * @param password - Password for encryption
 * @returns JSON string of the keystore
 */
export function createKeystore(payload: KeystorePayload, password: string): string {
  // Serialize payload to JSON
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))

  // Generate random salt and IV
  const salt = randomBytes(32)
  const iv = randomBytes(16)

  // Derive key from password
  const derivedKey = deriveKey(password, salt)

  // Encrypt with AES-128-CTR using first 16 bytes of derived key
  const cipher = ctr(derivedKey.slice(0, 16), iv)
  const ciphertext = cipher.encrypt(plaintext)

  // Compute MAC for integrity check
  const mac = computeMAC(derivedKey, ciphertext)

  // Compute address (last 20 bytes of keccak256 of pubkey without 0x prefix)
  // For display purposes, we use the subdomain as address identifier
  const address = payload.subdomain

  const keystore: FairdropKeystore = {
    version: 1,
    type: 'fairdrop',
    address,
    crypto: {
      cipher: 'aes-128-ctr',
      ciphertext: toHex(ciphertext).slice(2), // Remove 0x for storage
      cipherparams: { iv: toHex(iv).slice(2) },
      kdf: 'scrypt',
      kdfparams: {
        dklen: SCRYPT_DKLEN,
        n: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        salt: toHex(salt).slice(2),
      },
      mac: toHex(mac).slice(2),
    },
  }

  return JSON.stringify(keystore, null, 2)
}

/**
 * Parse and decrypt a keystore.
 *
 * @param keystoreJson - JSON string of the keystore
 * @param password - Password for decryption
 * @returns Decrypted payload
 * @throws Error if password is incorrect or keystore is corrupted
 */
export function parseKeystore(keystoreJson: string, password: string): KeystorePayload {
  const keystore: FairdropKeystore = JSON.parse(keystoreJson)

  if (keystore.version !== 1) {
    throw new Error(`Unsupported keystore version: ${keystore.version}`)
  }

  if (keystore.type !== 'fairdrop') {
    throw new Error(`Invalid keystore type: ${keystore.type}`)
  }

  const { crypto } = keystore

  if (crypto.kdf !== 'scrypt') {
    throw new Error(`Unsupported KDF: ${crypto.kdf}`)
  }

  if (crypto.cipher !== 'aes-128-ctr') {
    throw new Error(`Unsupported cipher: ${crypto.cipher}`)
  }

  // Extract parameters
  const salt = fromHex(crypto.kdfparams.salt)
  const iv = fromHex(crypto.cipherparams.iv)
  const ciphertext = fromHex(crypto.ciphertext)
  const storedMac = fromHex(crypto.mac)

  // Derive key from password
  const derivedKey = deriveKey(password, salt)

  // Verify MAC
  const computedMac = computeMAC(derivedKey, ciphertext)
  if (!constantTimeEqual(computedMac, storedMac)) {
    throw new Error('Incorrect password or corrupted keystore')
  }

  // Decrypt with AES-128-CTR
  const cipher = ctr(derivedKey.slice(0, 16), iv)
  const plaintext = cipher.decrypt(ciphertext)

  // Parse payload
  const payload: KeystorePayload = JSON.parse(new TextDecoder().decode(plaintext))

  return payload
}

/**
 * Constant-time comparison to prevent timing attacks.
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i]
  }
  return result === 0
}

/**
 * Validate password strength.
 * Returns null if valid, error message if invalid.
 */
export function validatePassword(password: string): string | null {
  if (password.length < 8) {
    return 'Password must be at least 8 characters'
  }
  return null
}
