/**
 * All CLI command handlers. Each returns data; formatting handled by caller.
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther, keccak256, concat, decodeEventLog, type PublicClient, type WalletClient, type Chain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import { randomBytes } from 'crypto'
import { apiFetch, apiPost, getBaseUrl } from './api'
import { CLIError } from './errors'
import { DataEscrowABI } from './abi/DataEscrow'
import { storeEscrowKeys, getEscrowKeys } from './escrow-keys'
import { getChainConfig, CHAIN_BY_ID, DEFAULT_CHAIN, DEFAULT_RPC, type ChainConfig } from './addresses'
import * as defaultKeychain from './keychain'
import type { Keychain } from './secrets'

const GAS_SAFETY_CAP = parseEther('0.01')
const CHAIN_TIMEOUT_MS = 60_000
const DEFAULT_EXPIRY_DAYS = 7n

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

  // Parse escrow ID from logs using viem's decodeEventLog
  let escrowId: number | undefined
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: DataEscrowABI,
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName === 'EscrowCreated') {
        escrowId = Number((decoded.args as { escrowId: bigint }).escrowId)
        break
      }
    } catch {
      // Not this event, continue
    }
  }

  // Always return keys in response (fix race condition)
  const result = {
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

  // Try to store keys in keychain, but don't fail if it doesn't work
  if (escrowId !== undefined) {
    try {
      await storeEscrowKeys(escrowId, { encryptionKey, salt }, keychain)
      console.error(`\nKeys stored in keychain: ESCROW_${escrowId}_KEY, ESCROW_${escrowId}_SALT`)
    } catch (err) {
      console.error(`\nWarning: Could not store keys in keychain: ${(err as Error).message}`)
      console.error('IMPORTANT: Save the encryption key and salt from the output below!')
    }
  } else {
    console.error(`\nWarning: Could not extract escrow ID from transaction logs`)
    console.error('IMPORTANT: Save the encryption key and salt from the output below!')
  }

  return result
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
