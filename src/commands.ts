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
import { uploadToSwarm, checkStampValid, downloadFromSwarm } from './swarm'
import { parseEscrowIdFromLogs, waitForKeyRevealed } from './utils/events'
import * as defaultKeychain from './keychain'
import type { Keychain } from './secrets'

const GAS_SAFETY_CAP = parseEther('0.01')
const CHAIN_TIMEOUT_MS = 60_000
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

/**
 * Format transaction link for explorer.
 */
function txLink(hash: string, explorer: string): string {
  return `${explorer}/tx/${hash}`
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

  // Estimate gas with actual contract call
  const gasEstimate = await pub.estimateContractGas({
    address: chainConfig.escrowAddress,
    abi: DataEscrowABI,
    functionName: 'createEscrow',
    args: [contentHash, keyCommitment, nativeToken, amount, DEFAULT_EXPIRY_DAYS],
    account: address,
  }).catch((err) => {
    throw new CLIError('ERR_API_ERROR', `Gas estimation failed: ${err.message}`, 'Check RPC connection and contract state')
  })

  const gasPrice = await pub.getGasPrice().catch(() => {
    throw new CLIError('ERR_API_ERROR', 'Could not fetch gas price', 'Check RPC connection')
  })
  const gasCost = gasEstimate * gasPrice

  console.error(`Chain: ${chainConfig.name} (${chainConfig.chainId})`)
  console.error(`Contract: ${chainConfig.escrowAddress}`)
  console.error(`Create escrow: ${opts.price} ETH`)
  console.error(`From: ${address}`)
  console.error(`Estimated gas cost: ~${formatEther(gasCost)} ETH`)

  if (gasCost > GAS_SAFETY_CAP) {
    throw new CLIError('ERR_GAS_TOO_HIGH', `Gas cost ${formatEther(gasCost)} ETH exceeds safety cap of ${formatEther(GAS_SAFETY_CAP)} ETH`, 'Network may be congested, try again later')
  }

  await confirmAction('Confirm transaction?', opts)

  const hash = await wallet.writeContract({
    address: chainConfig.escrowAddress,
    abi: DataEscrowABI,
    functionName: 'createEscrow',
    args: [contentHash, keyCommitment, nativeToken, amount, DEFAULT_EXPIRY_DAYS],
  })

  console.error(`Transaction: ${hash}`)
  console.error(`Explorer: ${txLink(hash, chainConfig.explorer)}`)

  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: CHAIN_TIMEOUT_MS })

  if (receipt.status === 'reverted') {
    throw new CLIError('ERR_TX_REVERTED', 'Transaction reverted', 'Check contract state and parameters')
  }

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

export async function escrowsFund(id: string, opts: { yes?: boolean }, keychain: Keychain = defaultKeychain) {
  requireConfirmation(opts)
  const { pub, wallet, address, chainConfig } = await getChainClient(keychain)
  const escrowId = parseBigInt(id, 'escrow ID')

  // Read amount from on-chain contract (never trust off-chain API for tx params)
  const escrowData = await pub.readContract({
    address: chainConfig.escrowAddress,
    abi: DataEscrowABI,
    functionName: 'getEscrow',
    args: [escrowId],
  }).catch(() => null) as { amount?: bigint } | null

  const amount = escrowData?.amount ?? 0n
  if (amount === 0n) {
    throw new CLIError('ERR_NOT_FOUND', `Escrow #${id} not found or has zero amount`)
  }

  console.error(`Chain: ${chainConfig.name} (${chainConfig.chainId})`)
  console.error(`Fund escrow #${id}: ${formatEther(amount)} ETH`)
  console.error(`From: ${address}`)

  await confirmAction('Confirm transaction?', opts)

  const hash = await wallet.writeContract({
    address: chainConfig.escrowAddress,
    abi: DataEscrowABI,
    functionName: 'fundEscrow',
    args: [escrowId],
    value: amount,
  })

  console.error(`Transaction: ${hash}`)
  console.error(`Explorer: ${txLink(hash, chainConfig.explorer)}`)

  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: CHAIN_TIMEOUT_MS })
  if (receipt.status === 'reverted') throw new CLIError('ERR_TX_REVERTED', 'Transaction reverted')

  return {
    txHash: hash,
    status: receipt.status,
    blockNumber: Number(receipt.blockNumber),
    chain: chainConfig.name,
    explorer: txLink(hash, chainConfig.explorer),
  }
}

export async function escrowsCommitKey(id: string, opts: { key?: string; salt?: string; yes?: boolean }, keychain: Keychain = defaultKeychain) {
  requireConfirmation(opts)
  const { pub, wallet, address, chainConfig } = await getChainClient(keychain)
  const escrowId = parseBigInt(id, 'escrow ID')

  // Try to get key/salt from keychain first, then fall back to opts
  let key = opts.key
  let salt = opts.salt

  if (!key || !salt) {
    const stored = await getEscrowKeys(parseInt(id, 10), keychain)
    if (stored) {
      key = key || stored.encryptionKey
      salt = salt || stored.salt
      console.error(`Using keys from keychain for escrow #${id}`)
    }
  }

  if (!key || !salt) {
    throw new CLIError('ERR_INVALID_ARGUMENT', 'Key and salt not found in keychain or --key/--salt flags', 'Keys should have been auto-stored on escrow create')
  }

  // Validate key and salt format
  const validatedKey = validateBytes32(key, 'Encryption key')
  const validatedSalt = validateBytes32(salt, 'Salt')

  // Compute commitment = keccak256(key || salt) — must match what was used at creation
  const commitment = keccak256(concat([validatedKey, validatedSalt]))

  console.error(`Chain: ${chainConfig.name} (${chainConfig.chainId})`)
  console.error(`Commit key for escrow #${id}`)
  console.error(`Commitment: ${commitment}`)
  console.error(`From: ${address}`)

  await confirmAction('Confirm transaction?', opts)

  const hash = await wallet.writeContract({
    address: chainConfig.escrowAddress,
    abi: DataEscrowABI,
    functionName: 'commitKeyRelease',
    args: [escrowId, commitment],
  })

  console.error(`Transaction: ${hash}`)
  console.error(`Explorer: ${txLink(hash, chainConfig.explorer)}`)

  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: CHAIN_TIMEOUT_MS })
  if (receipt.status === 'reverted') throw new CLIError('ERR_TX_REVERTED', 'Transaction reverted')

  return {
    txHash: hash,
    status: receipt.status,
    blockNumber: Number(receipt.blockNumber),
    chain: chainConfig.name,
    explorer: txLink(hash, chainConfig.explorer),
  }
}

export async function escrowsRevealKey(id: string, opts: { key?: string; salt?: string; yes?: boolean }, keychain: Keychain = defaultKeychain) {
  requireConfirmation(opts)
  const { pub, wallet, address, chainConfig } = await getChainClient(keychain)
  const escrowId = parseBigInt(id, 'escrow ID')

  // Try to get key/salt from keychain first, then fall back to opts
  let key = opts.key
  let salt = opts.salt

  if (!key || !salt) {
    const stored = await getEscrowKeys(parseInt(id, 10), keychain)
    if (stored) {
      key = key || stored.encryptionKey
      salt = salt || stored.salt
      console.error(`Using keys from keychain for escrow #${id}`)
    }
  }

  if (!key || !salt) {
    throw new CLIError('ERR_INVALID_ARGUMENT', 'Key and salt not found in keychain or --key/--salt flags', 'Keys should have been auto-stored on escrow create')
  }

  // Validate key and salt format
  const validatedKey = validateBytes32(key, 'Encryption key')
  const validatedSalt = validateBytes32(salt, 'Salt')

  console.error(`Chain: ${chainConfig.name} (${chainConfig.chainId})`)
  console.error(`Reveal key for escrow #${id}`)
  console.error(`From: ${address}`)

  await confirmAction('Confirm transaction?', opts)

  // For reveal, we pass the encryption key as bytes (the buyer will decrypt with their key)
  const hash = await wallet.writeContract({
    address: chainConfig.escrowAddress,
    abi: DataEscrowABI,
    functionName: 'revealKey',
    args: [escrowId, validatedKey, validatedSalt],
  })

  console.error(`Transaction: ${hash}`)
  console.error(`Explorer: ${txLink(hash, chainConfig.explorer)}`)

  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: CHAIN_TIMEOUT_MS })
  if (receipt.status === 'reverted') throw new CLIError('ERR_TX_REVERTED', 'Transaction reverted')

  return {
    txHash: hash,
    status: receipt.status,
    blockNumber: Number(receipt.blockNumber),
    chain: chainConfig.name,
    explorer: txLink(hash, chainConfig.explorer),
  }
}

export async function escrowsClaim(id: string, opts: { yes?: boolean }, keychain: Keychain = defaultKeychain) {
  requireConfirmation(opts)
  const { pub, wallet, address, chainConfig } = await getChainClient(keychain)
  const escrowId = parseBigInt(id, 'escrow ID')

  console.error(`Chain: ${chainConfig.name} (${chainConfig.chainId})`)
  console.error(`Claim payment for escrow #${id}`)
  console.error(`From: ${address}`)

  await confirmAction('Confirm transaction?', opts)

  const hash = await wallet.writeContract({
    address: chainConfig.escrowAddress,
    abi: DataEscrowABI,
    functionName: 'claimPayment',
    args: [escrowId],
  })

  console.error(`Transaction: ${hash}`)
  console.error(`Explorer: ${txLink(hash, chainConfig.explorer)}`)

  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: CHAIN_TIMEOUT_MS })
  if (receipt.status === 'reverted') throw new CLIError('ERR_TX_REVERTED', 'Transaction reverted')

  return {
    txHash: hash,
    status: receipt.status,
    blockNumber: Number(receipt.blockNumber),
    chain: chainConfig.name,
    explorer: txLink(hash, chainConfig.explorer),
  }
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
      escrowAddress: c.escrowAddress,
      defaultRpc: c.defaultRpc,
    })),
  }
}

// ── Create Command (Unified Escrow Creation) ──

export interface CreateResult {
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

export interface CreateOpts {
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
 * Unified create command: encrypts file, uploads to Swarm, creates escrow.
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
 * @param opts - Create options including file path and price
 * @param keychain - Keychain for storing/retrieving secrets
 * @returns CreateResult with escrow ID and all references, or DryRunResult in dry-run mode
 *
 * @throws CLIError on file not found, permission denied, file too large,
 *         invalid stamp, Swarm upload failure, chain transaction failure
 *
 * @example
 * ```bash
 * # Create escrow from file
 * ade create --file ./data.csv --price 0.1 --yes
 *
 * # Dry run to validate without spending gas
 * ade create --file ./data.csv --price 0.1 --dry-run
 * ```
 */
export async function create(opts: CreateOpts, keychain: Keychain = defaultKeychain): Promise<CreateResult | DryRunResult> {
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

  // 4. Get BEE_API and BEE_STAMP from keychain
  const beeApi = await keychain.get('BEE_API') || process.env.BEE_API
  const beeStamp = await keychain.get('BEE_STAMP') || process.env.BEE_STAMP

  if (!beeApi) {
    throw new CLIError('ERR_MISSING_KEY', 'BEE_API not configured', 'Use: ade set BEE_API (e.g., http://localhost:1633)')
  }
  if (!beeStamp) {
    throw new CLIError('ERR_MISSING_KEY', 'BEE_STAMP not configured', 'Use: ade set BEE_STAMP (64-char hex batch ID)')
  }

  // Validate stamp format
  if (!/^[0-9a-f]{64}$/i.test(beeStamp)) {
    throw new CLIError('ERR_INVALID_ARGUMENT', 'BEE_STAMP must be 64 hex characters')
  }

  // 5. Check stamp validity
  console.error(`Checking postage stamp...`)
  await checkStampValid(beeStamp, { beeApi })
  console.error(`  Stamp valid`)

  // 6. Get chain client for gas estimation (even in dry-run)
  const { pub, wallet, address, chainConfig } = await getChainClient(keychain)
  const amount = parseEther(opts.price)
  const nativeToken = '0x0000000000000000000000000000000000000000' as `0x${string}`

  // Estimate gas
  console.error(`Estimating gas on ${chainConfig.name}...`)
  const gasEstimate = await pub.estimateContractGas({
    address: chainConfig.escrowAddress,
    abi: DataEscrowABI,
    functionName: 'createEscrow',
    args: [contentHash, keyCommitment, nativeToken, amount, DEFAULT_EXPIRY_DAYS],
    account: address,
  }).catch((err) => {
    throw new CLIError('ERR_API_ERROR', `Gas estimation failed: ${err.message}`, 'Check RPC connection and contract state')
  })

  const gasPrice = await pub.getGasPrice().catch(() => {
    throw new CLIError('ERR_API_ERROR', 'Could not fetch gas price', 'Check RPC connection')
  })
  const gasCost = gasEstimate * gasPrice

  console.error(`  Chain: ${chainConfig.name} (${chainConfig.chainId})`)
  console.error(`  Contract: ${chainConfig.escrowAddress}`)
  console.error(`  Price: ${opts.price} ETH`)
  console.error(`  From: ${address}`)
  console.error(`  Estimated gas: ~${formatEther(gasCost)} ETH`)

  if (gasCost > GAS_SAFETY_CAP) {
    throw new CLIError('ERR_GAS_TOO_HIGH', `Gas cost ${formatEther(gasCost)} ETH exceeds safety cap of ${formatEther(GAS_SAFETY_CAP)} ETH`, 'Network may be congested, try again later')
  }

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
  const hash = await wallet.writeContract({
    address: chainConfig.escrowAddress,
    abi: DataEscrowABI,
    functionName: 'createEscrow',
    args: [contentHash, keyCommitment, nativeToken, amount, DEFAULT_EXPIRY_DAYS],
  })

  console.error(`  Transaction: ${hash}`)
  console.error(`  Explorer: ${txLink(hash, chainConfig.explorer)}`)

  // 9. Wait for confirmation and parse escrow ID
  console.error(`Waiting for confirmation...`)
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: CHAIN_TIMEOUT_MS })

  if (receipt.status === 'reverted') {
    throw new CLIError('ERR_TX_REVERTED', 'Transaction reverted', 'Check contract state and parameters')
  }

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
  const escrowData = await pub.readContract({
    address: chainConfig.escrowAddress,
    abi: DataEscrowABI,
    functionName: 'getEscrow',
    args: [escrowId],
  }).catch(() => null) as {
    seller: string
    buyer: string
    contentHash: string
    amount: bigint
    expiresAt: bigint
    disputeWindow_: bigint
    state: number
  } | null

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

  // 1. Read escrow details from chain
  console.error(`Reading escrow #${opts.escrowId}...`)
  const escrowData = await pub.readContract({
    address: chainConfig.escrowAddress,
    abi: DataEscrowABI,
    functionName: 'getEscrow',
    args: [escrowId],
  }).catch(() => null) as {
    seller: string
    buyer: string
    contentHash: Hex
    amount: bigint
    expiresAt: bigint
    state: number
  } | null

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

  // 3. Check balance
  const balance = await pub.getBalance({ address })
  if (balance < amount) {
    throw new CLIError(
      'ERR_INSUFFICIENT_BALANCE',
      `Insufficient balance: ${formatEther(balance)} ETH, need ${formatEther(amount)} ETH`
    )
  }

  console.error(`\nFunding escrow #${opts.escrowId} with ${formatEther(amount)} ETH...`)
  await confirmAction('Confirm funding?', opts)

  // 4. Fund escrow
  const fundHash = await wallet.writeContract({
    address: chainConfig.escrowAddress,
    abi: DataEscrowABI,
    functionName: 'fundEscrow',
    args: [escrowId],
    value: amount,
  })

  console.error(`  Transaction: ${fundHash}`)
  console.error(`  Explorer: ${txLink(fundHash, chainConfig.explorer)}`)

  const fundReceipt = await pub.waitForTransactionReceipt({ hash: fundHash, timeout: CHAIN_TIMEOUT_MS })
  if (fundReceipt.status === 'reverted') {
    throw new CLIError('ERR_TX_REVERTED', 'Fund transaction reverted')
  }
  console.error(`  Funded successfully`)

  // 5. Wait for key reveal
  console.error(`\nWaiting for seller to reveal key (timeout: ${waitTimeout}s)...`)
  console.error(`  This may take a while. The seller needs to call commit-key then reveal-key.`)

  const revealedKey = await waitForKeyRevealed(
    pub,
    chainConfig.escrowAddress,
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
  // The revealed key is the encryption key as bytes (already hex)
  const keyBytes = Buffer.from(revealedKey.slice(2), 'hex')
  const decrypted = decryptFromEscrow({
    encryptedData,
    key: new Uint8Array(keyBytes),
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
  }
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

  // 3. Run create flow
  // Use bounty reward as price
  const createResult = await create({
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

  const escrowResult = createResult as CreateResult

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

