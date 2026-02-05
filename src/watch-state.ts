/**
 * Watch daemon state persistence — HMAC-protected JSON state file.
 * State is stored at ~/.config/ade/watch-state.json with integrity verification.
 */

import { readFileSync, writeFileSync, mkdirSync, unlinkSync, rmdirSync, renameSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes as viemHexToBytes, toHex } from 'viem'
import { CLIError } from './errors'

const CONFIG_DIR = join(homedir(), '.config', 'ade')
const STATE_PATH = join(CONFIG_DIR, 'watch-state.json')
const LOCK_DIR = join(CONFIG_DIR, 'watch.lock')
const PID_PATH = join(LOCK_DIR, 'pid')

export interface EscrowHandledState {
  role: 'seller' | 'buyer'
  committed: boolean
  commitTxHash?: string
  commitTimestamp?: number
  hasEncryptedKey: boolean
  released: boolean
  revealTxHash?: string
  claimed: boolean
  claimAfter?: number
  downloaded?: boolean
  downloadPath?: string
  retries: number
  needsManual: boolean
  lastError?: string
}

export interface WatchState {
  version: 1
  hmac: string
  pid: number
  startedAt: string
  lastCycle: string
  cycleCount: number
  dailyDate: string
  dailyValueProcessed: string
  dailyTxCount: number
  cumulativeValueProcessed: string
  handled: Record<string, EscrowHandledState>
  effectiveLimits?: {
    maxValue: string | null
    maxDaily: string | null
    maxCumulative: string | null
    maxTxPerCycle: number
    source: 'cli' | 'config' | 'default'
  }
}

function deriveHmacKey(sxKeyHex: string): Uint8Array {
  const prefix = new TextEncoder().encode('ade-watch-state-hmac:')
  const sxKeyBytes = viemHexToBytes(sxKeyHex as `0x${string}`)
  const combined = new Uint8Array(prefix.length + sxKeyBytes.length)
  combined.set(prefix)
  combined.set(sxKeyBytes, prefix.length)
  return sha256(combined)
}

function computeStateHmac(state: Omit<WatchState, 'hmac'>, sxKeyHex: string): string {
  const hmacKey = deriveHmacKey(sxKeyHex)
  const stateBytes = new TextEncoder().encode(JSON.stringify(state))
  return toHex(hmac(sha256, hmacKey, stateBytes))
}

export function loadWatchState(sxKeyHex: string): WatchState {
  const raw = readFileSync(STATE_PATH, 'utf-8')
  if (raw.length > 102400) throw new CLIError('ERR_STATE_CORRUPT', 'State file too large')
  const state = JSON.parse(raw)
  const { hmac: savedHmac, ...rest } = state
  const expected = computeStateHmac(rest, sxKeyHex)
  if (savedHmac !== expected) {
    throw new CLIError('ERR_STATE_CORRUPT',
      'Watch state file has been tampered with or is corrupted',
      'Run: ade watch --reset-state')
  }
  return state
}

export function saveWatchState(state: Omit<WatchState, 'hmac'>, sxKey: string): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  const stateWithoutHmac = { ...state }
  delete (stateWithoutHmac as Partial<WatchState>).hmac
  const hmacValue = computeStateHmac(stateWithoutHmac, sxKey)
  const fullState: WatchState = { ...stateWithoutHmac, hmac: hmacValue } as WatchState
  const tmpPath = STATE_PATH + '.tmp'
  writeFileSync(tmpPath, JSON.stringify(fullState, null, 2), { mode: 0o600 })
  renameSync(tmpPath, STATE_PATH)
}

export function acquireLock(): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  // Clean up stale .tmp files from crashed writes
  try { unlinkSync(STATE_PATH + '.tmp') } catch {}

  try {
    mkdirSync(LOCK_DIR)
  } catch {
    // Lock dir exists — check if owning process is alive
    try {
      const existingPid = parseInt(readFileSync(PID_PATH, 'utf-8').trim(), 10)
      if (!isNaN(existingPid)) {
        try {
          process.kill(existingPid, 0)
          throw new CLIError('ERR_DAEMON_LOCKED',
            `Another watch instance is running (PID ${existingPid})`,
            'Stop it first, or run: ade watch --reset-state')
        } catch (err) {
          if (err instanceof CLIError) throw err
        }
      }
    } catch (err) {
      if (err instanceof CLIError) throw err
    }
    // Remove stale lock and retry
    try { unlinkSync(PID_PATH) } catch {}
    try { rmdirSync(LOCK_DIR) } catch {}
    try {
      mkdirSync(LOCK_DIR)
    } catch {
      throw new CLIError('ERR_DAEMON_LOCKED',
        'Another instance acquired the lock during cleanup',
        'Try again or check running instances')
    }
  }

  writeFileSync(PID_PATH, String(process.pid), { mode: 0o600 })
}

export function releaseLock(): void {
  try { unlinkSync(PID_PATH) } catch {}
  try { rmdirSync(LOCK_DIR) } catch {}
}
