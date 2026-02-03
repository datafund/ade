/**
 * Chain transaction helpers to reduce duplication in command handlers.
 */

import { formatEther, type PublicClient, type WalletClient, type Hex, type TransactionReceipt, type Log } from 'viem'
import { CLIError } from '../errors'
import { DataEscrowABI } from '../abi/DataEscrow'
import type { ChainConfig } from '../addresses'
import { getEscrowKeys, type EscrowKeys } from '../escrow-keys'
import type { Keychain } from '../secrets'

const CHAIN_TIMEOUT_MS = 60_000
const GAS_SAFETY_CAP = BigInt('10000000000000000') // 0.01 ETH

/**
 * Format transaction link for explorer.
 */
export function txLink(hash: string, explorer: string): string {
  return `${explorer}/tx/${hash}`
}

/**
 * Validate receipt status and throw on revert.
 */
export function validateReceipt(receipt: TransactionReceipt, context?: string): void {
  if (receipt.status === 'reverted') {
    throw new CLIError(
      'ERR_TX_REVERTED',
      `Transaction reverted${context ? `: ${context}` : ''}`,
      'Check contract state and parameters'
    )
  }
}

/**
 * Execute a contract write and wait for confirmation.
 */
export interface ExecuteContractTxParams {
  wallet: WalletClient
  pub: PublicClient
  address: Hex
  functionName: string
  args: readonly unknown[]
  value?: bigint
  chainConfig: ChainConfig
  description?: string
}

export interface ExecuteContractTxResult {
  hash: Hex
  receipt: TransactionReceipt
}

export async function executeContractTx(
  params: ExecuteContractTxParams
): Promise<ExecuteContractTxResult> {
  const { wallet, pub, address, functionName, args, value, chainConfig, description } = params

  const hash = await wallet.writeContract({
    address,
    abi: DataEscrowABI,
    functionName,
    args,
    value,
  })

  console.error(`Transaction: ${hash}`)
  console.error(`Explorer: ${txLink(hash, chainConfig.explorer)}`)

  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: CHAIN_TIMEOUT_MS })
  validateReceipt(receipt, description)

  return { hash, receipt }
}

/**
 * Estimate gas and validate against safety cap.
 */
export interface EstimateGasParams {
  pub: PublicClient
  address: Hex
  functionName: string
  args: readonly unknown[]
  account: Hex
  value?: bigint
}

export interface GasEstimate {
  gasEstimate: bigint
  gasPrice: bigint
  gasCost: bigint
}

export async function estimateAndValidateGas(params: EstimateGasParams): Promise<GasEstimate> {
  const { pub, address, functionName, args, account, value } = params

  const gasEstimate = await pub.estimateContractGas({
    address,
    abi: DataEscrowABI,
    functionName,
    args,
    account,
    value,
  }).catch((err) => {
    throw new CLIError('ERR_API_ERROR', `Gas estimation failed: ${err.message}`, 'Check RPC connection and contract state')
  })

  const gasPrice = await pub.getGasPrice().catch(() => {
    throw new CLIError('ERR_API_ERROR', 'Could not fetch gas price', 'Check RPC connection')
  })

  const gasCost = gasEstimate * gasPrice

  if (gasCost > GAS_SAFETY_CAP) {
    throw new CLIError(
      'ERR_GAS_TOO_HIGH',
      `Gas cost ${formatEther(gasCost)} ETH exceeds safety cap of ${formatEther(GAS_SAFETY_CAP)} ETH`,
      'Network may be congested, try again later'
    )
  }

  return { gasEstimate, gasPrice, gasCost }
}

/**
 * Get escrow keys from keychain or flags with validation.
 */
export interface GetEscrowKeysParams {
  escrowId: number
  keychain: Keychain
  flagKey?: string
  flagSalt?: string
}

export async function getAndValidateEscrowKeys(params: GetEscrowKeysParams): Promise<EscrowKeys> {
  const { escrowId, keychain, flagKey, flagSalt } = params

  let key = flagKey
  let salt = flagSalt

  // Try keychain first if flags not provided
  if (!key || !salt) {
    const stored = await getEscrowKeys(escrowId, keychain)
    if (stored) {
      key = key || stored.encryptionKey
      salt = salt || stored.salt
      console.error(`Using keys from keychain for escrow #${escrowId}`)
    }
  }

  if (!key || !salt) {
    throw new CLIError(
      'ERR_INVALID_ARGUMENT',
      'Key and salt not found in keychain or --key/--salt flags',
      'Keys should have been auto-stored on escrow create'
    )
  }

  return { encryptionKey: key, salt }
}

/**
 * Read escrow data from chain.
 */
export interface EscrowData {
  seller: string
  buyer: string
  contentHash: Hex
  amount: bigint
  expiresAt: bigint
  disputeWindow_: bigint
  state: number
}

export async function getEscrowFromChain(
  pub: PublicClient,
  escrowAddress: Hex,
  escrowId: bigint
): Promise<EscrowData | null> {
  const escrowData = await pub.readContract({
    address: escrowAddress,
    abi: DataEscrowABI,
    functionName: 'getEscrow',
    args: [escrowId],
  }).catch(() => null) as EscrowData | null

  return escrowData
}

/**
 * Require BEE API and stamp configuration.
 */
export interface BeeConfig {
  beeApi: string
  beeStamp: string
}

export async function requireBeeConfig(keychain: Keychain): Promise<BeeConfig> {
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

  return { beeApi, beeStamp }
}

/**
 * Log chain transaction info consistently.
 */
export function logChainInfo(params: {
  chainConfig: ChainConfig
  address?: string
  action?: string
  escrowId?: string
  amount?: bigint
}): void {
  const { chainConfig, address, action, escrowId, amount } = params
  console.error(`Chain: ${chainConfig.name} (${chainConfig.chainId})`)
  if (action && escrowId) {
    console.error(`${action} escrow #${escrowId}${amount ? `: ${formatEther(amount)} ETH` : ''}`)
  }
  if (address) {
    console.error(`From: ${address}`)
  }
}

/**
 * Standard transaction result type.
 */
export interface TxResult {
  txHash: Hex
  status: 'success' | 'reverted'
  blockNumber: number
  chain: string
  explorer: string
}

export function formatTxResult(hash: Hex, receipt: TransactionReceipt, chainConfig: ChainConfig): TxResult {
  return {
    txHash: hash,
    status: receipt.status,
    blockNumber: Number(receipt.blockNumber),
    chain: chainConfig.name,
    explorer: txLink(hash, chainConfig.explorer),
  }
}
