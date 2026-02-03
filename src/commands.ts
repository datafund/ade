/**
 * All CLI command handlers. Each returns data; formatting handled by caller.
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther, keccak256, concat, toHex, type PublicClient, type WalletClient, type Chain, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import { randomBytes } from 'crypto'
import { readFile, stat, writeFile } from 'fs/promises'
import { apiFetch, apiPost, getBaseUrl } from './api'
import { CLIError } from './errors'
import { DataEscrowABI } from './abi/DataEscrow'
import { storeEscrowKeys, getEscrowKeys } from './escrow-keys'
import { getChainConfig, CHAIN_BY_ID, DEFAULT_CHAIN, DEFAULT_RPC, type ChainConfig } from './addresses'
import { encryptForEscrow, decryptFromEscrow } from './crypto/escrow'
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
  type KeyPair,
} from './crypto/fairdrop'
import { createKeystore, parseKeystore, validatePassword, type KeystorePayload } from './crypto/keystore'
import { uploadToSwarm, checkStampValid, downloadFromSwarm, getOrCreateStamp } from './swarm'
import { parseEscrowIdFromLogs, waitForKeyRevealed } from './utils/events'
import {
  txLink,
  validateReceipt,
  executeContractTx,
  estimateAndValidateGas,
  getAndValidateEscrowKeys,
  getEscrowFromChain,
  requireBeeApi,
  getBeeStamp,
  requireBeeConfig,
  logChainInfo,
  formatTxResult,
  type TxResult,
} from './utils/chain'
import * as defaultKeychain from './keychain'
import type { Keychain } from './secrets'

const DEFAULT_EXPIRY_DAYS = 7n
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
const DEFAULT_KEY_WAIT_TIMEOUT = 86400 // 24 hours in seconds

// Map chainId to viem chain object
const VIEM_CHAINS: Record<number, Chain> = {
  8453: base,
  84532: baseSepolia,
}

// ── Helpers ──

/**
 * Normalize and validate a private key.
 * Accepts with or without 0x prefix, uppercase or lowercase.
 */
function normalizePrivateKey(key: string): `0x${string}` {
  let normalized = key.trim().toLowerCase()

  // Add 0x prefix if missing
  if (!normalized.startsWith('0x')) {
    normalized = '0x' + normalized
  }

  // Validate format: 0x + 64 hex characters
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new CLIError('ERR_INVALID_ARGUMENT', 'Private key must be 32 bytes (64 hex characters)', 'Format: 0x followed by 64 hex chars')
  }

  return normalized as `0x${string}`
}

/**
 * Validate a bytes32 hash (content hash, etc).
 */
function validateBytes32(value: string, label: string): `0x${string}` {
  const normalized = value.trim().toLowerCase()
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new CLIError('ERR_INVALID_ARGUMENT', `${label} must be 32 bytes (0x + 64 hex chars)`)
  }
  return normalized as `0x${string}`
}

async function requireKey(keychain: Keychain = defaultKeychain): Promise<`0x${string}`> {
  // Check keychain first
  const key = await keychain.get('SX_KEY')
  // Fall back to env var for CI/scripting
  const envKey = process.env.SX_KEY?.trim()

  const finalKey = key || envKey
  if (!finalKey) {
    throw new CLIError('ERR_MISSING_KEY', 'SX_KEY not found in keychain', 'Use: ade set SX_KEY')
  }

  const normalized = normalizePrivateKey(finalKey)

  // Remove from env to minimize exposure window
  if (envKey) delete process.env.SX_KEY
  return normalized
}

async function requireRpc(keychain: Keychain = defaultKeychain): Promise<string> {
  // Check keychain first
  const rpc = await keychain.get('SX_RPC')
  // Fall back to env var, then default
  const envRpc = process.env.SX_RPC?.trim()

  const finalRpc = rpc || envRpc || DEFAULT_RPC
  return finalRpc
}

async function getChainClient(keychain: Keychain = defaultKeychain): Promise<{
  pub: PublicClient
  wallet: WalletClient
  address: `0x${string}`
  chainConfig: ChainConfig
}> {
  const key = await requireKey(keychain)
  const rpc = await requireRpc(keychain)
  const account = privateKeyToAccount(key)

  // Create client without specifying chain first to detect it
  const pub = createPublicClient({ transport: http(rpc) }) as PublicClient
  const chainId = await pub.getChainId()

  // Validate chain is supported
  const chainConfig = CHAIN_BY_ID[chainId]
  if (!chainConfig) {
    const supported = Object.values(CHAIN_BY_ID).map(c => `${c.name} (${c.chainId})`).join(', ')
    throw new CLIError('ERR_WRONG_CHAIN', `RPC returned chain ${chainId}, not supported`, `Supported chains: ${supported}`)
  }

  const viemChain = VIEM_CHAINS[chainId]
  if (!viemChain) {
    throw new CLIError('ERR_WRONG_CHAIN', `Chain ${chainId} not configured in viem`)
  }

  // Recreate clients with proper chain
  const pubWithChain = createPublicClient({ chain: viemChain, transport: http(rpc) }) as PublicClient
  const wallet = createWalletClient({ account, chain: viemChain, transport: http(rpc) })

  return { pub: pubWithChain, wallet, address: account.address, chainConfig }
}

function requireConfirmation(opts: { yes?: boolean }): void {
  if (!opts.yes && (!process.stdout.isTTY || !process.stdin.isTTY)) {
    throw new CLIError('ERR_CONFIRMATION_REQUIRED', 'Chain ops require --yes flag in non-TTY mode', 'Add --yes to confirm')
  }
}

/**
 * Prompt for confirmation. Returns true if confirmed, throws on cancel.
 */
async function confirmAction(message: string, opts: { yes?: boolean }): Promise<void> {
  if (opts.yes) return

  if (!process.stdin.isTTY) {
    throw new CLIError('ERR_CONFIRMATION_REQUIRED', 'Confirmation required but not in TTY mode', 'Add --yes flag')
  }

  const { createInterface } = await import('readline')
  const rl = createInterface({ input: process.stdin, output: process.stderr })

  try {
    const answer = await new Promise<string>(resolve => rl.question(`${message} [y/N] `, resolve))
    if (answer.toLowerCase() !== 'y') {
      console.error('Cancelled.')
      process.exit(130) // Standard exit code for user interrupt
    }
  } finally {
    rl.close()
  }
}

interface ListOpts { limit?: string; offset?: string }
function listParams(opts: ListOpts): string {
  const limit = Math.max(1, Math.min(100, parseInt(opts.limit || '50', 10) || 50))
  const offset = Math.max(0, parseInt(opts.offset || '0', 10) || 0)
  return `limit=${limit}&offset=${offset}`
}

function parseBigInt(value: string, label: string): bigint {
  try {
    return BigInt(value)
  } catch {
    throw new CLIError('ERR_INVALID_ARGUMENT', `Invalid ${label}: "${value}" is not a valid integer`)
  }
}

// ── Read Commands ──

export async function statsFn() {
  return apiFetch('/stats')
}

export async function skillsList(opts: ListOpts & { category?: string; status?: string }) {
  let q = listParams(opts)
  if (opts.category) q += `&category=${encodeURIComponent(opts.category)}`
  if (opts.status) q += `&status=${encodeURIComponent(opts.status)}`
  return apiFetch(`/skills?${q}`)
}

export async function skillsShow(id: string) {
  return apiFetch(`/skills/${encodeURIComponent(id)}`)
}

export async function bountiesList(opts: ListOpts & { status?: string }) {
  let q = listParams(opts)
  if (opts.status) q += `&status=${encodeURIComponent(opts.status)}`
  const result = await apiFetch<{ bounties: unknown[] }>(`/bounties?${q}`)
  return result.bounties ?? result
}

export async function bountiesShow(id: string) {
  return apiFetch(`/bounties/${encodeURIComponent(id)}`)
}

export async function agentsList(opts: ListOpts & { sort?: string }) {
  let q = listParams(opts)
  if (opts.sort) q += `&sort=${encodeURIComponent(opts.sort)}`
  const result = await apiFetch<{ agents: unknown[] }>(`/agents?${q}`)
  return result.agents ?? result
}

export async function agentsShow(id: string) {
  return apiFetch(`/agents/${encodeURIComponent(id)}/reputation`)
}

export async function escrowsList(opts: ListOpts & { state?: string }) {
  let q = listParams(opts)
  if (opts.state) q += `&state=${encodeURIComponent(opts.state)}`
  const result = await apiFetch<{ escrows: unknown[] }>(`/escrows?${q}`)
  return result.escrows ?? result
}

export async function escrowsShow(id: string) {
  return apiFetch(`/escrows/${encodeURIComponent(id)}`)
}

export async function walletsList(opts: ListOpts & { role?: string }) {
  let q = listParams(opts)
  if (opts.role) q += `&role=${encodeURIComponent(opts.role)}`
  const result = await apiFetch<{ wallets: unknown[] }>(`/wallets?${q}`)
  return result.wallets ?? result
}

// ── Write Commands (API + EIP-191 signing) ──

export async function skillsVote(id: string, direction: string, keychain: Keychain = defaultKeychain) {
  const key = await requireKey(keychain)
  if (direction !== 'up' && direction !== 'down') {
    throw new CLIError('ERR_INVALID_ARGUMENT', 'Direction must be "up" or "down"')
  }
  return apiPost(`/skills/${encodeURIComponent(id)}/vote`, { direction }, key)
}

export async function skillsComment(id: string, body: string, keychain: Keychain = defaultKeychain) {
  const key = await requireKey(keychain)
  return apiPost(`/skills/${encodeURIComponent(id)}/comments`, { body }, key)
}

export async function skillsCreate(opts: { title: string; price: string; description?: string; category?: string }, keychain: Keychain = defaultKeychain) {
  const key = await requireKey(keychain)
  return apiPost('/skills', {
    title: opts.title,
    price: opts.price,
    description: opts.description,
    category: opts.category,
  }, key)
}

export async function bountiesCreate(opts: { title: string; reward: string; description?: string; category?: string }, keychain: Keychain = defaultKeychain) {
  const key = await requireKey(keychain)
  return apiPost('/bounties', {
    title: opts.title,
    rewardAmount: opts.reward,
    description: opts.description,
    category: opts.category,
  }, key)
}

// ── Chain Commands ──

export async function escrowsCreate(opts: { contentHash: string; price: string; yes?: boolean }, keychain: Keychain = defaultKeychain) {
  requireConfirmation(opts)
  const { pub, wallet, address, chainConfig } = await getChainClient(keychain)

  // Validate content hash
  const contentHash = validateBytes32(opts.contentHash, 'Content hash')
  const amount = parseEther(opts.price)

  // Generate real encryption key and salt for commit-reveal scheme
  const encryptionKey = `0x${randomBytes(32).toString('hex')}` as `0x${string}`
  const salt = `0x${randomBytes(32).toString('hex')}` as `0x${string}`
  const keyCommitment = keccak256(concat([encryptionKey, salt]))
  const nativeToken = '0x0000000000000000000000000000000000000000' as `0x${string}`

  // Estimate gas
  const { gasCost } = await estimateAndValidateGas({
    pub,
    address: chainConfig.contracts.dataEscrow,
    functionName: 'createEscrow',
    args: [contentHash, keyCommitment, nativeToken, amount, DEFAULT_EXPIRY_DAYS],
    account: address,
  })

  logChainInfo({ chainConfig, address })
  console.error(`Contract: ${chainConfig.contracts.dataEscrow}`)
  console.error(`Create escrow: ${opts.price} ETH`)
  console.error(`Estimated gas cost: ~${formatEther(gasCost)} ETH`)

  await confirmAction('Confirm transaction?', opts)

  const { hash, receipt } = await executeContractTx({
    wallet, pub,
    address: chainConfig.contracts.dataEscrow,
    functionName: 'createEscrow',
    args: [contentHash, keyCommitment, nativeToken, amount, DEFAULT_EXPIRY_DAYS],
    chainConfig,
    description: 'Create escrow',
  })

  // Parse escrow ID from logs using shared helper
  const escrowId = parseEscrowIdFromLogs(receipt.logs)

  if (escrowId === null) {
    // Include keys in error for recovery
    console.error(`\nIMPORTANT: Save these keys for manual recovery:`)
    console.error(`  Encryption Key: ${encryptionKey}`)
    console.error(`  Salt: ${salt}`)
    console.error(`  Key Commitment: ${keyCommitment}`)

    throw new CLIError(
      'ERR_API_ERROR',
      'Could not extract escrow ID from transaction logs',
      `Transaction succeeded (${hash}). Check explorer: ${txLink(hash, chainConfig.explorer)}. Use 'ade escrows list' to find your escrow by content hash.`
    )
  }

  // Store keys in keychain
  try {
    await storeEscrowKeys(escrowId, { encryptionKey, salt }, keychain)
    console.error(`\nKeys stored in keychain: ESCROW_${escrowId}_KEY, ESCROW_${escrowId}_SALT`)
  } catch (err) {
    console.error(`\nWarning: Could not store keys in keychain: ${(err as Error).message}`)
    console.error('IMPORTANT: Save the encryption key and salt from the output below!')
  }

  return {
    txHash: hash,
    status: receipt.status,
    blockNumber: Number(receipt.blockNumber),
    chain: chainConfig.name,
    chainId: chainConfig.chainId,
    escrowId,
    encryptionKey,
    salt,
    keyCommitment,
    explorer: txLink(hash, chainConfig.explorer),
  }
}

export async function escrowsFund(id: string, opts: { yes?: boolean }, keychain: Keychain = defaultKeychain): Promise<TxResult> {
  requireConfirmation(opts)
  const { pub, wallet, address, chainConfig } = await getChainClient(keychain)
  const escrowId = parseBigInt(id, 'escrow ID')

  // Read amount from on-chain contract (never trust off-chain API for tx params)
  const escrowData = await getEscrowFromChain(pub, chainConfig.contracts.dataEscrow, escrowId)
  const amount = escrowData?.amount ?? 0n
  if (amount === 0n) {
    throw new CLIError('ERR_NOT_FOUND', `Escrow #${id} not found or has zero amount`)
  }

  logChainInfo({ chainConfig, address, action: 'Fund', escrowId: id, amount })
  await confirmAction('Confirm transaction?', opts)

  const { hash, receipt } = await executeContractTx({
    wallet, pub,
    address: chainConfig.contracts.dataEscrow,
    functionName: 'fundEscrow',
    args: [escrowId],
    value: amount,
    chainConfig,
    description: 'Fund escrow',
  })

  return formatTxResult(hash, receipt, chainConfig)
}

export async function escrowsCommitKey(id: string, opts: { key?: string; salt?: string; yes?: boolean }, keychain: Keychain = defaultKeychain): Promise<TxResult> {
  requireConfirmation(opts)
  const { pub, wallet, address, chainConfig } = await getChainClient(keychain)
  const escrowId = parseBigInt(id, 'escrow ID')

  // Get keys from keychain or flags
  const keys = await getAndValidateEscrowKeys({
    escrowId: parseInt(id, 10),
    keychain,
    flagKey: opts.key,
    flagSalt: opts.salt,
  })

  // Validate key and salt format
  const validatedKey = validateBytes32(keys.encryptionKey, 'Encryption key')
  const validatedSalt = validateBytes32(keys.salt, 'Salt')

  // Compute commitment = keccak256(key || salt) — must match what was used at creation
  const commitment = keccak256(concat([validatedKey, validatedSalt]))

  logChainInfo({ chainConfig, address, action: 'Commit key for', escrowId: id })
  console.error(`Commitment: ${commitment}`)
  await confirmAction('Confirm transaction?', opts)

  const { hash, receipt } = await executeContractTx({
    wallet, pub,
    address: chainConfig.contracts.dataEscrow,
    functionName: 'commitKeyRelease',
    args: [escrowId, commitment],
    chainConfig,
    description: 'Commit key',
  })

  return formatTxResult(hash, receipt, chainConfig)
}

export async function escrowsRevealKey(id: string, opts: { key?: string; salt?: string; buyerPubkey?: string; yes?: boolean }, keychain: Keychain = defaultKeychain): Promise<TxResult & { ecdhEncrypted?: boolean }> {
  requireConfirmation(opts)
  const { pub, wallet, address, chainConfig } = await getChainClient(keychain)
  const escrowId = parseBigInt(id, 'escrow ID')

  // Get keys from keychain or flags
  const keys = await getAndValidateEscrowKeys({
    escrowId: parseInt(id, 10),
    keychain,
    flagKey: opts.key,
    flagSalt: opts.salt,
  })

  // Validate key and salt format
  const validatedKey = validateBytes32(keys.encryptionKey, 'Encryption key')
  const validatedSalt = validateBytes32(keys.salt, 'Salt')

  // Get escrow details to find buyer address
  const escrowData = await getEscrowFromChain(pub, chainConfig.contracts.dataEscrow, escrowId)
  if (!escrowData) {
    throw new CLIError('ERR_NOT_FOUND', `Escrow #${id} not found`)
  }

  const buyerAddress = escrowData.buyer
  if (!buyerAddress || buyerAddress === '0x0000000000000000000000000000000000000000') {
    throw new CLIError('ERR_INVALID_ARGUMENT', 'Escrow has no buyer yet', 'Wait for a buyer to fund the escrow')
  }

  // Parse buyer's public key if provided
  let buyerPubkey: Uint8Array | null = null
  if (opts.buyerPubkey) {
    try {
      buyerPubkey = hexToBytes(opts.buyerPubkey)
      if (buyerPubkey.length !== 33 && buyerPubkey.length !== 65) {
        throw new Error('Invalid length')
      }
    } catch {
      throw new CLIError(
        'ERR_INVALID_ARGUMENT',
        'Invalid buyer public key format',
        'Use compressed (33 bytes) or uncompressed (65 bytes) secp256k1 public key in hex'
      )
    }
  }

  let keyToReveal: `0x${string}`
  let ecdhEncrypted = false

  if (buyerPubkey) {
    // ECDH path: encrypt AES key for buyer
    console.error(`Using ECDH encryption for buyer's public key`)
    const keyBytes = hexToBytes(validatedKey)
    const encrypted = encryptKeyForBuyer(keyBytes, buyerPubkey)
    const serialized = serializeEncryptedKey(encrypted)
    keyToReveal = ('0x' + Array.from(serialized, b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`
    ecdhEncrypted = true
  } else {
    // Legacy path: reveal raw key
    console.error(`No buyer public key provided, revealing raw key`)
    console.error(`Warning: Raw key will be visible on-chain`)
    console.error(`Tip: Ask buyer for their public key (ade account status) for ECDH encryption`)
    keyToReveal = validatedKey
  }

  logChainInfo({ chainConfig, address, action: 'Reveal key for', escrowId: id })
  await confirmAction('Confirm transaction?', opts)

  const { hash, receipt } = await executeContractTx({
    wallet, pub,
    address: chainConfig.contracts.dataEscrow,
    functionName: 'revealKey',
    args: [escrowId, keyToReveal, validatedSalt],
    chainConfig,
    description: 'Reveal key',
  })

  const result = formatTxResult(hash, receipt, chainConfig)
  return { ...result, ecdhEncrypted }
}

export async function escrowsClaim(id: string, opts: { yes?: boolean }, keychain: Keychain = defaultKeychain): Promise<TxResult> {
  requireConfirmation(opts)
  const { pub, wallet, address, chainConfig } = await getChainClient(keychain)
  const escrowId = parseBigInt(id, 'escrow ID')

  logChainInfo({ chainConfig, address, action: 'Claim payment for', escrowId: id })
  await confirmAction('Confirm transaction?', opts)

  const { hash, receipt } = await executeContractTx({
    wallet, pub,
    address: chainConfig.contracts.dataEscrow,
    functionName: 'claimPayment',
    args: [escrowId],
    chainConfig,
    description: 'Claim payment',
  })

  return formatTxResult(hash, receipt, chainConfig)
}

// ── Config ──

export async function configShow(keychain: Keychain = defaultKeychain) {
  const mask = (v?: string | null) => {
    if (!v) return '(not set)'
    if (v.length <= 12) return '(set)'
    return `${v.slice(0, 6)}...${v.slice(-4)}`
  }

  const sxKey = await keychain.get('SX_KEY')
  const sxRpc = await keychain.get('SX_RPC')
  const sxApi = await keychain.get('SX_API')

  // Try to detect chain from RPC (always have a value now with default)
  let detectedChain = '(unknown)'
  const rpc = sxRpc || process.env.SX_RPC || DEFAULT_RPC
  try {
    const pub = createPublicClient({ transport: http(rpc) })
    const chainId = await pub.getChainId()
    const config = CHAIN_BY_ID[chainId]
    detectedChain = config ? `${config.name} (${chainId})` : `Unknown (${chainId})`
  } catch {
    detectedChain = '(RPC error)'
  }

  const effectiveRpc = sxRpc || process.env.SX_RPC || DEFAULT_RPC

  return {
    SX_API: sxApi || process.env.SX_API || 'https://agents.datafund.io',
    SX_KEY: mask(sxKey || process.env.SX_KEY),
    SX_RPC: effectiveRpc,
    SX_RPC_SOURCE: sxRpc ? 'keychain' : process.env.SX_RPC ? 'env' : 'default',
    SX_FORMAT: process.env.SX_FORMAT || '(auto)',
    detectedChain,
    supportedChains: Object.entries(CHAIN_BY_ID).map(([id, c]) => ({
      chainId: Number(id),
      name: c.name,
      contracts: c.contracts,
      defaultRpc: c.defaultRpc,
    })),
  }
}

// ── Sell Command (Unified Escrow Creation) ──

export interface SellResult {
  escrowId: number
  txHash: Hex
  contentHash: Hex
  swarmRef: string
  encryptionKey: Hex
  salt: Hex
  keyCommitment: Hex
  chain: string
  chainId: number
  explorer: string
  fileSize: number
  encryptedSize: number
}

export interface DryRunResult {
  dryRun: true
  contentHash: Hex
  encryptionKey: Hex
  salt: Hex
  keyCommitment: Hex
  fileSize: number
  encryptedSize: number
  estimatedGas: string
  chain: string
  chainId: number
  stampValid: boolean
}

export interface SellOpts {
  /** Path to file to encrypt and escrow */
  file: string
  /** Price in ETH (e.g., "0.1") */
  price: string
  /** Optional title for the data */
  title?: string
  /** Optional description */
  description?: string
  /** Skip confirmation prompt */
  yes?: boolean
  /** Dry run mode - validate without executing */
  dryRun?: boolean
}

/**
 * Unified sell command: encrypts file, uploads to Swarm, creates escrow.
 *
 * This is the complete seller flow in a single command:
 * 1. Validates file exists, is readable, and under size limit
 * 2. Encrypts file with AES-256-GCM, generates key commitment
 * 3. Computes content hash of encrypted data
 * 4. Validates Bee postage stamp
 * 5. Uploads encrypted data to Swarm
 * 6. Creates escrow on-chain with key commitment
 * 7. Stores encryption keys and Swarm ref in keychain
 *
 * @param opts - Sell options including file path and price
 * @param keychain - Keychain for storing/retrieving secrets
 * @returns SellResult with escrow ID and all references, or DryRunResult in dry-run mode
 *
 * @throws CLIError on file not found, permission denied, file too large,
 *         invalid stamp, Swarm upload failure, chain transaction failure
 *
 * @example
 * ```bash
 * # Sell data via escrow
 * ade sell --file ./data.csv --price 0.1 --yes
 *
 * # Dry run to validate without spending gas
 * ade sell --file ./data.csv --price 0.1 --dry-run
 * ```
 */
export async function sell(opts: SellOpts, keychain: Keychain = defaultKeychain): Promise<SellResult | DryRunResult> {
  if (!opts.dryRun) {
    requireConfirmation(opts)
  }

  // 1. Validate file exists and is readable
  console.error(`Reading file: ${opts.file}`)
  let fileData: Uint8Array
  let fileSize: number
  try {
    const fileStat = await stat(opts.file)
    if (!fileStat.isFile()) {
      throw new CLIError('ERR_INVALID_ARGUMENT', `Path is not a file: ${opts.file}`)
    }
    fileSize = fileStat.size

    // File size limit check
    if (fileSize > MAX_FILE_SIZE) {
      throw new CLIError(
        'ERR_INVALID_ARGUMENT',
        `File too large: ${formatBytes(fileSize)}, max ${formatBytes(MAX_FILE_SIZE)}`,
        'Consider splitting large files or using a streaming upload service'
      )
    }

    fileData = new Uint8Array(await readFile(opts.file))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CLIError('ERR_NOT_FOUND', `File not found: ${opts.file}`)
    }
    if ((err as NodeJS.ErrnoException).code === 'EACCES') {
      throw new CLIError('ERR_INVALID_ARGUMENT', `Permission denied: ${opts.file}`)
    }
    if (err instanceof CLIError) throw err
    throw new CLIError('ERR_API_ERROR', `Failed to read file: ${(err as Error).message}`)
  }
  console.error(`  File size: ${formatBytes(fileSize)}`)

  // 2. Encrypt file
  console.error(`Encrypting file...`)
  const { encryptedData, key, salt, keyCommitment } = encryptForEscrow(fileData)
  const encryptionKeyHex = toHex(key) as Hex
  const saltHex = toHex(salt) as Hex
  console.error(`  Encrypted size: ${formatBytes(encryptedData.length)}`)

  // 3. Compute content hash of encrypted data
  const contentHash = keccak256(encryptedData)
  console.error(`  Content hash: ${contentHash}`)

  // 4. Get BEE_API and check/create stamp
  const beeApi = await requireBeeApi(keychain)
  const existingStamp = await getBeeStamp(keychain)

  // 5. Get or create usable postage stamp
  console.error(`Checking postage stamp...`)
  const beeStamp = await getOrCreateStamp(existingStamp, { beeApi }, (msg) => console.error(msg))

  // Store stamp if newly created (different from existing)
  if (beeStamp !== existingStamp) {
    await keychain.set('BEE_STAMP', beeStamp)
    console.error(`  Saved new stamp to keychain: BEE_STAMP`)
  } else {
    console.error(`  Stamp valid`)
  }

  // 6. Get chain client for gas estimation (even in dry-run)
  const { pub, wallet, address, chainConfig } = await getChainClient(keychain)
  const amount = parseEther(opts.price)
  const nativeToken = '0x0000000000000000000000000000000000000000' as `0x${string}`

  // Estimate gas
  console.error(`Estimating gas on ${chainConfig.name}...`)
  const { gasCost } = await estimateAndValidateGas({
    pub,
    address: chainConfig.contracts.dataEscrow,
    functionName: 'createEscrow',
    args: [contentHash, keyCommitment, nativeToken, amount, DEFAULT_EXPIRY_DAYS],
    account: address,
  })

  console.error(`  Chain: ${chainConfig.name} (${chainConfig.chainId})`)
  console.error(`  Contract: ${chainConfig.contracts.dataEscrow}`)
  console.error(`  Price: ${opts.price} ETH`)
  console.error(`  From: ${address}`)
  console.error(`  Estimated gas: ~${formatEther(gasCost)} ETH`)

  // If dry-run, return validation results without executing
  if (opts.dryRun) {
    console.error(`\nDry run complete. No transactions executed.`)
    return {
      dryRun: true,
      contentHash,
      encryptionKey: encryptionKeyHex,
      salt: saltHex,
      keyCommitment,
      fileSize,
      encryptedSize: encryptedData.length,
      estimatedGas: formatEther(gasCost),
      chain: chainConfig.name,
      chainId: chainConfig.chainId,
      stampValid: true,
    }
  }

  await confirmAction('Create escrow?', opts)

  // 7. Upload to Swarm (only after confirmation, not in dry-run)
  console.error(`Uploading to Swarm...`)
  const { reference: swarmRef } = await uploadToSwarm(encryptedData, { beeApi, batchId: beeStamp })
  console.error(`  Swarm reference: ${swarmRef}`)

  // 8. Execute transaction
  console.error(`Creating escrow on ${chainConfig.name}...`)
  const { hash, receipt } = await executeContractTx({
    wallet, pub,
    address: chainConfig.contracts.dataEscrow,
    functionName: 'createEscrow',
    args: [contentHash, keyCommitment, nativeToken, amount, DEFAULT_EXPIRY_DAYS],
    chainConfig,
    description: 'Create escrow',
  })

  console.error(`  Block: ${receipt.blockNumber}`)

  // Parse escrow ID from logs using shared helper
  const escrowId = parseEscrowIdFromLogs(receipt.logs)

  if (escrowId === null) {
    // Include keys in error for recovery
    console.error(`\nIMPORTANT: Save these keys for manual recovery:`)
    console.error(`  Encryption Key: ${encryptionKeyHex}`)
    console.error(`  Salt: ${saltHex}`)
    console.error(`  Key Commitment: ${keyCommitment}`)
    console.error(`  Swarm Reference: ${swarmRef}`)

    throw new CLIError(
      'ERR_API_ERROR',
      'Could not extract escrow ID from transaction logs',
      `Transaction succeeded (${hash}). Check explorer: ${txLink(hash, chainConfig.explorer)}. Use 'ade escrows list' to find your escrow by content hash.`
    )
  }

  // 10. Store keys in keychain
  try {
    await storeEscrowKeys(escrowId, { encryptionKey: encryptionKeyHex, salt: saltHex }, keychain)
    // Also store Swarm reference and content hash
    await keychain.set(`ESCROW_${escrowId}_SWARM`, swarmRef)
    await keychain.set(`ESCROW_${escrowId}_CONTENT_HASH`, contentHash)
    console.error(`\nKeys stored in keychain:`)
    console.error(`  ESCROW_${escrowId}_KEY`)
    console.error(`  ESCROW_${escrowId}_SALT`)
    console.error(`  ESCROW_${escrowId}_SWARM`)
    console.error(`  ESCROW_${escrowId}_CONTENT_HASH`)
  } catch (err) {
    console.error(`\nWarning: Could not store keys in keychain: ${(err as Error).message}`)
    console.error('IMPORTANT: Save the encryption key, salt, and Swarm reference from the output!')
  }

  return {
    escrowId,
    txHash: hash,
    contentHash,
    swarmRef,
    encryptionKey: encryptionKeyHex,
    salt: saltHex,
    keyCommitment,
    chain: chainConfig.name,
    chainId: chainConfig.chainId,
    explorer: txLink(hash, chainConfig.explorer),
    fileSize,
    encryptedSize: encryptedData.length,
  }
}

/** @deprecated Use `sell` instead */
export const create = sell

// Type aliases for backward compatibility
export type CreateOpts = SellOpts
export type CreateResult = SellResult

/**
 * Format bytes as human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

// ── Escrow Status Command ──

/** Escrow states from contract */
const ESCROW_STATES = ['Created', 'Funded', 'KeyCommitted', 'Released', 'Claimed', 'Cancelled', 'Disputed', 'Expired'] as const

export interface EscrowStatusResult {
  escrowId: number
  state: string
  stateCode: number
  hasLocalKeys: boolean
  hasSwarmRef: boolean
  hasContentHash: boolean
  onChain: {
    seller: string
    buyer: string
    contentHash: string
    amount: string
    expiresAt: string
    disputeWindow: string
  }
  local: {
    encryptionKey?: string
    salt?: string
    swarmRef?: string
    contentHash?: string
  }
}

/**
 * Get status of an escrow including local key availability and on-chain state.
 */
export async function escrowsStatus(id: string, keychain: Keychain = defaultKeychain): Promise<EscrowStatusResult> {
  const { pub, chainConfig } = await getChainClient(keychain)
  const escrowId = parseBigInt(id, 'escrow ID')

  // Read escrow from chain
  const escrowData = await getEscrowFromChain(pub, chainConfig.contracts.dataEscrow, escrowId)
  if (!escrowData) {
    throw new CLIError('ERR_NOT_FOUND', `Escrow #${id} not found`)
  }

  // Check local keys
  const localKeys = await getEscrowKeys(parseInt(id, 10), keychain)
  const swarmRef = await keychain.get(`ESCROW_${id}_SWARM`)
  const contentHash = await keychain.get(`ESCROW_${id}_CONTENT_HASH`)

  const mask = (v?: string | null) => {
    if (!v) return undefined
    if (v.length <= 12) return '(set)'
    return `${v.slice(0, 10)}...${v.slice(-6)}`
  }

  return {
    escrowId: parseInt(id, 10),
    state: ESCROW_STATES[escrowData.state] || `Unknown(${escrowData.state})`,
    stateCode: escrowData.state,
    hasLocalKeys: !!localKeys,
    hasSwarmRef: !!swarmRef,
    hasContentHash: !!contentHash,
    onChain: {
      seller: escrowData.seller,
      buyer: escrowData.buyer || '0x0000000000000000000000000000000000000000',
      contentHash: escrowData.contentHash,
      amount: formatEther(escrowData.amount) + ' ETH',
      expiresAt: new Date(Number(escrowData.expiresAt) * 1000).toISOString(),
      disputeWindow: `${escrowData.disputeWindow_}s`,
    },
    local: {
      encryptionKey: mask(localKeys?.encryptionKey),
      salt: mask(localKeys?.salt),
      swarmRef: mask(swarmRef),
      contentHash: mask(contentHash),
    },
  }
}

// ── Buy Command ──

export interface BuyOpts {
  /** Escrow ID to purchase */
  escrowId: string
  /** Output file path (default: escrow_{id}_data) */
  output?: string
  /** Seconds to wait for key reveal (default: 86400 = 24h) */
  waitTimeout?: number
  /** Skip confirmation prompt */
  yes?: boolean
}

export interface BuyResult {
  escrowId: number
  fundTxHash: Hex
  outputFile: string
  contentHash: Hex
  verified: boolean
  decryptedSize: number
  ecdhDecrypted?: boolean
}

/**
 * Complete buyer flow: fund escrow, wait for key reveal, download, decrypt.
 *
 * This command handles the entire purchase process:
 * 1. Reads escrow details from chain (price, seller, content hash)
 * 2. Verifies user has sufficient balance
 * 3. Funds the escrow
 * 4. Polls for KeyRevealed event (with configurable timeout)
 * 5. Downloads encrypted data from Swarm
 * 6. Verifies content hash matches on-chain hash
 * 7. Decrypts data with revealed key
 * 8. Writes to output file
 *
 * @param opts - Buy options including escrow ID and output path
 * @param keychain - Keychain for retrieving secrets
 * @returns BuyResult with transaction hash and output file details
 */
export async function buy(opts: BuyOpts, keychain: Keychain = defaultKeychain): Promise<BuyResult> {
  requireConfirmation(opts)
  const { pub, wallet, address, chainConfig } = await getChainClient(keychain)
  const escrowId = parseBigInt(opts.escrowId, 'escrow ID')
  const waitTimeout = opts.waitTimeout ?? DEFAULT_KEY_WAIT_TIMEOUT

  // Check for active Fairdrop account (optional but recommended)
  const account = getActiveAccount()
  if (account) {
    console.error(`Using Fairdrop account: ${account.subdomain}`)
    console.error(`  Your public key for ECDH: ${publicKeyToHex(account.publicKey)}`)
    console.error(`  Share this with the seller for secure key exchange`)
  } else {
    console.error(`No Fairdrop account unlocked. ECDH key exchange will not be available.`)
    console.error(`Tip: Run 'ade account create' and 'ade account unlock' for secure key exchange.`)
  }

  // 1. Read escrow details from chain
  console.error(`Reading escrow #${opts.escrowId}...`)
  const escrowData = await getEscrowFromChain(pub, chainConfig.contracts.dataEscrow, escrowId)
  if (!escrowData) {
    throw new CLIError('ERR_NOT_FOUND', `Escrow #${opts.escrowId} not found`)
  }

  const { seller, contentHash, amount, state } = escrowData

  // Validate escrow state
  if (state !== 0) {
    throw new CLIError('ERR_INVALID_ARGUMENT', `Escrow #${opts.escrowId} is not in Created state (current: ${ESCROW_STATES[state] || state})`)
  }

  console.error(`  Seller: ${seller}`)
  console.error(`  Price: ${formatEther(amount)} ETH`)
  console.error(`  Content Hash: ${contentHash}`)

  // 2. Get Swarm reference from keychain or require it
  let swarmRef = await keychain.get(`ESCROW_${opts.escrowId}_SWARM`)
  if (!swarmRef) {
    // Try to get from API if available
    try {
      const apiEscrow = await apiFetch<{ swarmRef?: string }>(`/escrows/${opts.escrowId}`)
      swarmRef = apiEscrow.swarmRef
    } catch {
      // API lookup failed, that's okay
    }
  }

  if (!swarmRef) {
    throw new CLIError(
      'ERR_MISSING_KEY',
      `Swarm reference not found for escrow #${opts.escrowId}`,
      'The seller should provide the Swarm reference, or set it with: ade set ESCROW_<id>_SWARM'
    )
  }

  // 3. Estimate gas and check balance
  const { gasCost } = await estimateAndValidateGas({
    pub,
    address: chainConfig.contracts.dataEscrow,
    functionName: 'fundEscrow',
    args: [escrowId],
    value: amount,
    account: address,
  })
  const totalRequired = amount + gasCost

  const balance = await pub.getBalance({ address })
  if (balance < totalRequired) {
    throw new CLIError(
      'ERR_INSUFFICIENT_BALANCE',
      `Insufficient balance: ${formatEther(balance)} ETH, need ${formatEther(amount)} ETH + ~${formatEther(gasCost)} ETH gas`
    )
  }

  console.error(`\nFunding escrow #${opts.escrowId} with ${formatEther(amount)} ETH...`)
  console.error(`  Estimated gas: ~${formatEther(gasCost)} ETH`)
  await confirmAction('Confirm funding?', opts)

  // 4. Fund escrow
  const { hash: fundHash } = await executeContractTx({
    wallet, pub,
    address: chainConfig.contracts.dataEscrow,
    functionName: 'fundEscrow',
    args: [escrowId],
    value: amount,
    chainConfig,
    description: 'Fund escrow',
  })
  console.error(`  Funded successfully`)


  // 5. Wait for key reveal
  console.error(`\nWaiting for seller to reveal key (timeout: ${waitTimeout}s)...`)
  console.error(`  This may take a while. The seller needs to call commit-key then reveal-key.`)

  const revealedKey = await waitForKeyRevealed(
    pub,
    chainConfig.contracts.dataEscrow,
    parseInt(opts.escrowId, 10),
    waitTimeout
  )

  console.error(`  Key revealed: ${revealedKey.slice(0, 20)}...`)

  // 6. Download encrypted data from Swarm
  console.error(`\nDownloading from Swarm...`)
  const beeApi = await keychain.get('BEE_API') || process.env.BEE_API
  if (!beeApi) {
    throw new CLIError('ERR_MISSING_KEY', 'BEE_API not configured', 'Use: ade set BEE_API')
  }

  const encryptedData = await downloadFromSwarm(swarmRef, { beeApi })
  console.error(`  Downloaded: ${formatBytes(encryptedData.length)}`)

  // 7. Verify content hash
  const downloadedHash = keccak256(encryptedData)
  const verified = downloadedHash.toLowerCase() === contentHash.toLowerCase()
  if (!verified) {
    throw new CLIError(
      'ERR_INVALID_ARGUMENT',
      'Content hash mismatch! Downloaded data does not match on-chain hash.',
      'The data may be corrupted or tampered with. Consider raising a dispute.'
    )
  }
  console.error(`  Content hash verified`)

  // 8. Decrypt data
  console.error(`Decrypting...`)

  // Determine if key is ECDH-encrypted or raw
  // ECDH-encrypted keys are longer (33 pubkey + 12 iv + encrypted key with tag)
  // Raw keys are exactly 32 bytes (64 hex chars + 0x prefix = 66 chars)
  const revealedKeyBytes = hexToBytes(revealedKey)
  let keyBytes: Uint8Array
  let ecdhDecrypted = false

  if (revealedKeyBytes.length === 32) {
    // Raw key (legacy mode)
    console.error(`  Using raw key (legacy mode)`)
    keyBytes = revealedKeyBytes
  } else if (revealedKeyBytes.length > 32 && account) {
    // ECDH-encrypted key
    console.error(`  Decrypting ECDH-encrypted key...`)
    try {
      const encrypted = deserializeEncryptedKey(revealedKeyBytes)
      keyBytes = decryptKeyAsBuyer(encrypted, account.privateKey)
      ecdhDecrypted = true
    } catch (err) {
      throw new CLIError(
        'ERR_INVALID_ARGUMENT',
        `Failed to decrypt ECDH key: ${(err as Error).message}`,
        'Make sure you have the correct Fairdrop account unlocked'
      )
    }
  } else if (revealedKeyBytes.length > 32) {
    // ECDH-encrypted but no account unlocked
    throw new CLIError(
      'ERR_MISSING_KEY',
      'Key is ECDH-encrypted but no Fairdrop account is unlocked',
      'Use: ade account unlock <subdomain>'
    )
  } else {
    throw new CLIError('ERR_INVALID_ARGUMENT', `Invalid key length: ${revealedKeyBytes.length}`)
  }

  const decrypted = decryptFromEscrow({
    encryptedData,
    key: keyBytes,
  })
  console.error(`  Decrypted size: ${formatBytes(decrypted.length)}`)

  // 9. Write to output file
  const outputFile = opts.output || `escrow_${opts.escrowId}_data`
  await writeFile(outputFile, decrypted)
  console.error(`  Saved to: ${outputFile}`)

  return {
    escrowId: parseInt(opts.escrowId, 10),
    fundTxHash: fundHash,
    outputFile,
    contentHash: contentHash as Hex,
    verified,
    decryptedSize: decrypted.length,
    ecdhDecrypted,
  }
}

// ── Account Commands ──

// In-memory session state for unlocked account
let activeAccount: {
  subdomain: string
  publicKey: Uint8Array
  privateKey: Uint8Array
  address: string
} | null = null

// Keychain storage keys
const FAIRDROP_ACCOUNTS_KEY = 'FAIRDROP_ACCOUNTS'
const FAIRDROP_KEYSTORE_PREFIX = 'FAIRDROP_KEYSTORE_'
const FAIRDROP_ACTIVE_KEY = 'FAIRDROP_ACTIVE'

/**
 * Get list of stored account subdomains.
 */
async function getStoredAccounts(keychain: Keychain): Promise<string[]> {
  const accounts = await keychain.get(FAIRDROP_ACCOUNTS_KEY)
  if (!accounts) return []
  try {
    return JSON.parse(accounts)
  } catch {
    return []
  }
}

/**
 * Add subdomain to stored accounts list.
 */
async function addStoredAccount(subdomain: string, keychain: Keychain): Promise<void> {
  const accounts = await getStoredAccounts(keychain)
  if (!accounts.includes(subdomain)) {
    accounts.push(subdomain)
    await keychain.set(FAIRDROP_ACCOUNTS_KEY, JSON.stringify(accounts))
  }
}

/**
 * Remove subdomain from stored accounts list.
 */
async function removeStoredAccount(subdomain: string, keychain: Keychain): Promise<void> {
  const accounts = await getStoredAccounts(keychain)
  const filtered = accounts.filter(a => a !== subdomain)
  await keychain.set(FAIRDROP_ACCOUNTS_KEY, JSON.stringify(filtered))
}

export interface AccountCreateResult {
  subdomain: string
  address: string
  publicKey: string
  ensName: string
  txHash: string
}

// FDS Identity API base URL
const FDS_IDENTITY_API = 'https://id.fairdatasociety.org'

/**
 * Check if an ENS name is available on Fairdrop.
 * @returns null if available, or the existing record if taken
 */
async function checkEnsAvailability(subdomain: string): Promise<{ exists: boolean; owner?: string; publicKey?: string }> {
  const url = `${FDS_IDENTITY_API}/api/ens/lookup/${encodeURIComponent(subdomain)}`
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    if (res.status === 404) {
      return { exists: false }
    }
    const body = await res.text().catch(() => '')
    throw new CLIError('ERR_API_ERROR', `ENS lookup failed: ${res.status} ${body}`)
  }

  const data = await res.json() as { exists: boolean; owner?: string; publicKey?: string }
  return data
}

/**
 * Register a subdomain on Fairdrop ENS.
 */
async function registerEns(subdomain: string, publicKey: string): Promise<{ ensName: string; txHash: string }> {
  const url = `${FDS_IDENTITY_API}/api/ens/register`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: subdomain, publicKey }),
    signal: AbortSignal.timeout(120000), // 2 min timeout for on-chain tx
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new CLIError('ERR_API_ERROR', `ENS registration failed: ${res.status} ${body}`)
  }

  const data = await res.json() as { success: boolean; ensName: string; txHash: string; error?: string }
  if (!data.success) {
    throw new CLIError('ERR_API_ERROR', `ENS registration failed: ${data.error || 'Unknown error'}`)
  }

  return { ensName: data.ensName, txHash: data.txHash }
}

/**
 * Create a new Fairdrop account.
 *
 * Flow:
 * 1. Check if name exists on ENS (fail if taken)
 * 2. Generate keypair locally
 * 3. Register with ENS
 * 4. Encrypt and store keystore locally
 *
 * @param subdomain - User's chosen name/subdomain
 * @param password - Password for encrypting the keystore
 * @param keychain - Keychain for storage
 * @returns Account details including ENS registration
 */
export async function accountCreate(
  subdomain: string,
  password: string,
  keychain: Keychain = defaultKeychain
): Promise<AccountCreateResult> {
  // Validate subdomain format
  if (!subdomain || subdomain.length < 1) {
    throw new CLIError('ERR_INVALID_ARGUMENT', 'Subdomain cannot be empty')
  }
  if (!/^[a-z0-9_-]+$/i.test(subdomain)) {
    throw new CLIError('ERR_INVALID_ARGUMENT', 'Subdomain can only contain letters, numbers, hyphens, and underscores')
  }

  // Check if account already exists locally
  const existingAccounts = await getStoredAccounts(keychain)
  if (existingAccounts.includes(subdomain)) {
    throw new CLIError('ERR_INVALID_ARGUMENT', `Account "${subdomain}" already exists locally`)
  }

  // Validate password
  const passwordError = validatePassword(password)
  if (passwordError) {
    throw new CLIError('ERR_INVALID_ARGUMENT', passwordError)
  }

  // Step 1: Check ENS availability
  console.error(`Checking ENS availability for "${subdomain}"...`)
  const ensCheck = await checkEnsAvailability(subdomain)
  if (ensCheck.exists) {
    throw new CLIError(
      'ERR_INVALID_ARGUMENT',
      `Name "${subdomain}" is already registered on ENS`,
      `Owner: ${ensCheck.owner || 'unknown'}`
    )
  }
  console.error(`  Name "${subdomain}" is available`)

  // Step 2: Generate keypair
  console.error('Generating keypair...')
  const keypair = generateKeyPair()
  const addressBytes = publicKeyToAddress(keypair.publicKey)
  const address = addressToHex(addressBytes)
  const publicKeyHex = publicKeyToHex(keypair.publicKey)
  console.error(`  Address: ${address}`)
  console.error(`  Public key: ${publicKeyHex}`)

  // Step 3: Register with ENS
  console.error('Registering with ENS (this may take a moment)...')
  let ensResult: { ensName: string; txHash: string }
  try {
    ensResult = await registerEns(subdomain, publicKeyHex)
  } catch (err) {
    // Clear private key on failure
    keypair.privateKey.fill(0)
    throw err
  }
  console.error(`  ENS name: ${ensResult.ensName}`)
  console.error(`  Tx hash: ${ensResult.txHash}`)

  // Step 4: Encrypt and store keystore
  console.error('Encrypting keystore (this may take a moment)...')
  const payload: KeystorePayload = {
    subdomain,
    publicKey: publicKeyHex,
    privateKey: '0x' + Array.from(keypair.privateKey, b => b.toString(16).padStart(2, '0')).join(''),
    created: Date.now(),
  }
  const keystoreJson = createKeystore(payload, password)

  await keychain.set(`${FAIRDROP_KEYSTORE_PREFIX}${subdomain}`, keystoreJson)
  await addStoredAccount(subdomain, keychain)

  // Store ENS registration info and public info (unencrypted, for status without unlock)
  await keychain.set(`FAIRDROP_ENS_${subdomain}`, ensResult.ensName)
  await keychain.set(`FAIRDROP_TXHASH_${subdomain}`, ensResult.txHash)
  await keychain.set(`FAIRDROP_PUBKEY_${subdomain}`, publicKeyHex)
  await keychain.set(`FAIRDROP_ADDRESS_${subdomain}`, address)

  // Clear private key from memory
  keypair.privateKey.fill(0)

  console.error(`\nAccount created successfully!`)
  console.error(`  Subdomain: ${subdomain}`)
  console.error(`  ENS name: ${ensResult.ensName}`)

  return {
    subdomain,
    address,
    publicKey: publicKeyHex,
    ensName: ensResult.ensName,
    txHash: ensResult.txHash,
  }
}

export interface AccountUnlockResult {
  subdomain: string
  unlocked: boolean
  address: string
  publicKey: string
}

/**
 * Unlock a Fairdrop account for use.
 *
 * This also:
 * - Locks any previously unlocked account (if different)
 * - Sets SX_KEY to the account's private key for transaction signing
 *
 * @param subdomain - Account subdomain to unlock
 * @param password - Password to decrypt keystore
 * @param keychain - Keychain for storage
 * @returns Unlock result
 */
export async function accountUnlock(
  subdomain: string,
  password: string,
  keychain: Keychain = defaultKeychain
): Promise<AccountUnlockResult> {
  // Lock existing account if switching to a different one
  if (activeAccount && activeAccount.subdomain !== subdomain) {
    console.error(`Locking previous account: ${activeAccount.subdomain}`)
    activeAccount.privateKey.fill(0)
    activeAccount = null
  }

  // Get keystore
  const keystoreJson = await keychain.get(`${FAIRDROP_KEYSTORE_PREFIX}${subdomain}`)
  if (!keystoreJson) {
    throw new CLIError('ERR_NOT_FOUND', `Account "${subdomain}" not found`, 'Use: ade account create <subdomain>')
  }

  // Decrypt keystore
  console.error('Decrypting keystore (this may take a moment)...')
  let payload: KeystorePayload
  try {
    payload = parseKeystore(keystoreJson, password)
  } catch (err) {
    if ((err as Error).message.includes('Incorrect password')) {
      throw new CLIError('ERR_INVALID_ARGUMENT', 'Incorrect password')
    }
    throw err
  }

  // Store in session
  const privateKey = hexToBytes(payload.privateKey)
  const publicKey = hexToBytes(payload.publicKey)
  const addressBytes = publicKeyToAddress(publicKey)

  activeAccount = {
    subdomain: payload.subdomain,
    publicKey,
    privateKey,
    address: addressToHex(addressBytes),
  }

  // Store active account name
  await keychain.set(FAIRDROP_ACTIVE_KEY, subdomain)

  // Auto-set SX_KEY to account's private key for transaction signing
  await keychain.set('SX_KEY', payload.privateKey)
  console.error(`SX_KEY set to ${subdomain}'s private key`)

  console.error(`Account unlocked: ${subdomain}`)

  return {
    subdomain: payload.subdomain,
    unlocked: true,
    address: activeAccount.address,
    publicKey: payload.publicKey,
  }
}

export interface AccountLockResult {
  locked: boolean
  previousAccount?: string
}

/**
 * Lock the active account, clearing session state.
 *
 * @param keychain - Keychain for storage
 * @returns Lock result
 */
export async function accountLock(keychain: Keychain = defaultKeychain): Promise<AccountLockResult> {
  const previousAccount = activeAccount?.subdomain

  if (activeAccount) {
    // Clear private key from memory
    activeAccount.privateKey.fill(0)
    activeAccount = null
  }

  // Clear active account marker
  await keychain.remove(FAIRDROP_ACTIVE_KEY)

  if (previousAccount) {
    console.error(`Account locked: ${previousAccount}`)
  }

  return {
    locked: true,
    previousAccount,
  }
}

export interface AccountStatusResult {
  active: boolean
  subdomain?: string
  publicKey?: string
  address?: string
  ensName?: string
  txHash?: string
}

/**
 * Get status of an account (no unlock required).
 *
 * If subdomain is provided, shows public info for that account.
 * If no subdomain, shows active account (if any) or first available account.
 *
 * @param subdomain - Optional subdomain to check
 * @param keychain - Keychain for storage
 * @returns Account status including ENS info
 */
export async function accountStatus(subdomain?: string, keychain: Keychain = defaultKeychain): Promise<AccountStatusResult> {
  // Determine which account to show
  let targetSubdomain = subdomain

  if (!targetSubdomain) {
    // Check for active (unlocked) account first
    if (activeAccount) {
      targetSubdomain = activeAccount.subdomain
    } else {
      // Fall back to first stored account
      const accounts = await getStoredAccounts(keychain)
      if (accounts.length === 0) {
        return { active: false }
      }
      targetSubdomain = accounts[0]
    }
  }

  // Check if account exists
  const accounts = await getStoredAccounts(keychain)
  if (!accounts.includes(targetSubdomain)) {
    throw new CLIError('ERR_NOT_FOUND', `Account "${targetSubdomain}" not found`)
  }

  // Read public info from keychain (no decrypt needed)
  const ensName = await keychain.get(`FAIRDROP_ENS_${targetSubdomain}`)
  const txHash = await keychain.get(`FAIRDROP_TXHASH_${targetSubdomain}`)
  const publicKey = await keychain.get(`FAIRDROP_PUBKEY_${targetSubdomain}`)
  const address = await keychain.get(`FAIRDROP_ADDRESS_${targetSubdomain}`)

  const isActive = activeAccount?.subdomain === targetSubdomain

  return {
    active: isActive,
    subdomain: targetSubdomain,
    publicKey: publicKey || undefined,
    address: address || undefined,
    ensName: ensName || undefined,
    txHash: txHash || undefined,
  }
}

export interface AccountListResult {
  accounts: Array<{
    subdomain: string
    active: boolean
  }>
}

/**
 * List all stored accounts.
 *
 * @param keychain - Keychain for storage
 * @returns List of accounts
 */
export async function accountList(keychain: Keychain = defaultKeychain): Promise<AccountListResult> {
  const subdomains = await getStoredAccounts(keychain)
  const activeSubdomain = activeAccount?.subdomain

  return {
    accounts: subdomains.map(subdomain => ({
      subdomain,
      active: subdomain === activeSubdomain,
    })),
  }
}

export interface AccountExportResult {
  subdomain: string
  keystore: string
}

/**
 * Export an account's keystore for backup.
 *
 * @param subdomain - Account subdomain to export
 * @param keychain - Keychain for storage
 * @returns Keystore JSON
 */
export async function accountExport(
  subdomain: string,
  keychain: Keychain = defaultKeychain
): Promise<AccountExportResult> {
  const keystoreJson = await keychain.get(`${FAIRDROP_KEYSTORE_PREFIX}${subdomain}`)
  if (!keystoreJson) {
    throw new CLIError('ERR_NOT_FOUND', `Account "${subdomain}" not found`)
  }

  return {
    subdomain,
    keystore: keystoreJson,
  }
}

export interface AccountDeleteResult {
  deleted: boolean
  subdomain: string
}

/**
 * Delete an account.
 *
 * @param subdomain - Account subdomain to delete
 * @param confirm - Must be true to confirm deletion
 * @param keychain - Keychain for storage
 * @returns Delete result
 */
export async function accountDelete(
  subdomain: string,
  confirm: boolean,
  keychain: Keychain = defaultKeychain
): Promise<AccountDeleteResult> {
  if (!confirm) {
    throw new CLIError('ERR_CONFIRMATION_REQUIRED', 'Must confirm deletion with --yes flag')
  }

  const keystoreJson = await keychain.get(`${FAIRDROP_KEYSTORE_PREFIX}${subdomain}`)
  if (!keystoreJson) {
    throw new CLIError('ERR_NOT_FOUND', `Account "${subdomain}" not found`)
  }

  // If this is the active account, lock it first
  if (activeAccount?.subdomain === subdomain) {
    await accountLock(keychain)
  }

  // Delete keystore and remove from list
  await keychain.remove(`${FAIRDROP_KEYSTORE_PREFIX}${subdomain}`)
  await removeStoredAccount(subdomain, keychain)

  console.error(`Account deleted: ${subdomain}`)

  return {
    deleted: true,
    subdomain,
  }
}

/**
 * Get the active account, throwing if none is unlocked.
 * Used by other commands that require an active account.
 */
export function requireActiveAccount(): typeof activeAccount & object {
  if (!activeAccount) {
    throw new CLIError(
      'ERR_MISSING_KEY',
      'No active Fairdrop account',
      'Use: ade account unlock <subdomain>'
    )
  }
  return activeAccount
}

/**
 * Get active account if available (non-throwing version).
 */
export function getActiveAccount(): typeof activeAccount {
  return activeAccount
}

// ── Respond Command (Bounty Response) ──

export interface RespondOpts {
  /** Bounty ID to respond to */
  bountyId: string
  /** File to deliver */
  file: string
  /** Optional message to bounty creator */
  message?: string
  /** Skip confirmation prompt */
  yes?: boolean
}

export interface RespondResult extends CreateResult {
  bountyId: string
  bountyTitle: string
  bountyReward: string
  linkedAt: string
}

/**
 * Respond to a bounty by creating an escrow with the deliverable.
 *
 * This command handles the complete bounty response flow:
 * 1. Fetches bounty details from API (reward, requirements, creator)
 * 2. Displays bounty info and confirms response
 * 3. Runs full create() flow (encrypt, upload, create escrow)
 * 4. Links escrow to bounty via API call
 *
 * @param opts - Respond options including bounty ID and file
 * @param keychain - Keychain for retrieving secrets
 * @returns RespondResult with escrow details and bounty link
 */
export async function respond(opts: RespondOpts, keychain: Keychain = defaultKeychain): Promise<RespondResult> {
  requireConfirmation(opts)

  // 1. Fetch bounty details
  console.error(`Fetching bounty #${opts.bountyId}...`)
  const bounty = await apiFetch<{
    id: string
    title: string
    rewardAmount: string
    description?: string
    status: string
    creator: string
  }>(`/bounties/${encodeURIComponent(opts.bountyId)}`)

  if (!bounty) {
    throw new CLIError('ERR_NOT_FOUND', `Bounty #${opts.bountyId} not found`)
  }

  console.error(`  Title: ${bounty.title}`)
  console.error(`  Reward: ${bounty.rewardAmount} ETH`)
  console.error(`  Status: ${bounty.status}`)
  console.error(`  Creator: ${bounty.creator}`)

  if (bounty.status !== 'open') {
    throw new CLIError('ERR_INVALID_ARGUMENT', `Bounty is not open (status: ${bounty.status})`)
  }

  // 2. Confirm response
  console.error(`\nResponding to bounty with file: ${opts.file}`)
  await confirmAction('Create escrow response?', opts)

  // 3. Run sell flow
  // Use bounty reward as price
  const createResult = await sell({
    file: opts.file,
    price: bounty.rewardAmount,
    title: `Response to: ${bounty.title}`,
    description: opts.message || `Deliverable for bounty #${opts.bountyId}`,
    yes: true, // Already confirmed above
  }, keychain)

  // Handle dry-run result
  if ('dryRun' in createResult && createResult.dryRun) {
    throw new CLIError('ERR_INVALID_ARGUMENT', 'Cannot use dry-run mode with respond command')
  }

  const escrowResult = createResult as SellResult

  // 4. Link escrow to bounty via API
  console.error(`\nLinking escrow to bounty...`)
  const key = await requireKey(keychain)
  try {
    await apiPost(`/bounties/${encodeURIComponent(opts.bountyId)}/responses`, {
      escrowId: escrowResult.escrowId,
      message: opts.message,
    }, key)
    console.error(`  Linked successfully`)
  } catch (err) {
    console.error(`  Warning: Could not link to bounty API: ${(err as Error).message}`)
    console.error(`  The escrow was created, but you may need to manually notify the bounty creator.`)
  }

  return {
    ...escrowResult,
    bountyId: opts.bountyId,
    bountyTitle: bounty.title,
    bountyReward: bounty.rewardAmount,
    linkedAt: new Date().toISOString(),
  }
}

