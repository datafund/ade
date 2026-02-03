/**
 * Swarm upload/download via Bee HTTP API.
 */

import { CLIError } from './errors'

const DEFAULT_TIMEOUT = 60_000 // 60 seconds
const MAX_RETRIES = 3
const RETRY_DELAY = 1000 // 1 second

export interface SwarmConfig {
  /** Bee API URL (e.g., http://localhost:1633) */
  beeApi: string
  /** 64-char hex postage batch ID */
  batchId: string
}

export interface UploadResult {
  /** 64-char hex Swarm reference */
  reference: string
}

export interface StampInfo {
  batchID: string
  utilization: number
  usable: boolean
  depth: number
  amount: string
  blockNumber: number
}

/**
 * Upload data to Swarm.
 *
 * @param data - Binary data to upload
 * @param config - Swarm configuration (beeApi, batchId)
 * @returns Swarm reference (64-char hex)
 */
export async function uploadToSwarm(
  data: Uint8Array,
  config: SwarmConfig
): Promise<UploadResult> {
  const url = `${config.beeApi.replace(/\/$/, '')}/bytes`

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'swarm-postage-batch-id': config.batchId,
        },
        body: data,
      }, DEFAULT_TIMEOUT)

      if (!response.ok) {
        const text = await response.text().catch(() => '')

        // Handle specific error cases
        if (response.status === 400 && text.includes('batch')) {
          throw new CLIError('ERR_INVALID_ARGUMENT', 'Invalid or expired postage stamp', 'Check BEE_STAMP with: ade get BEE_STAMP')
        }
        if (response.status === 402) {
          throw new CLIError('ERR_INSUFFICIENT_BALANCE', 'Postage stamp has insufficient funds', 'Top up your stamp or use a new one')
        }
        if (response.status === 429) {
          throw new CLIError('ERR_RATE_LIMITED', 'Bee node rate limited', 'Wait and retry')
        }

        throw new CLIError('ERR_API_ERROR', `Swarm upload failed: ${response.status} ${text}`)
      }

      const result = await response.json() as { reference: string }

      if (!result.reference || !/^[0-9a-f]{64}$/i.test(result.reference)) {
        throw new CLIError('ERR_API_ERROR', 'Invalid Swarm reference returned')
      }

      return { reference: result.reference.toLowerCase() }
    } catch (err) {
      if (err instanceof CLIError) {
        // Don't retry CLIErrors (they're specific failures)
        throw err
      }

      lastError = err as Error

      // Check for connection errors that might be retryable
      if (isRetryableError(err)) {
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY * attempt)
          continue
        }
      }

      throw err
    }
  }

  throw lastError || new CLIError('ERR_API_ERROR', 'Swarm upload failed after retries')
}

/**
 * Download data from Swarm.
 *
 * @param reference - 64-char hex Swarm reference
 * @param config - Swarm configuration (only beeApi needed)
 * @returns Downloaded binary data
 */
export async function downloadFromSwarm(
  reference: string,
  config: Pick<SwarmConfig, 'beeApi'>
): Promise<Uint8Array> {
  // Validate reference format
  if (!/^[0-9a-f]{64}$/i.test(reference)) {
    throw new CLIError('ERR_INVALID_ARGUMENT', 'Invalid Swarm reference format', 'Must be 64 hex characters')
  }

  const url = `${config.beeApi.replace(/\/$/, '')}/bytes/${reference.toLowerCase()}`

  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/octet-stream',
    },
  }, DEFAULT_TIMEOUT)

  if (!response.ok) {
    if (response.status === 404) {
      throw new CLIError('ERR_NOT_FOUND', `Content not found on Swarm: ${reference}`, 'The content may have expired or the reference is invalid')
    }
    throw new CLIError('ERR_API_ERROR', `Swarm download failed: ${response.status}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return new Uint8Array(arrayBuffer)
}

/**
 * Check if a postage stamp is valid and usable.
 *
 * @param batchId - 64-char hex postage batch ID
 * @param config - Swarm configuration (only beeApi needed)
 * @returns Stamp information
 */
export async function checkStampValid(
  batchId: string,
  config: Pick<SwarmConfig, 'beeApi'>
): Promise<StampInfo> {
  // Validate batch ID format
  if (!/^[0-9a-f]{64}$/i.test(batchId)) {
    throw new CLIError('ERR_INVALID_ARGUMENT', 'Invalid batch ID format', 'Must be 64 hex characters')
  }

  const url = `${config.beeApi.replace(/\/$/, '')}/stamps/${batchId.toLowerCase()}`

  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  }, DEFAULT_TIMEOUT)

  if (!response.ok) {
    if (response.status === 404) {
      throw new CLIError('ERR_NOT_FOUND', `Postage stamp not found: ${batchId}`, 'Check your BEE_STAMP value')
    }
    throw new CLIError('ERR_API_ERROR', `Failed to check stamp: ${response.status}`)
  }

  const stamp = await response.json() as StampInfo

  if (!stamp.usable) {
    throw new CLIError('ERR_INVALID_ARGUMENT', 'Postage stamp is not usable', 'The stamp may be expired or depleted')
  }

  return stamp
}

/**
 * Ping Bee node to check connectivity.
 *
 * @param beeApi - Bee API URL
 * @returns true if node is reachable
 */
export async function pingBeeNode(beeApi: string): Promise<boolean> {
  try {
    const url = `${beeApi.replace(/\/$/, '')}/health`
    const response = await fetchWithTimeout(url, { method: 'GET' }, 5000)
    return response.ok
  } catch {
    return false
  }
}

/**
 * Create a new postage stamp.
 *
 * @param amount - Amount of BZZ in PLUR (smallest unit). Higher = longer TTL.
 * @param depth - Batch depth (17-24). Higher = more storage capacity.
 * @param config - Swarm configuration (only beeApi needed)
 * @returns Batch ID of created stamp
 */
export async function createPostageStamp(
  amount: string,
  depth: number,
  config: Pick<SwarmConfig, 'beeApi'>
): Promise<string> {
  const url = `${config.beeApi.replace(/\/$/, '')}/stamps/${amount}/${depth}`

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  }, 120_000) // 2 min timeout for stamp creation

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    if (response.status === 402) {
      throw new CLIError('ERR_INSUFFICIENT_BALANCE', 'Insufficient BZZ balance to create stamp', 'Fund your Bee node wallet with BZZ')
    }
    throw new CLIError('ERR_API_ERROR', `Failed to create postage stamp: ${response.status} ${text}`)
  }

  const result = await response.json() as { batchID: string }

  if (!result.batchID || !/^[0-9a-f]{64}$/i.test(result.batchID)) {
    throw new CLIError('ERR_API_ERROR', 'Invalid batch ID returned from stamp creation')
  }

  return result.batchID.toLowerCase()
}

/**
 * Wait for a postage stamp to become usable.
 * Stamps need time to propagate through the network.
 *
 * @param batchId - 64-char hex postage batch ID
 * @param config - Swarm configuration (only beeApi needed)
 * @param timeoutMs - Maximum time to wait (default: 5 minutes)
 * @param pollIntervalMs - Time between checks (default: 5 seconds)
 * @returns Stamp information once usable
 */
export async function waitForStampUsable(
  batchId: string,
  config: Pick<SwarmConfig, 'beeApi'>,
  timeoutMs: number = 300_000, // 5 minutes
  pollIntervalMs: number = 5_000 // 5 seconds
): Promise<StampInfo> {
  const startTime = Date.now()
  const url = `${config.beeApi.replace(/\/$/, '')}/stamps/${batchId.toLowerCase()}`

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      }, DEFAULT_TIMEOUT)

      if (response.ok) {
        const stamp = await response.json() as StampInfo
        if (stamp.usable) {
          return stamp
        }
        // Stamp exists but not yet usable, keep waiting
      }
    } catch {
      // Ignore errors during polling, keep trying
    }

    await sleep(pollIntervalMs)
  }

  throw new CLIError(
    'ERR_NETWORK_TIMEOUT',
    `Postage stamp ${batchId.slice(0, 16)}... did not become usable within ${timeoutMs / 1000}s`,
    'The stamp may still be propagating. Try again later.'
  )
}

/**
 * Get or create a usable postage stamp.
 * If BEE_STAMP is set and valid, use it. Otherwise create a new one.
 *
 * @param existingBatchId - Existing batch ID to check (optional)
 * @param config - Swarm configuration
 * @param onProgress - Progress callback for UI updates
 * @returns Usable batch ID
 */
export async function getOrCreateStamp(
  existingBatchId: string | null,
  config: Pick<SwarmConfig, 'beeApi'>,
  onProgress?: (message: string) => void
): Promise<string> {
  const log = onProgress || console.error.bind(console)

  // Try existing stamp first
  if (existingBatchId && /^[0-9a-f]{64}$/i.test(existingBatchId)) {
    try {
      const stamp = await checkStampValid(existingBatchId, config)
      if (stamp.usable) {
        return existingBatchId
      }
    } catch {
      log(`  Existing stamp not usable, creating new one...`)
    }
  }

  // Create new stamp
  // Default: depth 20 (~1GB capacity), amount for ~1 week TTL
  const DEFAULT_DEPTH = 20
  const DEFAULT_AMOUNT = '10000000' // 10M PLUR ≈ cheap stamp for testing

  log(`Creating new postage stamp...`)
  log(`  Depth: ${DEFAULT_DEPTH} (capacity: ~${Math.pow(2, DEFAULT_DEPTH - 12)}MB)`)

  const batchId = await createPostageStamp(DEFAULT_AMOUNT, DEFAULT_DEPTH, config)
  log(`  Batch ID: ${batchId.slice(0, 16)}...`)

  log(`Waiting for stamp to become usable (this may take a few minutes)...`)
  await waitForStampUsable(batchId, config)
  log(`  Stamp is now usable`)

  return batchId
}

// ── Helpers ──

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout: number
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    return response
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new CLIError('ERR_NETWORK_TIMEOUT', `Request timed out after ${timeout}ms`, 'Check Bee node connectivity')
    }
    if (isConnectionError(err)) {
      throw new CLIError('ERR_API_ERROR', `Cannot connect to Bee node at ${url}`, 'Ensure Bee node is running and accessible')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

function isConnectionError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    return msg.includes('econnrefused') ||
           msg.includes('enotfound') ||
           msg.includes('network') ||
           msg.includes('fetch failed')
  }
  return false
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    return msg.includes('timeout') ||
           msg.includes('econnreset') ||
           msg.includes('socket hang up')
  }
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
