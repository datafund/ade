/**
 * Fairdrop ECDH crypto utilities for buyer-encrypted key exchange.
 *
 * Implements ECDH-based key encryption so sellers can securely transmit
 * AES keys to specific buyers without revealing them publicly on-chain.
 */

import * as secp256k1 from '@noble/secp256k1'
import { gcm } from '@noble/ciphers/aes.js'
import { randomBytes } from '@noble/ciphers/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { keccak_256 } from '@noble/hashes/sha3.js'

// Constants
const IV_LENGTH = 12
const KEY_LENGTH = 32

/**
 * A secp256k1 keypair for ECDH key exchange.
 */
export interface KeyPair {
  /** 32-byte private key */
  privateKey: Uint8Array
  /** 33-byte compressed public key */
  publicKey: Uint8Array
}

/**
 * Encrypted AES key for a specific buyer via ECDH.
 */
export interface BuyerEncryptedKey {
  /** AES-GCM encrypted key */
  encryptedKey: Uint8Array
  /** 12-byte IV for AES-GCM */
  iv: Uint8Array
  /** 33-byte compressed ephemeral public key */
  ephemeralPubkey: Uint8Array
}

/**
 * Generate a new secp256k1 keypair for ECDH.
 *
 * @returns KeyPair with 32-byte private key and 33-byte compressed public key
 */
export function generateKeyPair(): KeyPair {
  const privateKey = randomBytes(KEY_LENGTH)
  // Ensure valid scalar (very unlikely to fail, but handle edge case)
  while (!secp256k1.utils.isValidSecretKey(privateKey)) {
    privateKey.set(randomBytes(KEY_LENGTH))
  }
  const publicKey = secp256k1.getPublicKey(privateKey, true) // compressed
  return { privateKey, publicKey }
}

/**
 * Derive shared secret from private key and public key using ECDH.
 * The shared secret is hashed with SHA-256 to produce a symmetric key.
 *
 * @param privateKey - 32-byte private key
 * @param publicKey - 33 or 65-byte public key
 * @returns 32-byte symmetric key
 */
function deriveSharedKey(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  // ECDH: multiply public key by private scalar
  const sharedPoint = secp256k1.getSharedSecret(privateKey, publicKey, true)
  // Hash to get symmetric key (only use x-coordinate, skip the prefix byte)
  return sha256(sharedPoint.slice(1))
}

/**
 * Encrypt an AES key for a specific buyer using ECDH.
 *
 * Uses an ephemeral keypair to establish a shared secret with the buyer,
 * then encrypts the AES key with AES-256-GCM.
 *
 * @param key - The AES key to encrypt (typically 32 bytes)
 * @param buyerPubkey - Buyer's secp256k1 public key (33 or 65 bytes)
 * @returns Encrypted key bundle with ephemeral pubkey for buyer to decrypt
 */
export function encryptKeyForBuyer(
  key: Uint8Array,
  buyerPubkey: Uint8Array
): BuyerEncryptedKey {
  // Generate ephemeral keypair for this encryption
  const ephemeral = generateKeyPair()

  // Derive shared secret from ephemeral private + buyer public
  const sharedKey = deriveSharedKey(ephemeral.privateKey, buyerPubkey)

  // Encrypt AES key with shared secret
  const iv = randomBytes(IV_LENGTH)
  const cipher = gcm(sharedKey, iv)
  const encryptedKey = cipher.encrypt(key)

  // Clear ephemeral private key from memory
  ephemeral.privateKey.fill(0)

  return {
    encryptedKey,
    iv,
    ephemeralPubkey: ephemeral.publicKey,
  }
}

/**
 * Decrypt an AES key as the buyer using ECDH.
 *
 * @param encrypted - The encrypted key bundle from seller
 * @param buyerPrivkey - Buyer's secp256k1 private key (32 bytes)
 * @returns The decrypted AES key
 * @throws Error if decryption fails (wrong key or corrupted data)
 */
export function decryptKeyAsBuyer(
  encrypted: BuyerEncryptedKey,
  buyerPrivkey: Uint8Array
): Uint8Array {
  // Derive shared secret from buyer private + ephemeral public
  const sharedKey = deriveSharedKey(buyerPrivkey, encrypted.ephemeralPubkey)

  // Decrypt AES key
  const cipher = gcm(sharedKey, encrypted.iv)
  return cipher.decrypt(encrypted.encryptedKey)
}

/**
 * Serialize encrypted key bundle for on-chain storage.
 *
 * Format: [ephemeralPubkey (33 bytes)][iv (12 bytes)][encryptedKey (variable)]
 *
 * @param encrypted - The encrypted key bundle
 * @returns Serialized bytes
 */
export function serializeEncryptedKey(encrypted: BuyerEncryptedKey): Uint8Array {
  const { ephemeralPubkey, iv, encryptedKey } = encrypted
  const result = new Uint8Array(ephemeralPubkey.length + iv.length + encryptedKey.length)
  result.set(ephemeralPubkey, 0)
  result.set(iv, ephemeralPubkey.length)
  result.set(encryptedKey, ephemeralPubkey.length + iv.length)
  return result
}

/**
 * Deserialize encrypted key bundle from on-chain storage.
 *
 * @param data - Serialized bytes
 * @returns Deserialized encrypted key bundle
 * @throws Error if data is too short
 */
export function deserializeEncryptedKey(data: Uint8Array): BuyerEncryptedKey {
  const PUBKEY_LENGTH = 33
  const minLength = PUBKEY_LENGTH + IV_LENGTH + 1 // At least 1 byte of encrypted data

  if (data.length < minLength) {
    throw new Error(`Encrypted key data too short: ${data.length} bytes, need at least ${minLength}`)
  }

  const ephemeralPubkey = data.slice(0, PUBKEY_LENGTH)
  const iv = data.slice(PUBKEY_LENGTH, PUBKEY_LENGTH + IV_LENGTH)
  const encryptedKey = data.slice(PUBKEY_LENGTH + IV_LENGTH)

  return { ephemeralPubkey, iv, encryptedKey }
}

/**
 * Compute Ethereum-style address from public key.
 *
 * @param publicKey - 33 or 65-byte secp256k1 public key
 * @returns 20-byte Ethereum address
 */
export function publicKeyToAddress(publicKey: Uint8Array): Uint8Array {
  // Decompress if needed to get full 64-byte point (without prefix)
  let uncompressed: Uint8Array
  if (publicKey.length === 33) {
    // Decompress: convert to uncompressed form, then remove prefix
    const point = secp256k1.Point.fromBytes(publicKey)
    uncompressed = point.toBytes(false).slice(1) // Remove 0x04 prefix
  } else if (publicKey.length === 65) {
    uncompressed = publicKey.slice(1) // Remove 0x04 prefix
  } else {
    throw new Error(`Invalid public key length: ${publicKey.length}`)
  }

  // Keccak256 hash and take last 20 bytes
  const hash = keccak_256(uncompressed)
  return hash.slice(-20)
}

/**
 * Format address as hex string with 0x prefix.
 *
 * @param address - 20-byte address
 * @returns Checksummed address string
 */
export function addressToHex(address: Uint8Array): `0x${string}` {
  const hex = Array.from(address, b => b.toString(16).padStart(2, '0')).join('')
  return `0x${hex}` as `0x${string}`
}

/**
 * Format public key as hex string with 0x prefix.
 *
 * @param publicKey - Public key bytes
 * @returns Hex string
 */
export function publicKeyToHex(publicKey: Uint8Array): `0x${string}` {
  const hex = Array.from(publicKey, b => b.toString(16).padStart(2, '0')).join('')
  return `0x${hex}` as `0x${string}`
}

/**
 * Parse hex string (with or without 0x) to Uint8Array.
 *
 * @param hex - Hex string
 * @returns Bytes
 */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}
