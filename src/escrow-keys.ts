/**
 * Escrow key management - automatic storage/retrieval of encryption keys and salts.
 * Keys are stored in OS keychain with ESCROW_<id>_KEY and ESCROW_<id>_SALT naming.
 * Also bridges to MCP JSON files at ~/.datafund/escrow-keys/ for cross-tool compat.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, lstatSync, renameSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import * as defaultKeychain from './keychain'
import type { Keychain } from './secrets'

function getMcpKeysDir(): string {
  return process.env.ADE_MCP_KEYS_DIR || join(homedir(), '.datafund', 'escrow-keys')
}

export interface EscrowKeys {
  encryptionKey: string
  salt: string
}

interface StoreOptions extends EscrowKeys {
  encryptedDataRef?: string
  contentHash?: string
  seller?: string
}

/**
 * Store encryption key and salt for an escrow.
 * Writes to both OS keychain (authoritative) and MCP JSON bridge.
 */
export async function storeEscrowKeys(
  escrowId: number,
  keys: StoreOptions,
  keychain: Keychain = defaultKeychain
): Promise<void> {
  // Write to keychain (authoritative for key material)
  await keychain.set(`ESCROW_${escrowId}_KEY`, keys.encryptionKey)
  await keychain.set(`ESCROW_${escrowId}_SALT`, keys.salt)

  // Also write MCP-format JSON for cross-tool compat (atomic write)
  try {
    mkdirSync(getMcpKeysDir(), { recursive: true, mode: 0o700 })
    // Verify directory permissions after creation (may pre-exist with wrong perms)
    const dirStat = lstatSync(getMcpKeysDir())
    if ((dirStat.mode & 0o077) !== 0) {
      console.error(`Warning: ${getMcpKeysDir()} has loose permissions, skipping bridge write`)
      return
    }
    const filePath = join(getMcpKeysDir(), `escrow-${escrowId}.json`)
    const tmpPath = filePath + '.tmp'
    writeFileSync(tmpPath, JSON.stringify({
      escrowId: String(escrowId),
      encryptionKey: keys.encryptionKey,
      salt: keys.salt,
      ...(keys.encryptedDataRef && { encryptedDataRef: keys.encryptedDataRef }),
      ...(keys.contentHash && { contentHash: keys.contentHash }),
      ...(keys.seller && { seller: keys.seller }),
      createdAt: new Date().toISOString(),
    }, null, 2), { mode: 0o600 })
    renameSync(tmpPath, filePath)
  } catch { /* non-fatal */ }
}

/**
 * Read keys from MCP JSON bridge file.
 * Validates: no symlinks, size cap, permissions, correct escrowId, hex format.
 */
function readMcpKeyFile(escrowId: number): EscrowKeys | null {
  const filePath = join(getMcpKeysDir(), `escrow-${escrowId}.json`)
  try {
    const fstat = lstatSync(filePath)
    if (fstat.isSymbolicLink()) return null
    if (fstat.size > 1024) return null
    if ((fstat.mode & 0o077) !== 0) {
      console.error(`Warning: ${filePath} has loose permissions, skipping`)
      return null
    }

    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    if (typeof data.encryptionKey !== 'string' || typeof data.salt !== 'string') return null
    if (!data.encryptionKey.startsWith('0x') || !data.salt.startsWith('0x')) return null
    // Verify escrowId matches requested ID (prevent misnamed file attacks)
    if (data.escrowId !== undefined && String(data.escrowId) !== String(escrowId)) return null
    return { encryptionKey: data.encryptionKey, salt: data.salt }
  } catch {
    return null
  }
}

/**
 * Retrieve encryption key and salt for an escrow.
 * Tries OS keychain first, falls back to MCP JSON bridge.
 * Returns null if neither source has valid keys.
 */
export async function getEscrowKeys(
  escrowId: number,
  keychain: Keychain = defaultKeychain
): Promise<EscrowKeys | null> {
  // Validate escrowId
  if (!Number.isInteger(escrowId) || escrowId < 0 || escrowId > Number.MAX_SAFE_INTEGER) return null

  // Try keychain first (authoritative)
  const encryptionKey = await keychain.get(`ESCROW_${escrowId}_KEY`)
  const salt = await keychain.get(`ESCROW_${escrowId}_SALT`)
  if (encryptionKey && salt) return { encryptionKey, salt }

  // Fallback: MCP JSON files
  return readMcpKeyFile(escrowId)
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
 * Discovers from both OS keychain and MCP JSON bridge.
 */
export async function listEscrowIds(
  keychain: Keychain = defaultKeychain
): Promise<number[]> {
  const allKeys = await keychain.list()
  const escrowIds = new Set<number>()

  // From keychain
  const keyPattern = /^ESCROW_(\d+)_KEY$/
  for (const key of allKeys) {
    const match = key.match(keyPattern)
    if (match) {
      const id = parseInt(match[1], 10)
      if (!isNaN(id) && id <= Number.MAX_SAFE_INTEGER && allKeys.includes(`ESCROW_${id}_SALT`)) {
        escrowIds.add(id)
      }
    }
  }

  // From MCP bridge files
  try {
    const files = readdirSync(getMcpKeysDir())
    const filePattern = /^escrow-(\d+)\.json$/
    for (const file of files) {
      const match = file.match(filePattern)
      if (match) {
        const id = parseInt(match[1], 10)
        if (!isNaN(id) && id <= Number.MAX_SAFE_INTEGER && !escrowIds.has(id)) {
          if (readMcpKeyFile(id) !== null) {
            escrowIds.add(id)
          }
        }
      }
    }
  } catch { /* MCP dir may not exist */ }

  return Array.from(escrowIds)
}
