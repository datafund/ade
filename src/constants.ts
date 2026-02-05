/**
 * Shared constants for escrow state and limits.
 */

export const ESCROW_STATE = {
  Created: 0,
  Funded: 1,
  KeyCommitted: 2,
  Released: 3,
  Claimed: 4,
  Cancelled: 5,
  Disputed: 6,
  Expired: 7,
} as const

export type EscrowStateValue = typeof ESCROW_STATE[keyof typeof ESCROW_STATE]

export const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
