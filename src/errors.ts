/**
 * Structured CLI errors with codes, exit codes, and retry hints.
 */

export type ErrorCode =
  | 'ERR_INVALID_ADDRESS'
  | 'ERR_INVALID_ARGUMENT'
  | 'ERR_MISSING_KEY'
  | 'ERR_MISSING_RPC'
  | 'ERR_MISSING_TOKEN'
  | 'ERR_CONFIRMATION_REQUIRED'
  | 'ERR_INVALID_SIGNATURE'
  | 'ERR_WRONG_CHAIN'
  | 'ERR_INSUFFICIENT_BALANCE'
  | 'ERR_GAS_TOO_HIGH'
  | 'ERR_TX_REVERTED'
  | 'ERR_NOT_FOUND'
  | 'ERR_RATE_LIMITED'
  | 'ERR_NETWORK_TIMEOUT'
  | 'ERR_API_ERROR'
  | 'ERR_COMMIT_FAILED'
  | 'ERR_REVEAL_TIMEOUT'
  | 'ERR_DOWNLOAD_FAILED'
  | 'ERR_CLAIM_TOO_EARLY'
  | 'ERR_SPENDING_LIMIT'
  | 'ERR_DAEMON_LOCKED'
  | 'ERR_BATCH_PARTIAL'
  | 'ERR_STATE_CORRUPT'
  | 'ERR_STDIN_TIMEOUT'
  | 'ERR_DECRYPTION_FAILED'

const EXIT_CODES: Record<ErrorCode, number> = {
  ERR_INVALID_ADDRESS: 1,
  ERR_INVALID_ARGUMENT: 1,
  ERR_MISSING_KEY: 2,
  ERR_MISSING_RPC: 2,
  ERR_MISSING_TOKEN: 2,
  ERR_CONFIRMATION_REQUIRED: 1,
  ERR_INVALID_SIGNATURE: 2,
  ERR_WRONG_CHAIN: 3,
  ERR_INSUFFICIENT_BALANCE: 3,
  ERR_GAS_TOO_HIGH: 3,
  ERR_TX_REVERTED: 3,
  ERR_NOT_FOUND: 4,
  ERR_RATE_LIMITED: 4,
  ERR_NETWORK_TIMEOUT: 4,
  ERR_API_ERROR: 4,
  ERR_COMMIT_FAILED: 3,
  ERR_REVEAL_TIMEOUT: 4,
  ERR_DOWNLOAD_FAILED: 4,
  ERR_CLAIM_TOO_EARLY: 3,
  ERR_SPENDING_LIMIT: 5,
  ERR_BATCH_PARTIAL: 6,
  ERR_DAEMON_LOCKED: 7,
  ERR_STATE_CORRUPT: 8,
  ERR_STDIN_TIMEOUT: 1,
  ERR_DECRYPTION_FAILED: 3,
}

const RETRYABLE: Set<ErrorCode> = new Set([
  'ERR_GAS_TOO_HIGH',
  'ERR_RATE_LIMITED',
  'ERR_NETWORK_TIMEOUT',
  'ERR_API_ERROR',
  'ERR_REVEAL_TIMEOUT',
  'ERR_DOWNLOAD_FAILED',
  'ERR_COMMIT_FAILED',
])

/** Machine-readable recovery command that agents can execute without parsing prose. */
export interface SuggestedCommand {
  command: string
  args: string[]
}

export class CLIError extends Error {
  code: ErrorCode
  exitCode: number
  retryable: boolean
  suggestion: string | null
  retryAfterSeconds: number | null
  suggestedCommand: SuggestedCommand | null

  constructor(code: ErrorCode, message: string, suggestion: string | null = null, retryAfterSeconds: number | null = null) {
    super(message)
    this.name = 'CLIError'
    this.code = code
    this.exitCode = EXIT_CODES[code]
    this.retryable = RETRYABLE.has(code)
    this.suggestion = suggestion
    this.retryAfterSeconds = retryAfterSeconds
    this.suggestedCommand = null
  }

  /** Attach a structured recovery command for agent consumption. */
  withCommand(command: string, args: string[]): this {
    this.suggestedCommand = { command, args }
    return this
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        suggestion: this.suggestion,
        retryAfterSeconds: this.retryAfterSeconds,
        suggestedCommand: this.suggestedCommand,
      },
    }
  }

  toHuman(): string {
    let msg = `error: ${this.code} — ${this.message}`
    if (this.suggestion) msg += `. ${this.suggestion}`
    return msg
  }
}
