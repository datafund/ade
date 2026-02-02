/**
 * Escrow key management - automatic storage/retrieval of encryption keys and salts.
 * Keys are stored in OS keychain with ESCROW_<id>_KEY and ESCROW_<id>_SALT naming.
 */

import * as defaultKeychain from './keychain'
import type { Keychain } from './secrets'

export interface EscrowKeys {
  encryptionKey: string
  salt: string
}

/**
 * Store encryption key and salt for an escrow.
 */
export async function storeEscrowKeys(
  escrowId: number,
  keys: EscrowKeys,
  keychain: Keychain = defaultKeychain
): Promise<void> {
  await keychain.set(`ESCROW_${escrowId}_KEY`, keys.encryptionKey)
  await keychain.set(`ESCROW_${escrowId}_SALT`, keys.salt)
}

/**
 * Retrieve encryption key and salt for an escrow.
 * Returns null if either key or salt is missing.
 */
export async function getEscrowKeys(
  escrowId: number,
  keychain: Keychain = defaultKeychain
): Promise<EscrowKeys | null> {
  const encryptionKey = await keychain.get(`ESCROW_${escrowId}_KEY`)
  const salt = await keychain.get(`ESCROW_${escrowId}_SALT`)

  if (!encryptionKey || !salt) {
    return null
  }

  return { encryptionKey, salt }
}

/**
 * Delete encryption key and salt for an escrow.
 */
export async function deleteEscrowKeys(
  escrowId: number,
  keychain: Keychain = defaultKeychain
): Promise<void> {
  await keychain.remove(`ESCROW_${escrowId}_KEY`)
  await keychain.remove(`ESCROW_${escrowId}_SALT`)
}

/**
 * List all escrow IDs that have complete key+salt pairs stored.
 */
export async function listEscrowIds(
  keychain: Keychain = defaultKeychain
): Promise<number[]> {
  const allKeys = await keychain.list()

  // Find all ESCROW_*_KEY entries
  const keyPattern = /^ESCROW_(\d+)_KEY$/
  const escrowIds: number[] = []

  for (const key of allKeys) {
    const match = key.match(keyPattern)
    if (match) {
      const id = parseInt(match[1], 10)
      // Check if corresponding salt exists
      if (allKeys.includes(`ESCROW_${id}_SALT`)) {
        escrowIds.push(id)
      }
    }
  }

  return escrowIds
}
