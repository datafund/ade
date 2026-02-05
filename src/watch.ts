/**
 * Watch daemon — automated escrow lifecycle management.
 * Polls for escrows needing action and executes seller/buyer duties.
 * Outputs NDJSON events on stdout; human logs on stderr.
 */

import { escrowsCommitKey, escrowsRevealKey, escrowsClaim, sleep, readLineFromStdin, accountUnlock, requireKey, getChainClient, getActiveAccount } from './commands'
import { getEscrowFromChain } from './utils/chain'
import type { EscrowData } from './utils/chain'
import { DataEscrowABI } from './abi/DataEscrow'
import { SWARM_GATEWAY, downloadFromSwarm } from './swarm'
import { getEscrowKeys, listEscrowIds } from './escrow-keys'
import type { EscrowKeys } from './escrow-keys'
import { decryptFromEscrow } from './crypto/escrow'
import { hexToBytes, deserializeEncryptedKey, decryptKeyAsBuyer } from './crypto/fairdrop'
import { apiFetch } from './api'
import { CLIError } from './errors'
import type { ErrorCode } from './errors'
import { ESCROW_STATE } from './constants'
import { loadWatchState, saveWatchState, acquireLock, releaseLock } from './watch-state'
import type { WatchState, EscrowHandledState } from './watch-state'
import type { Keychain } from './secrets'
import * as defaultKeychain from './keychain'
import { getVersion } from './update'
import * as secp256k1 from '@noble/secp256k1'
import { keccak256, parseEther, formatEther, toHex } from 'viem'
import type { PublicClient, Hex } from 'viem'
import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, rmdirSync, lstatSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import { realpathSync } from 'fs'

// ── Types ──

export interface WatchOpts {
  yes?: boolean
  dryRun?: boolean
  once?: boolean
  sellerOnly?: boolean
  buyerOnly?: boolean
  interval?: number
  downloadDir?: string
  escrowIds?: number[]
  maxValue?: string
  maxDaily?: string
  maxCumulative?: string
  maxTxPerCycle?: number
  quiet?: boolean
  verbose?: boolean
  passwordStdin?: boolean
}

interface WatchConfig {
  interval?: number
  maxValue?: string
  maxDaily?: string
  maxCumulative?: string
  maxTxPerCycle?: number
  maxConsecutiveApiFailures?: number
  downloadDir?: string
  seller?: boolean
  buyer?: boolean
  escrowIds?: number[]
}

export interface WatchStatusResult {
  running: boolean
  pid: number | null
  uptimeSeconds: number | null
  lastCycle: string | null
  cycles: number
  escrowsManaged: number
  dailyValue: string
  dailyLimit: string | null
  cumulativeValue: string
  dailyTx: number
  errorsLastHour: number
  stateVerified: boolean
  effectiveLimits: {
    maxValue: string | null
    maxDaily: string | null
    maxCumulative: string | null
    maxTxPerCycle: number
    source: 'cli' | 'config' | 'default'
  } | null
}

interface ApiEscrow {
  id: number
  seller: string
  buyer: string
  state: string
  encryptedDataRef?: string
  buyerPubkey?: string
  amount: string
}

type SpendingLimitAction = 'paused' | 'skipped' | 'shutdown'

type WatchEvent =
  | { event: 'hello'; protocolVersion: number; adeVersion: string; address: string; mode: string }
  | { event: 'heartbeat'; timestamp: string; uptimeSeconds: number; cycleCount: number; escrowsManaged: number }
  | { event: 'cycle_start'; timestamp: string; cycle: number }
  | { event: 'escrow_found'; escrowId: number; state: string; role: string; amount: string }
  | { event: 'key_committed'; escrowId: number; txHash: string; ecdhCommit: boolean }
  | { event: 'key_revealed'; escrowId: number; txHash: string; ecdhEncrypted: boolean }
  | { event: 'download_start'; escrowId: number; swarmRef: string }
  | { event: 'download_complete'; escrowId: number; path: string; size: number; contentHashVerified: boolean }
  | { event: 'claim_executed'; escrowId: number; amount: string; txHash: string }
  | { event: 'error'; escrowId?: number; code: ErrorCode; message: string; retryable: boolean; retryAfterSeconds: number | null; suggestion: string | null }
  | { event: 'spending_limit'; type: 'per_escrow' | 'daily' | 'cumulative'; current: string; limit: string; action: SpendingLimitAction }
  | { event: 'cycle_end'; timestamp: string; actions: number; next: string }
  | { event: 'shutdown'; reason: string; stateSaved?: boolean }

// ── Helpers ──

const RETRYABLE_CODES = new Set<string>(['ERR_NETWORK_TIMEOUT', 'ERR_REVEAL_TIMEOUT', 'ERR_DOWNLOAD_FAILED', 'ERR_COMMIT_FAILED'])

function emitEvent(event: WatchEvent): void {
  const MAX_EVENT_SIZE = 10 * 1024
  const sanitized = JSON.parse(JSON.stringify(event, (_key, v) => {
    if (typeof v !== 'string') return v
    let s = v.replace(/[\x00-\x1f\x7f-\x9f]/g, '')
    if (_key === 'suggestion' || _key === 'message') s = s.slice(0, 500)
    else s = s.slice(0, 1000)
    return s
  }))
  let line = JSON.stringify(sanitized)
  if (line.length > MAX_EVENT_SIZE) {
    line = JSON.stringify({ event: 'error', code: 'ERR_STATE_CORRUPT', message: `Event exceeded ${MAX_EVENT_SIZE}B cap` })
  }
  process.stdout.write(line + '\n')
}

function createInitialState(): WatchState {
  return {
    version: 1,
    hmac: '',
    pid: process.pid,
    startedAt: new Date().toISOString(),
    lastCycle: '',
    cycleCount: 0,
    dailyDate: new Date().toISOString().slice(0, 10),
    dailyValueProcessed: '0',
    dailyTxCount: 0,
    cumulativeValueProcessed: '0',
    handled: {},
  }
}

function createEscrowState(escrowData: EscrowData, address: string): EscrowHandledState {
  const isSeller = escrowData.seller.toLowerCase() === address.toLowerCase()
  const escrowState: EscrowHandledState = {
    role: isSeller ? 'seller' : 'buyer',
    committed: escrowData.state >= ESCROW_STATE.KeyCommitted,
    hasEncryptedKey: false,
    released: escrowData.state >= ESCROW_STATE.Released,
    claimed: escrowData.state >= ESCROW_STATE.Claimed,
    retries: 0,
    needsManual: false,
  }
  if (escrowState.released && !escrowState.claimed && isSeller) {
    escrowState.claimAfter = Math.floor(Date.now() / 1000) + Number(escrowData.disputeWindow_)
  }
  return escrowState
}

function emitErrorAndSkip(escrowId: number, code: ErrorCode, state: WatchState, message?: string): void {
  const escrowState = state.handled[String(escrowId)]
  if (escrowState) {
    escrowState.needsManual = true
    escrowState.lastError = message || code
  }
  emitEvent({
    event: 'error', escrowId, code,
    message: message || `Error processing escrow ${escrowId}`,
    retryable: false, retryAfterSeconds: null,
    suggestion: `Check escrow manually: ade escrows show ${escrowId}`,
  })
}

function emitErrorEvent(escrowId: number, code: ErrorCode, message: string, state: WatchState): void {
  const escrowState = state.handled[String(escrowId)]
  if (escrowState) {
    escrowState.retries++
    escrowState.lastError = message
    if (escrowState.retries >= 5) escrowState.needsManual = true
  }
  const retryable = RETRYABLE_CODES.has(code)
  emitEvent({
    event: 'error', escrowId, code, message,
    retryable,
    retryAfterSeconds: retryable ? 60 : null,
    suggestion: retryable ? 'Will retry next cycle' : `Check escrow: ade escrows show ${escrowId}`,
  })
}

async function updateSpending(state: WatchState, amountWei: bigint, keychain: Keychain): Promise<void> {
  const currentDailyWei = parseEther(state.dailyValueProcessed)
  state.dailyValueProcessed = formatEther(currentDailyWei + amountWei)
  state.dailyTxCount++

  const currentCumulativeWei = parseEther(state.cumulativeValueProcessed)
  state.cumulativeValueProcessed = formatEther(currentCumulativeWei + amountWei)

  await keychain.set('ADE_WATCH_CUMULATIVE', state.cumulativeValueProcessed)
  await keychain.set('ADE_WATCH_DAILY', `${state.dailyDate}:${state.dailyValueProcessed}`)
}

async function fetchSellerBuyerEscrows(address: string): Promise<ApiEscrow[]> {
  const escrows: ApiEscrow[] = []
  for (const role of ['seller', 'buyer']) {
    let offset = 0
    const limit = 50
    while (true) {
      try {
        const result = await apiFetch<{ escrows: ApiEscrow[] }>(
          `/escrows?${role}=${encodeURIComponent(address)}&limit=${limit}&offset=${offset}`
        )
        const page = result.escrows ?? []
        escrows.push(...page)
        if (page.length < limit || escrows.length >= 500) break
        offset += limit
      } catch { break }
    }
  }
  return escrows
}

async function keychainGetWithTimeout(keychain: Keychain, escrowId: number, timeoutMs = 5000): Promise<EscrowKeys | null> {
  return Promise.race([
    getEscrowKeys(escrowId, keychain),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ])
}

async function saveDecryptedFile(
  encryptedData: Uint8Array,
  escrowId: number,
  downloadDir: string,
  keychain: Keychain
): Promise<string> {
  const keys = await getEscrowKeys(escrowId, keychain)
  if (!keys) throw new CLIError('ERR_MISSING_KEY', `No decryption key for escrow ${escrowId}`)

  let keyBytes: Uint8Array
  const ecdhEncryptedKeyHex = await keychain.get(`ESCROW_${escrowId}_ENCRYPTED_KEY`)
  if (ecdhEncryptedKeyHex) {
    const serializedBytes = hexToBytes(ecdhEncryptedKeyHex)
    const encryptedPayload = deserializeEncryptedKey(serializedBytes)
    const account = getActiveAccount()
    if (!account) {
      throw new CLIError('ERR_MISSING_KEY',
        'ECDH-encrypted key requires unlocked Fairdrop account',
        'Use --password-stdin to unlock account for ECDH decryption')
    }
    try {
      keyBytes = decryptKeyAsBuyer(encryptedPayload, account.privateKey)
    } catch (err) {
      throw new CLIError('ERR_DECRYPTION_FAILED',
        `ECDH key decryption failed for escrow ${escrowId}: ${(err as Error).message}`,
        'Ensure the correct Fairdrop account is unlocked (the one used when funding)')
    }
  } else {
    keyBytes = hexToBytes(keys.encryptionKey)
  }

  const decrypted = decryptFromEscrow({ encryptedData, key: keyBytes })

  const filename = `escrow-${escrowId}.bin`
  const canonicalDir = realpathSync(downloadDir)
  const outputPath = join(canonicalDir, filename)
  const canonicalOutput = join(canonicalDir, basename(filename))
  if (!canonicalOutput.startsWith(canonicalDir)) {
    throw new CLIError('ERR_INVALID_ARGUMENT', 'Output path escapes download directory')
  }

  const tmpPath = outputPath + '.tmp'
  writeFileSync(tmpPath, decrypted, { mode: 0o600 })
  renameSync(tmpPath, outputPath)

  return outputPath
}

function getMsUntilUtcMidnight(): number {
  const now = new Date()
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  return tomorrow.getTime() - now.getTime()
}

function mergeLimit(cliFlag?: string, configValue?: string, absoluteCap?: string): string {
  const values: bigint[] = []
  if (cliFlag) values.push(parseEther(cliFlag))
  if (configValue) values.push(parseEther(configValue))
  if (absoluteCap) values.push(parseEther(absoluteCap))
  if (values.length === 0) return '10'
  const min = values.reduce((a, b) => a < b ? a : b)
  return formatEther(min)
}

function loadWatchConfig(): WatchConfig | null {
  const configPath = join(homedir(), '.config', 'ade', 'watch.json')
  try {
    const fstat = lstatSync(configPath)
    if (fstat.isSymbolicLink()) {
      console.error(`Warning: Ignoring symlinked config at ${configPath}`)
      return null
    }
    if ((fstat.mode & 0o077) !== 0) {
      console.error(`Warning: Config file ${configPath} has loose permissions. Run: chmod 600 ${configPath}`)
      return null
    }
    const raw = readFileSync(configPath, 'utf-8')
    if (raw.length > 10240) return null
    const parsed = JSON.parse(raw) as WatchConfig
    if (parsed.interval !== undefined && (typeof parsed.interval !== 'number' || parsed.interval < 5)) {
      console.error(`Warning: Config interval must be >= 5 seconds, ignoring`)
      parsed.interval = undefined
    }
    if (parsed.maxTxPerCycle !== undefined && (typeof parsed.maxTxPerCycle !== 'number' || parsed.maxTxPerCycle < 1)) {
      parsed.maxTxPerCycle = undefined
    }
    return parsed
  } catch {
    return null
  }
}

// ── Main watch function ──

export async function watch(
  opts: WatchOpts,
  keychain: Keychain = defaultKeychain
): Promise<void> {
  const ABSOLUTE_MAX_VALUE = parseEther('10')

  if (opts.yes && !opts.maxValue) {
    throw new CLIError('ERR_INVALID_ARGUMENT',
      '--max-value is required when using --yes mode',
      'Set maximum single escrow value: ade watch --yes --max-value 0.1')
  }
  if (opts.maxValue && parseEther(opts.maxValue) > ABSOLUTE_MAX_VALUE) {
    throw new CLIError('ERR_SPENDING_LIMIT',
      `--max-value ${opts.maxValue} ETH exceeds absolute hard cap of 10 ETH`,
      'Set --max-value to 10 or less')
  }

  const config = loadWatchConfig()
  const interval = Math.max(opts.interval ?? config?.interval ?? 20, 5)
  const maxValue = mergeLimit(opts.maxValue, config?.maxValue, '10')
  const maxDaily = mergeLimit(opts.maxDaily, config?.maxDaily, '100')
  const maxCumulative = mergeLimit(opts.maxCumulative, config?.maxCumulative, '1000')
  const maxTxPerCycle = Math.min(opts.maxTxPerCycle ?? config?.maxTxPerCycle ?? 10, 50)
  const maxConsecutiveApiFailures = config?.maxConsecutiveApiFailures ?? 10
  const downloadDir = opts.downloadDir ?? config?.downloadDir ?? '.'

  const sxKey = await requireKey(keychain)
  const { pub, wallet, address, chainConfig } = await getChainClient(keychain)
  if (!chainConfig.contracts.dataEscrow) {
    throw new CLIError('ERR_INVALID_ARGUMENT', `No DataEscrow contract for chain ${chainConfig.name}`)
  }
  const contractAddr = chainConfig.contracts.dataEscrow as Hex

  acquireLock()

  let state: WatchState
  try {
    state = loadWatchState(sxKey)
    // Cross-check cumulative against keychain
    const keychainCumulative = await keychain.get('ADE_WATCH_CUMULATIVE')
    const keychainWei = parseEther(keychainCumulative || '0')
    const stateWei = parseEther(state.cumulativeValueProcessed || '0')
    state.cumulativeValueProcessed = formatEther(keychainWei > stateWei ? keychainWei : stateWei)
    // Cross-check daily against keychain
    const keychainDaily = await keychain.get('ADE_WATCH_DAILY')
    if (keychainDaily) {
      const [kcDate, kcValue] = keychainDaily.split(':')
      if (kcDate === state.dailyDate) {
        const kcDailyWei = parseEther(kcValue || '0')
        const stateDailyWei = parseEther(state.dailyValueProcessed || '0')
        state.dailyValueProcessed = formatEther(kcDailyWei > stateDailyWei ? kcDailyWei : stateDailyWei)
      }
    }
    // Reset daily if date changed
    const today = new Date().toISOString().slice(0, 10)
    if (state.dailyDate !== today) {
      state.dailyDate = today
      state.dailyValueProcessed = '0'
      state.dailyTxCount = 0
    }
  } catch {
    state = createInitialState()
  }

  state.pid = process.pid
  state.effectiveLimits = {
    maxValue: maxValue,
    maxDaily: maxDaily,
    maxCumulative: maxCumulative,
    maxTxPerCycle,
    source: opts.maxValue ? 'cli' : (config?.maxValue ? 'config' : 'default'),
  }

  // Optional: unlock Fairdrop account for ECDH
  if (opts.passwordStdin) {
    const activeSubdomain = await keychain.get('FAIRDROP_ACTIVE')
    if (activeSubdomain) {
      const password = await readLineFromStdin()
      await accountUnlock(activeSubdomain, password, keychain)
    }
  }

  const mode = opts.sellerOnly ? 'seller' : opts.buyerOnly ? 'buyer' : 'seller+buyer'
  emitEvent({ event: 'hello', protocolVersion: 1, adeVersion: getVersion(), address, mode })

  let commitRevealDelay: number | null = null
  let shuttingDown = false
  process.on('SIGTERM', () => { shuttingDown = true })
  process.on('SIGINT', () => { shuttingDown = true })

  let lastHeartbeat = Date.now()
  const HEARTBEAT_INTERVAL_MS = 60_000
  let consecutiveApiFailures = 0

  while (!shuttingDown) {
    state.cycleCount++

    if (Date.now() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
      const uptimeSeconds = Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000)
      emitEvent({ event: 'heartbeat', timestamp: new Date().toISOString(), uptimeSeconds, cycleCount: state.cycleCount, escrowsManaged: Object.keys(state.handled).length })
      lastHeartbeat = Date.now()
    }

    emitEvent({ event: 'cycle_start', timestamp: new Date().toISOString(), cycle: state.cycleCount })
    let actionsThisCycle = 0

    const cycleController = new AbortController()
    const cycleTimeout = setTimeout(() => cycleController.abort(), 120_000)

    try {
      // Discover escrows
      const knownIds = opts.escrowIds ?? await listEscrowIds(keychain)
      const apiEscrows = await fetchSellerBuyerEscrows(address).then(
        result => { consecutiveApiFailures = 0; return result },
        () => {
          consecutiveApiFailures++
          if (consecutiveApiFailures >= maxConsecutiveApiFailures) {
            emitEvent({ event: 'shutdown', reason: `Circuit breaker: ${consecutiveApiFailures} consecutive API failures` })
            shuttingDown = true
          }
          return []
        }
      )
      const allIds = [...new Set([...knownIds, ...apiEscrows.map(e => e.id)])]

      for (const escrowId of allIds) {
        if (shuttingDown || actionsThisCycle >= maxTxPerCycle || cycleController.signal.aborted) break

        const escrowData = await getEscrowFromChain(pub, contractAddr, BigInt(escrowId))
        if (!escrowData) continue

        const escrowState = state.handled[String(escrowId)] ?? createEscrowState(escrowData, address)

        if (!state.handled[String(escrowId)]) {
          const role = escrowData.seller.toLowerCase() === address.toLowerCase() ? 'seller' : 'buyer'
          emitEvent({ event: 'escrow_found', escrowId, state: String(escrowData.state), role, amount: formatEther(escrowData.amount) })
        }

        if (escrowState.needsManual) continue

        const amountWei = escrowData.amount
        const amountEth = formatEther(amountWei)
        if (maxValue && amountWei > parseEther(maxValue)) {
          emitEvent({ event: 'spending_limit', type: 'per_escrow', current: amountEth, limit: maxValue, action: 'skipped' })
          continue
        }

        if (maxDaily) {
          const currentDailyWei = parseEther(state.dailyValueProcessed)
          const limitDailyWei = parseEther(maxDaily)
          if (currentDailyWei >= limitDailyWei) {
            emitEvent({ event: 'spending_limit', type: 'daily', current: state.dailyValueProcessed, limit: maxDaily, action: 'skipped' })
            continue
          }
        }

        // Seller duties
        if (!opts.buyerOnly && escrowData.seller.toLowerCase() === address.toLowerCase()) {
          if (escrowData.state === ESCROW_STATE.Funded && !escrowState.committed) {
            const keys = await keychainGetWithTimeout(keychain, escrowId)
            if (!keys) { emitErrorAndSkip(escrowId, 'ERR_MISSING_KEY', state); continue }

            let buyerPubkey: string | undefined
            const apiEscrow = apiEscrows.find(e => e.id === escrowId)
            if (apiEscrow?.buyerPubkey) {
              try {
                const pubkeyBytes = hexToBytes(apiEscrow.buyerPubkey)
                if (pubkeyBytes.length === 33 || pubkeyBytes.length === 65) {
                  secp256k1.Point.fromBytes(pubkeyBytes)
                  buyerPubkey = apiEscrow.buyerPubkey
                }
              } catch {
                if (!opts.quiet) console.error(`Warning: Invalid buyer pubkey from API, falling back to raw key`)
              }
            }

            if (!opts.dryRun) {
              try {
                const result = await escrowsCommitKey(String(escrowId), { yes: true, buyerPubkey }, keychain)
                escrowState.committed = true
                escrowState.commitTxHash = result.txHash
                emitEvent({ event: 'key_committed', escrowId, txHash: result.txHash, ecdhCommit: !!buyerPubkey })
                actionsThisCycle++
              } catch (err) {
                emitErrorEvent(escrowId, 'ERR_COMMIT_FAILED', (err as Error).message, state)
              }
            }
          }

          if (escrowData.state === ESCROW_STATE.KeyCommitted && !escrowState.released) {
            if (!escrowState.commitTimestamp) {
              const block = await pub.getBlock({ blockTag: 'latest' })
              escrowState.commitTimestamp = Number(block.timestamp)
            }
            if (!commitRevealDelay) {
              try {
                const [, minTimeDelay] = await Promise.all([
                  pub.readContract({ address: contractAddr, abi: DataEscrowABI, functionName: 'MIN_BLOCK_DELAY' }),
                  pub.readContract({ address: contractAddr, abi: DataEscrowABI, functionName: 'MIN_TIME_DELAY' }),
                ])
                commitRevealDelay = Number(minTimeDelay) + 10
              } catch {
                commitRevealDelay = 70 // Fallback: 60s + 10s buffer
              }
            }
            const elapsed = Math.floor(Date.now() / 1000) - escrowState.commitTimestamp
            if (elapsed < commitRevealDelay) {
              if (opts.verbose) console.error(`  Escrow #${escrowId}: waiting ${commitRevealDelay - elapsed}s for commit-reveal delay`)
              state.handled[String(escrowId)] = escrowState
              continue
            }
            if (!opts.dryRun) {
              try {
                const result = await escrowsRevealKey(String(escrowId), { yes: true }, keychain)
                escrowState.released = true
                escrowState.revealTxHash = result.txHash
                const hasEcdhKey = !!(await keychain.get(`ESCROW_${escrowId}_ENCRYPTED_KEY`))
                escrowState.hasEncryptedKey = hasEcdhKey
                emitEvent({ event: 'key_revealed', escrowId, txHash: result.txHash, ecdhEncrypted: hasEcdhKey })
                const disputeWindowSecs = Number(escrowData.disputeWindow_)
                const revealBlock = await pub.getBlock({ blockTag: 'latest' })
                escrowState.claimAfter = Number(revealBlock.timestamp) + disputeWindowSecs
                actionsThisCycle++
                await updateSpending(state, amountWei, keychain)
              } catch (err) {
                emitErrorEvent(escrowId, 'ERR_REVEAL_TIMEOUT', (err as Error).message, state)
              }
            }
          }

          if (escrowData.state === ESCROW_STATE.Released && !escrowState.claimed) {
            if (escrowState.claimAfter && Date.now() / 1000 >= escrowState.claimAfter) {
              if (!opts.dryRun) {
                try {
                  const result = await escrowsClaim(String(escrowId), { yes: true }, keychain)
                  escrowState.claimed = true
                  emitEvent({ event: 'claim_executed', escrowId, amount: amountEth, txHash: result.txHash })
                  actionsThisCycle++
                } catch (err) {
                  emitErrorEvent(escrowId, 'ERR_CLAIM_TOO_EARLY', (err as Error).message, state)
                }
              }
            }
          }
        }

        // Buyer duties
        if (!opts.sellerOnly && escrowData.buyer.toLowerCase() === address.toLowerCase()) {
          if (escrowData.state === ESCROW_STATE.Released && !escrowState.downloaded) {
            const swarmRef = await keychain.get(`ESCROW_${escrowId}_SWARM`)
              ?? apiEscrows.find(e => e.id === escrowId)?.encryptedDataRef
              ?? null
            if (!swarmRef) {
              emitErrorAndSkip(escrowId, 'ERR_MISSING_KEY', state, 'No swarm reference found in keychain or marketplace')
              continue
            }
            emitEvent({ event: 'download_start', escrowId, swarmRef })
            if (!opts.dryRun) {
              try {
                const beeApi = await keychain.get('BEE_API') || process.env.BEE_API || SWARM_GATEWAY
                const MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024
                try {
                  const headUrl = `${beeApi.replace(/\/$/, '')}/bytes/${swarmRef.toLowerCase()}`
                  const headResp = await fetch(headUrl, { method: 'HEAD' })
                  const contentLength = headResp.headers.get('content-length')
                  if (contentLength && parseInt(contentLength, 10) > MAX_DOWNLOAD_SIZE) {
                    emitErrorEvent(escrowId, 'ERR_DOWNLOAD_FAILED', `Content-Length exceeds ${MAX_DOWNLOAD_SIZE} bytes`, state)
                    continue
                  }
                } catch { /* HEAD not supported, fall through */ }

                const data = await downloadFromSwarm(swarmRef, { beeApi })
                if (data.length > MAX_DOWNLOAD_SIZE) {
                  emitErrorEvent(escrowId, 'ERR_DOWNLOAD_FAILED', `Downloaded data exceeds ${MAX_DOWNLOAD_SIZE} bytes`, state)
                  continue
                }
                const hash = keccak256(data)
                if (hash !== escrowData.contentHash) {
                  emitErrorEvent(escrowId, 'ERR_DOWNLOAD_FAILED', 'Content hash mismatch', state)
                  continue
                }
                const outputPath = await saveDecryptedFile(data, escrowId, downloadDir, keychain)
                escrowState.downloaded = true
                escrowState.downloadPath = outputPath
                emitEvent({ event: 'download_complete', escrowId, path: outputPath, size: data.length, contentHashVerified: true })
              } catch (err) {
                emitErrorEvent(escrowId, 'ERR_DOWNLOAD_FAILED', (err as Error).message, state)
              }
            }
          }
        }

        state.handled[String(escrowId)] = escrowState
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        emitEvent({ event: 'error', code: 'ERR_NETWORK_TIMEOUT' as ErrorCode, message: 'Cycle timeout exceeded (120s)', retryable: true, retryAfterSeconds: interval, suggestion: 'Next cycle will retry pending operations' })
      } else { throw err }
    } finally {
      clearTimeout(cycleTimeout)
    }

    // Post-cycle daily spending check
    if (maxDaily) {
      const currentWei = parseEther(state.dailyValueProcessed)
      const limitWei = parseEther(maxDaily)
      if (currentWei >= limitWei) {
        emitEvent({ event: 'spending_limit', type: 'daily', current: state.dailyValueProcessed, limit: maxDaily, action: 'paused' })
        const msUntilMidnight = getMsUntilUtcMidnight()
        await sleep(msUntilMidnight)
        state.dailyDate = new Date().toISOString().slice(0, 10)
        state.dailyValueProcessed = '0'
        state.dailyTxCount = 0
      }
    }

    // Check cumulative limit
    if (maxCumulative) {
      const currentWei = parseEther(state.cumulativeValueProcessed)
      const limitWei = parseEther(maxCumulative)
      if (currentWei >= limitWei) {
        emitEvent({ event: 'spending_limit', type: 'cumulative', current: state.cumulativeValueProcessed, limit: maxCumulative, action: 'shutdown' })
        break
      }
    }

    state.lastCycle = new Date().toISOString()
    const nextCycle = new Date(Date.now() + interval * 1000).toISOString()
    emitEvent({ event: 'cycle_end', timestamp: state.lastCycle, actions: actionsThisCycle, next: nextCycle })
    saveWatchState(state, sxKey)

    if (opts.once) break
    if (!shuttingDown) await sleep(interval * 1000)
  }

  // Cleanup
  saveWatchState(state, sxKey)
  await keychain.set('ADE_WATCH_CUMULATIVE', state.cumulativeValueProcessed)
  releaseLock()
  emitEvent({ event: 'shutdown', reason: shuttingDown ? 'signal' : (opts.once ? 'once' : 'limit'), stateSaved: true })
}

// ── Status & Reset ──

export async function watchStatus(
  keychain: Keychain = defaultKeychain
): Promise<WatchStatusResult> {
  const pidPath = join(homedir(), '.config', 'ade', 'watch.lock', 'pid')
  let running = false
  let pid: number | null = null
  let uptimeSeconds: number | null = null

  try {
    const pidStr = readFileSync(pidPath, 'utf-8').trim()
    pid = parseInt(pidStr, 10)
    if (!isNaN(pid)) {
      try {
        process.kill(pid, 0)
        running = true
      } catch {
        running = false
      }
    }
  } catch { /* No PID file */ }

  let stateVerified = false
  let state: WatchState | null = null
  try {
    const sxKey = await keychain.get('SX_KEY')
    if (sxKey) {
      state = loadWatchState(sxKey)
      stateVerified = true
    }
  } catch { /* HMAC failed or no SX_KEY */ }

  if (!state) {
    try {
      const raw = readFileSync(join(homedir(), '.config', 'ade', 'watch-state.json'), 'utf-8')
      if (raw.length > 102400) throw new Error('State file too large')
      const parsed = JSON.parse(raw) as WatchState
      state = {
        ...parsed,
        dailyValueProcessed: '0',
        dailyTxCount: 0,
        cumulativeValueProcessed: '0',
      }
    } catch { /* No state file */ }
  }

  if (state?.startedAt && running) {
    uptimeSeconds = Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000)
  }

  let effectiveLimits: WatchStatusResult['effectiveLimits'] = null
  if (stateVerified && state?.effectiveLimits) {
    effectiveLimits = state.effectiveLimits
  }

  return {
    running,
    pid: running ? pid : null,
    uptimeSeconds,
    lastCycle: state?.lastCycle || null,
    cycles: state?.cycleCount || 0,
    escrowsManaged: state ? Object.keys(state.handled).length : 0,
    dailyValue: stateVerified ? `${state!.dailyValueProcessed} ETH` : 'unverified',
    dailyLimit: null,
    cumulativeValue: stateVerified ? `${state!.cumulativeValueProcessed} ETH` : 'unverified',
    dailyTx: state?.dailyTxCount || 0,
    errorsLastHour: state ? Object.values(state.handled).filter(h => h.lastError && h.retries > 0).length : 0,
    stateVerified,
    effectiveLimits,
  }
}

export async function watchResetState(): Promise<void> {
  const statePath = join(homedir(), '.config', 'ade', 'watch-state.json')
  const lockDir = join(homedir(), '.config', 'ade', 'watch.lock')
  const pidPath = join(lockDir, 'pid')

  try {
    const pidStr = readFileSync(pidPath, 'utf-8').trim()
    const pid = parseInt(pidStr, 10)
    if (!isNaN(pid)) {
      try {
        process.kill(pid, 0)
        throw new CLIError('ERR_DAEMON_LOCKED',
          `Cannot reset state while daemon is running (PID ${pid})`,
          'Stop the daemon first: kill ' + pid)
      } catch (err) {
        if (err instanceof CLIError) throw err
      }
    }
  } catch (err) {
    if (err instanceof CLIError) throw err
  }

  try { unlinkSync(statePath) } catch {}
  try { unlinkSync(statePath + '.tmp') } catch {}
  try { unlinkSync(pidPath) } catch {}
  try { rmdirSync(lockDir) } catch {}
}
