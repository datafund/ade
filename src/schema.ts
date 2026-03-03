/**
 * Machine-readable command schema for agent discoverability.
 */

export interface CommandParam {
  name: string
  type: 'string' | 'number' | 'boolean'
  required?: boolean
  description: string
  enum?: string[]
  default?: string | number
}

export interface CommandDef {
  name: string
  description: string
  auth: 'none' | 'sign' | 'chain'
  params: CommandParam[]
  returns?: string
  notes?: string
  mutuallyExclusive?: string[][]
  authEscalation?: {
    flag: string
    requires: 'sign' | 'chain'
  }
  constraints?: {
    maxFileSize?: number
    requiresSpendingLimit?: boolean
    rateLimit?: { delayMs: number; backoff?: 'exponential' }
    absoluteCaps?: {
      maxValueEth?: string
      maxDailyEth?: string
      maxCumulativeEth?: string
    }
  }
}

interface AuthLevelDef {
  level: 'none' | 'sign' | 'chain'
  description: string
  credentials: string[]
}

interface CredentialDef {
  name: string
  description: string
  setCommand: string
  required: boolean
  sensitive?: boolean
  default?: string
}

interface EventFieldDef {
  name: string
  fields: Record<string, string>
}

interface ProtocolDef {
  name: string
  version: number
  description: string
  events: EventFieldDef[]
}

interface ErrorFormatDef {
  name: string
  description: string
  shape: string
  discriminant: string
}

export const SCHEMA: {
  version: string
  globalParams: CommandParam[]
  authLevels: AuthLevelDef[]
  credentials: CredentialDef[]
  commands: CommandDef[]
  protocols: ProtocolDef[]
  errorFormats: ErrorFormatDef[]
} = {
  version: '1.1.0',

  globalParams: [
    { name: '--format', type: 'string', description: 'Output format: "json" (default when piped) or "human" (default when TTY). Ignored by watch daemon (always NDJSON).' },
    { name: '--yes', type: 'boolean', description: 'Skip confirmation prompts (required for non-interactive/agent use)' },
  ],

  authLevels: [
    { level: 'none', description: 'No credentials required. Read-only operations.', credentials: [] },
    { level: 'sign', description: 'Requires SX_KEY for EIP-191 API request signing.', credentials: ['SX_KEY'] },
    { level: 'chain', description: 'Requires SX_KEY + SX_RPC for blockchain transactions.', credentials: ['SX_KEY', 'SX_RPC'] },
  ],

  credentials: [
    { name: 'SX_KEY', description: 'Ethereum private key (hex, 64 chars).', setCommand: 'ade set SX_KEY', required: true, sensitive: true },
    { name: 'SX_RPC', description: 'JSON-RPC endpoint URL. Auto-detects chain from chainId response.', setCommand: 'ade set SX_RPC https://mainnet.base.org', required: false, default: 'https://mainnet.base.org' },
    { name: 'BEE_API', description: 'Bee node URL for Swarm uploads. Not needed for downloads (uses public gateway).', setCommand: 'ade set BEE_API http://localhost:1633', required: false, default: 'https://gateway.fairdatasociety.org' },
    { name: 'BEE_STAMP', description: 'Postage batch ID (hex, 64 chars). Required for Swarm uploads.', setCommand: 'ade set BEE_STAMP <hex>', required: false },
    { name: 'SX_API', description: 'Marketplace API base URL.', setCommand: 'ade set SX_API https://agents.datafund.io', required: false, default: 'https://agents.datafund.io' },
  ],

  commands: [
    // ── Read ops ──
    { name: 'skills list', description: 'List available skills', auth: 'none', params: [
      { name: '--category', type: 'string', description: 'Filter by category', enum: ['data', 'model', 'service', 'research', 'other'] },
      { name: '--status', type: 'string', description: 'Filter by status', enum: ['active', 'inactive', 'all'], default: 'active' },
      { name: '--limit', type: 'number', description: 'Max results', default: 50 },
      { name: '--offset', type: 'number', description: 'Pagination offset' },
    ], returns: '{ skills: [{ id, title, description, category, price, seller, status, votes, ... }] }' },
    { name: 'skills show', description: 'Show skill details', auth: 'none', params: [
      { name: 'id', type: 'string', required: true, description: 'Skill ID' },
    ], returns: '{ id, title, description, category, price, seller, status, votes, comments, createdAt, ... }' },
    { name: 'bounties list', description: 'List bounties', auth: 'none', params: [
      { name: '--status', type: 'string', description: 'Filter by status', enum: ['open', 'claimed', 'expired', 'all'], default: 'open' },
      { name: '--limit', type: 'number', description: 'Max results', default: 50 },
      { name: '--offset', type: 'number', description: 'Pagination offset' },
    ], returns: '{ bounties: [{ id, title, description, reward, status, creator, responses, ... }] }' },
    { name: 'bounties show', description: 'Show bounty details', auth: 'none', params: [
      { name: 'id', type: 'string', required: true, description: 'Bounty ID' },
    ], returns: '{ id, title, description, reward, status, creator, responses, createdAt, ... }' },
    { name: 'agents list', description: 'List agents with reputation', auth: 'none', params: [
      { name: '--sort', type: 'string', description: 'Sort field (e.g. reputation)' },
      { name: '--limit', type: 'number', description: 'Max results', default: 50 },
      { name: '--offset', type: 'number', description: 'Pagination offset' },
    ], returns: '{ agents: [{ id, address, reputation, completedDeals, ... }] }' },
    { name: 'agents show', description: 'Show agent reputation', auth: 'none', params: [
      { name: 'id', type: 'string', required: true, description: 'Agent ID' },
    ], returns: '{ id, address, reputation, completedDeals, recentActivity, ... }' },
    { name: 'escrows list', description: 'List escrows', auth: 'none', params: [
      { name: '--state', type: 'string', description: 'Filter by state', enum: ['created', 'funded', 'committed', 'released', 'claimed', 'expired', 'cancelled', 'all'] },
      { name: '--limit', type: 'number', description: 'Max results', default: 50 },
      { name: '--offset', type: 'number', description: 'Pagination offset' },
    ], returns: '{ escrows: [{ id, seller, buyer, amount, state, contentHash, expiresAt, ... }] }' },
    { name: 'escrows show', description: 'Show escrow details', auth: 'none', params: [
      { name: 'id', type: 'string', required: true, description: 'Escrow ID' },
    ], returns: '{ id, seller, buyer, amount, state, contentHash, expiresAt, disputeWindow, ... }' },
    { name: 'wallets list', description: 'List wallets with reputation', auth: 'none', params: [
      { name: '--role', type: 'string', description: 'Filter by role (seller/buyer)' },
      { name: '--limit', type: 'number', description: 'Max results', default: 50 },
      { name: '--offset', type: 'number', description: 'Pagination offset' },
    ], returns: '{ wallets: [{ address, role, reputation, completedDeals, ... }] }' },
    { name: 'stats', description: 'Protocol stats', auth: 'none', params: [],
      returns: '{ totalEscrows, totalVolume, activeSkills, openBounties, ... }' },

    // ── Write ops ──
    { name: 'skills vote', description: 'Vote on a skill', auth: 'sign', params: [
      { name: 'id', type: 'string', required: true, description: 'Skill ID' },
      { name: 'direction', type: 'string', required: true, description: 'up or down', enum: ['up', 'down'] },
    ], returns: '{ success: true }' },
    { name: 'skills comment', description: 'Comment on a skill', auth: 'sign', params: [
      { name: 'id', type: 'string', required: true, description: 'Skill ID' },
      { name: 'body', type: 'string', required: true, description: 'Comment body' },
    ], returns: '{ commentId: string }' },
    { name: 'skills create', description: 'Create a skill listing', auth: 'sign', params: [
      { name: '--title', type: 'string', required: true, description: 'Skill title' },
      { name: '--price', type: 'string', required: true, description: 'Price in ETH (e.g., "0.1")' },
    ], returns: '{ id: string, title: string, price: string }' },
    { name: 'bounties create', description: 'Create a bounty', auth: 'sign', params: [
      { name: '--title', type: 'string', required: true, description: 'Bounty title' },
      { name: '--reward', type: 'number', required: true, description: 'Reward in ETH' },
    ], returns: '{ id: string, title: string, reward: string }' },

    // ── Chain ops ──
    { name: 'escrows create', description: 'Create an escrow on-chain', auth: 'chain', params: [
      { name: '--content-hash', type: 'string', required: true, description: 'Content hash (0x...)' },
      { name: '--price', type: 'string', required: true, description: 'Price in ETH (e.g., "0.1")' },
      { name: '--yes', type: 'boolean', description: 'Skip confirmation prompt' },
    ], returns: '{ escrowId: number, txHash: string, contentHash: string, chain: string, explorer: string }' },
    { name: 'escrows fund', description: 'Fund an escrow', auth: 'chain', params: [
      { name: 'id', type: 'string', required: true, description: 'Escrow ID' },
      { name: '--yes', type: 'boolean', description: 'Skip confirmation prompt' },
    ], returns: '{ txHash: string, status: string, blockNumber: number, chain: string, explorer: string }' },
    { name: 'escrows commit-key', description: 'Commit key release (reads key/salt from keychain)', auth: 'chain', params: [
      { name: 'id', type: 'string', required: true, description: 'Escrow ID' },
      { name: '--buyer-pubkey', type: 'string', description: 'Buyer secp256k1 public key hex for ECDH encryption' },
      { name: '--yes', type: 'boolean', description: 'Skip confirmation prompt' },
    ], returns: '{ txHash: string, status: string, blockNumber: number, chain: string, explorer: string }' },
    { name: 'escrows reveal-key', description: 'Reveal key to buyer (reads key/salt from keychain)', auth: 'chain', params: [
      { name: 'id', type: 'string', required: true, description: 'Escrow ID' },
      { name: '--buyer-pubkey', type: 'string', description: 'Buyer secp256k1 public key hex (uses stored key if committed with ECDH)' },
      { name: '--yes', type: 'boolean', description: 'Skip confirmation prompt' },
    ], returns: '{ txHash: string, status: string, blockNumber: number, chain: string, explorer: string, ecdhEncrypted?: boolean }' },
    { name: 'escrows claim', description: 'Claim escrow payment', auth: 'chain', params: [
      { name: 'id', type: 'string', required: true, description: 'Escrow ID' },
      { name: '--yes', type: 'boolean', description: 'Skip confirmation prompt' },
    ], returns: '{ txHash: string, status: string, blockNumber: number, chain: string, explorer: string }' },
    { name: 'escrows status', description: 'Show escrow state (on-chain + local keys)', auth: 'chain', params: [
      { name: 'id', type: 'string', required: true, description: 'Escrow ID' },
    ], returns: '{ escrowId: number, state: string, seller: string, buyer: string, amount: string, expiresAt: string, keysInKeychain: boolean, keysInBridge: boolean }' },

    // ── Sell (single + batch) ──
    { name: 'sell', description: 'Sell data via escrow (single file or batch directory)', auth: 'chain',
      returns: 'Single: { escrowId, txHash, contentHash, swarmRef, keysStored, chain, explorer, fileSize, encryptedSize }. Batch: { total, success, failed, skipped, results: [...] }',
      notes: 'In --yes mode, encryptionKey/salt are omitted and keysStored:true is returned instead. Keys are stored in OS keychain.',
      mutuallyExclusive: [['--file', '--dir']],
      constraints: { maxFileSize: 52428800, requiresSpendingLimit: true, rateLimit: { delayMs: 500, backoff: 'exponential' }, absoluteCaps: { maxValueEth: '10' } },
      params: [
        { name: '--file', type: 'string', description: 'File to encrypt and escrow (max 50MB). Mutually exclusive with --dir.' },
        { name: '--dir', type: 'string', description: 'Directory for batch sell. Mutually exclusive with --file.' },
        { name: '--price', type: 'string', required: true, description: 'Price in ETH' },
        { name: '--title', type: 'string', description: 'Title for the data' },
        { name: '--description', type: 'string', description: 'Description' },
        { name: '--category', type: 'string', description: 'Marketplace category' },
        { name: '--tags', type: 'string', description: 'Comma-separated tags' },
        { name: '--max-files', type: 'number', description: 'Max files in batch mode', default: 50 },
        { name: '--max-value', type: 'string', description: 'Max price per file in ETH (required with --dir --yes)' },
        { name: '--skip-existing', type: 'boolean', description: 'Skip files already listed on marketplace' },
        { name: '--dry-run', type: 'boolean', description: 'Validate without executing' },
        { name: '--yes', type: 'boolean', description: 'Skip confirmation prompt (masks key material in output)' },
      ],
    },

    // ── Buy ──
    { name: 'buy', description: 'Buy data from escrow (fund, wait for key, download, decrypt)', auth: 'chain',
      returns: '{ escrowId: number, txHash: string, outputPath: string, contentHash: string, verified: boolean, chain: string, explorer: string }',
      notes: 'Blocks until key is revealed (up to --wait-timeout seconds). Auto-decrypts if key is ECDH-encrypted for active Fairdrop account.',
      params: [
        { name: 'id', type: 'string', required: true, description: 'Escrow ID' },
        { name: '--output', type: 'string', description: 'Output file path' },
        { name: '--wait-timeout', type: 'number', description: 'Key wait timeout in seconds', default: 86400 },
        { name: '--yes', type: 'boolean', description: 'Skip confirmation prompt' },
      ],
    },

    // ── Respond ──
    { name: 'respond', description: 'Respond to a bounty with a file', auth: 'chain',
      returns: '{ escrowId: number, txHash: string, contentHash: string, swarmRef: string, keysStored: true, bountyId: string, bountyTitle: string, bountyReward: string }',
      notes: 'Keys stored in OS keychain. Returns keysStored:true.',
      params: [
        { name: 'bounty-id', type: 'string', required: true, description: 'Bounty ID' },
        { name: '--file', type: 'string', required: true, description: 'File to submit' },
        { name: '--message', type: 'string', description: 'Response message' },
        { name: '--yes', type: 'boolean', description: 'Skip confirmation prompt' },
      ],
    },

    // ── Watch daemon ──
    { name: 'watch', description: 'Watch escrows and auto-complete lifecycle (commit, reveal, claim, download)', auth: 'chain',
      returns: 'NDJSON stream on stdout (see protocols section). --status returns WatchStatusResult object.',
      params: [
        { name: '--yes', type: 'boolean', description: 'Non-interactive mode (requires --max-value)' },
        { name: '--dry-run', type: 'boolean', description: 'Show actions without executing' },
        { name: '--once', type: 'boolean', description: 'Single poll cycle then exit' },
        { name: '--status', type: 'boolean', description: 'Query running instance status' },
        { name: '--reset-state', type: 'boolean', description: 'Reset corrupted state file' },
        { name: '--seller-only', type: 'boolean', description: 'Only handle seller duties' },
        { name: '--buyer-only', type: 'boolean', description: 'Only handle buyer duties' },
        { name: '--interval', type: 'number', description: 'Poll interval in seconds', default: 20 },
        { name: '--download-dir', type: 'string', description: 'Directory for buyer downloads', default: '.' },
        { name: '--escrow-ids', type: 'string', description: 'Comma-separated escrow IDs to watch' },
        { name: '--max-value', type: 'string', description: 'Max single escrow value in ETH' },
        { name: '--max-daily', type: 'string', description: 'Max daily cumulative value in ETH' },
        { name: '--max-cumulative', type: 'string', description: 'Lifetime cumulative cap in ETH' },
        { name: '--max-tx-per-cycle', type: 'number', description: 'Max transactions per poll cycle', default: 10 },
        { name: '--quiet', type: 'boolean', description: 'Suppress stderr logs' },
        { name: '--verbose', type: 'boolean', description: 'Debug-level stderr logs' },
        { name: '--password-stdin', type: 'boolean', description: 'Read account password from stdin' },
      ],
      constraints: { requiresSpendingLimit: true, absoluteCaps: { maxValueEth: '10', maxDailyEth: '100', maxCumulativeEth: '1000' } },
    },

    // ── Scan bounties ──
    { name: 'scan-bounties', description: 'Match local files against open bounties', auth: 'none',
      returns: '{ matches: [{bountyId, bountyTitle, bountyReward, file, score, matchedTerms}], total, scanned, excluded, minScore, responses?: [...] }',
      notes: 'Base auth is "none" (read-only scan). When --respond is set, auth escalates to "chain".',
      authEscalation: { flag: '--respond', requires: 'chain' },
      constraints: { maxFileSize: 52428800, requiresSpendingLimit: true, absoluteCaps: { maxValueEth: '10' } },
      params: [
        { name: '--dir', type: 'string', required: true, description: 'Directory to scan' },
        { name: '--respond', type: 'boolean', description: 'Auto-respond to matches (escalates auth to chain)' },
        { name: '--dry-run', type: 'boolean', description: 'With --respond: show what would happen' },
        { name: '--yes', type: 'boolean', description: 'Non-interactive (requires --max-value with --respond)' },
        { name: '--min-score', type: 'number', description: 'Minimum match score 0-1', default: 0 },
        { name: '--max-responses', type: 'number', description: 'Max bounties to respond to (max: 10)', default: 3 },
        { name: '--max-value', type: 'string', description: 'Max bounty reward value per response in ETH' },
        { name: '--exclude', type: 'string', description: 'Comma-separated glob patterns to exclude' },
      ],
    },

    // ── Account management ──
    { name: 'account create', description: 'Create a Fairdrop account (keypair encrypted with password)', auth: 'none',
      returns: '{ subdomain: string, address: string, publicKey: string }',
      notes: 'Requires password input. Use --password-stdin for non-interactive mode.',
      params: [
        { name: 'subdomain', type: 'string', required: true, description: 'Account subdomain/name' },
        { name: '--password-stdin', type: 'boolean', description: 'Read password from stdin' },
      ],
    },
    { name: 'account unlock', description: 'Unlock a Fairdrop account for the session', auth: 'none',
      returns: '{ subdomain: string, address: string, publicKey: string }',
      notes: 'Requires password input. Use --password-stdin for non-interactive mode.',
      params: [
        { name: 'subdomain', type: 'string', required: true, description: 'Account subdomain/name' },
        { name: '--password-stdin', type: 'boolean', description: 'Read password from stdin' },
      ],
    },
    { name: 'account lock', description: 'Lock the active Fairdrop account', auth: 'none',
      returns: '{ locked: true }', params: [] },
    { name: 'account status', description: 'Show active Fairdrop account', auth: 'none',
      returns: '{ active: boolean, subdomain?: string, address?: string, publicKey?: string }', params: [] },
    { name: 'account list', description: 'List all Fairdrop accounts', auth: 'none',
      returns: '{ accounts: string[] }', params: [] },
    { name: 'account export', description: 'Export account keystore backup', auth: 'none',
      returns: '{ subdomain: string, keystore: object }',
      params: [
        { name: 'subdomain', type: 'string', required: true, description: 'Account subdomain/name' },
      ],
    },
    { name: 'account delete', description: 'Delete a Fairdrop account', auth: 'none',
      returns: '{ deleted: true, subdomain: string }',
      params: [
        { name: 'subdomain', type: 'string', required: true, description: 'Account subdomain/name' },
        { name: '--yes', type: 'boolean', description: 'Skip confirmation prompt' },
      ],
    },

    // ── Secrets management ──
    { name: 'set', description: 'Store a secret in OS keychain', auth: 'none',
      returns: '{ stored: true, key: string }',
      params: [
        { name: 'key', type: 'string', required: true, description: 'Secret name (e.g., SX_KEY, SX_RPC, BEE_API)' },
        { name: 'value', type: 'string', description: 'Secret value (omit for interactive prompt, pipe via stdin)' },
      ],
    },
    { name: 'get', description: 'Retrieve a secret from OS keychain', auth: 'none',
      returns: '{ key: string, value: string }',
      params: [
        { name: 'key', type: 'string', required: true, description: 'Secret name' },
      ],
    },
    { name: 'rm', description: 'Delete a secret from OS keychain', auth: 'none',
      returns: '{ deleted: true, key: string }',
      params: [
        { name: 'key', type: 'string', required: true, description: 'Secret name' },
      ],
    },
    { name: 'ls', description: 'List all stored secrets (names only, not values)', auth: 'none',
      returns: '{ keys: string[] }', params: [] },

    // ── Meta ──
    { name: 'schema', description: 'Machine-readable command spec', auth: 'none', params: [],
      returns: 'Full SCHEMA object (this schema definition)' },
    { name: 'config show', description: 'Show active config (secrets masked)', auth: 'none', params: [],
      returns: '{ chain, rpc, address, beeApi, sxApi, ... } (secret values masked)' },
  ],

  protocols: [
    {
      name: 'watch-ndjson',
      version: 1,
      description: 'NDJSON event stream on stdout from ade watch',
      events: [
        { name: 'hello', fields: { protocolVersion: 'number', adeVersion: 'string', address: 'string', mode: 'string' } },
        { name: 'heartbeat', fields: { timestamp: 'string', uptimeSeconds: 'number', cycleCount: 'number', escrowsManaged: 'number' } },
        { name: 'cycle_start', fields: { timestamp: 'string', cycle: 'number' } },
        { name: 'escrow_found', fields: { escrowId: 'number', state: 'string', role: 'string', amount: 'string' } },
        { name: 'key_committed', fields: { escrowId: 'number', txHash: 'string', ecdhCommit: 'boolean' } },
        { name: 'key_revealed', fields: { escrowId: 'number', txHash: 'string', ecdhEncrypted: 'boolean' } },
        { name: 'download_start', fields: { escrowId: 'number', swarmRef: 'string' } },
        { name: 'download_complete', fields: { escrowId: 'number', path: 'string', size: 'number', contentHashVerified: 'boolean' } },
        { name: 'claim_executed', fields: { escrowId: 'number', amount: 'string', txHash: 'string' } },
        { name: 'error', fields: { 'escrowId?': 'number', code: 'string', message: 'string', retryable: 'boolean', 'retryAfterSeconds?': 'number', 'suggestion?': 'string' } },
        { name: 'spending_limit', fields: { type: "'per_escrow'|'daily'|'cumulative'", current: 'string', limit: 'string', action: "'paused'|'skipped'|'shutdown'" } },
        { name: 'cycle_end', fields: { timestamp: 'string', actions: 'number', next: 'string' } },
        { name: 'shutdown', fields: { reason: 'string', stateSaved: 'boolean' } },
      ],
    },
  ],

  errorFormats: [
    {
      name: 'one-shot',
      description: 'Standard command error via CLIError.toJSON()',
      shape: '{ success: false, error: { code: string, message: string, retryable: boolean, suggestion: string|null, retryAfterSeconds: number|null, suggestedCommand: { command: string, args: string[] }|null } }',
      discriminant: 'Check for success: false',
    },
    {
      name: 'ndjson-event',
      description: 'Streaming error from watch daemon',
      shape: '{ event: "error", escrowId?: number, code: string, message: string, retryable: boolean, retryAfterSeconds: number|null, suggestion: string|null }',
      discriminant: 'Check for event field',
    },
  ],
}
