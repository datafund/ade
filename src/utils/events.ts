/**
 * Event parsing utilities for DataEscrow contract.
 * Provides shared helpers for extracting data from transaction logs.
 */

import { decodeEventLog, type PublicClient, type Log, type Hex } from 'viem'
import { DataEscrowABI } from '../abi/DataEscrow'
import { CLIError } from '../errors'

/**
 * Parse escrow ID from transaction logs.
 * Looks for EscrowCreated event and extracts the escrowId.
 *
 * @param logs - Transaction receipt logs
 * @returns The escrow ID, or null if not found
 * @throws CLIError if event structure is invalid
 */
export function parseEscrowIdFromLogs(logs: Log[]): number | null {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: DataEscrowABI,
        data: log.data,
        topics: log.topics,
      })

      if (decoded.eventName === 'EscrowCreated') {
        // Runtime type validation
        const args = decoded.args as Record<string, unknown>
        if (typeof args?.escrowId !== 'bigint') {
          throw new CLIError(
            'ERR_API_ERROR',
            'Invalid EscrowCreated event structure: escrowId is not a bigint',
            'This may indicate a contract ABI mismatch'
          )
        }
        return Number(args.escrowId)
      }
    } catch (err) {
      // If it's our CLIError, rethrow it
      if (err instanceof CLIError) throw err
      // Otherwise, not this event, continue to next log
    }
  }
  return null
}

/**
 * Parse key from KeyRevealed event logs.
 *
 * @param logs - Transaction receipt logs
 * @param escrowId - The escrow ID to match
 * @returns The revealed key as hex, or null if not found
 */
export function parseKeyRevealedFromLogs(logs: Log[], escrowId: number): Hex | null {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: DataEscrowABI,
        data: log.data,
        topics: log.topics,
      })

      if (decoded.eventName === 'KeyRevealed') {
        const args = decoded.args as Record<string, unknown>
        if (typeof args?.escrowId !== 'bigint') continue

        if (Number(args.escrowId) === escrowId) {
          // encryptedKeyForBuyer is a bytes field
          const keyBytes = args.encryptedKeyForBuyer
          if (typeof keyBytes === 'string') {
            return keyBytes as Hex
          }
        }
      }
    } catch {
      // Not this event, continue
    }
  }
  return null
}

/**
 * Options for waiting on contract events.
 */
export interface WaitForEventOptions {
  /** Public client for chain queries */
  pub: PublicClient
  /** Contract address to watch */
  address: Hex
  /** Event name to wait for */
  eventName: string
  /** Filter function to match specific event */
  filter: (args: Record<string, unknown>) => boolean
  /** Maximum time to wait in seconds */
  timeoutSeconds: number
  /** Polling interval in milliseconds (default: 5000) */
  pollIntervalMs?: number
  /** Starting block to search from (default: current block) */
  fromBlock?: bigint
}

/**
 * Wait for a specific contract event.
 * Polls the chain for matching events until found or timeout.
 *
 * @param options - Event polling options
 * @returns The matching event args
 * @throws CLIError on timeout
 */
export async function waitForEvent<T extends Record<string, unknown>>(
  options: WaitForEventOptions
): Promise<T> {
  const {
    pub,
    address,
    eventName,
    filter,
    timeoutSeconds,
    pollIntervalMs = 5000,
    fromBlock: startBlock,
  } = options

  const startTime = Date.now()
  const timeoutMs = timeoutSeconds * 1000
  let fromBlock = startBlock ?? await pub.getBlockNumber()

  while (Date.now() - startTime < timeoutMs) {
    try {
      const currentBlock = await pub.getBlockNumber()

      // Get logs from contract
      const logs = await pub.getLogs({
        address,
        fromBlock,
        toBlock: currentBlock,
      })

      // Check each log for matching event
      for (const log of logs) {
        try {
          const decoded = decodeEventLog({
            abi: DataEscrowABI,
            data: log.data,
            topics: log.topics,
          })

          if (decoded.eventName === eventName) {
            const args = decoded.args as Record<string, unknown>
            if (filter(args)) {
              return args as T
            }
          }
        } catch {
          // Not this event, continue
        }
      }

      // Update fromBlock to avoid re-scanning
      fromBlock = currentBlock + 1n

    } catch (err) {
      // Log query failed, continue polling
      console.error(`Event polling error: ${(err as Error).message}`)
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
  }

  throw new CLIError(
    'ERR_NETWORK_TIMEOUT',
    `Timed out waiting for ${eventName} event after ${timeoutSeconds}s`,
    'The seller may not have revealed the key yet. You can retry later.'
  )
}

/**
 * Wait for KeyRevealed event for a specific escrow.
 *
 * @param pub - Public client
 * @param address - Contract address
 * @param escrowId - Escrow ID to watch
 * @param timeoutSeconds - Maximum wait time
 * @returns The revealed key as hex
 */
export async function waitForKeyRevealed(
  pub: PublicClient,
  address: Hex,
  escrowId: number,
  timeoutSeconds: number
): Promise<Hex> {
  const result = await waitForEvent<{ escrowId: bigint; encryptedKeyForBuyer: Hex }>({
    pub,
    address,
    eventName: 'KeyRevealed',
    filter: (args) => Number(args.escrowId) === escrowId,
    timeoutSeconds,
    pollIntervalMs: 10000, // Poll every 10 seconds for key reveal
  })

  return result.encryptedKeyForBuyer
}
