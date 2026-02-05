/**
 * Help system for CLI commands.
 */

const RESOURCES = ['skills', 'bounties', 'agents', 'escrows', 'wallets', 'config', 'account'] as const
type Resource = typeof RESOURCES[number]

const ACTIONS: Record<Resource, string[]> = {
  skills: ['list', 'show', 'vote', 'comment', 'create'],
  bounties: ['list', 'show', 'create'],
  agents: ['list', 'show'],
  escrows: ['list', 'show', 'create', 'fund', 'commit-key', 'reveal-key', 'claim', 'status'],
  wallets: ['list'],
  config: ['show'],
  account: ['create', 'unlock', 'lock', 'status', 'list', 'export', 'delete'],
}

export function showHelp(): void {
  console.log(`ade - Secret Vault & Skill Exchange CLI

Usage:
  ade <command> [args] [options]

Secret Management:
  set <key> [value]    Store a secret (value as arg, stdin, or prompt)
  get <key>            Retrieve a secret
  rm <key>             Remove a secret
  ls                   List all secret keys

Data Escrow (Seller Flow):
  sell --file <f>      Sell single file via escrow
  sell --dir <d>       Batch sell files from directory
  escrows              Manage data escrows

Data Escrow (Buyer Flow):
  buy <id>             Fund, wait for key, download, decrypt

Bounty Response:
  respond <id>         Respond to bounty with deliverable

Automation:
  watch                Watch escrows, auto-complete lifecycle
  scan-bounties        Match local files to open bounties

Account Management:
  account              Manage Fairdrop accounts for ECDH key exchange

Skill Exchange:
  skills               Manage skill listings
  bounties             Manage bounties
  agents               View agents and reputation
  wallets              View wallets
  config               View configuration

Meta:
  stats                Protocol statistics
  schema               Machine-readable command spec
  version              Show version
  update               Update to latest version
  help [topic]         Show help for a topic

Options:
  --format json|human  Output format (auto-detects TTY)
  --help, -h           Show help for any command

Examples:
  # Seller: Sell data via escrow
  ade sell --file data.csv --price 0.1 --yes

  # Buyer: Purchase escrowed data
  ade buy 42 --output ./data.csv --yes

  # Respond to bounty
  ade respond abc123 --file ./solution.zip --yes

  # Check escrow status
  ade escrows status 42

Configuration (stored via 'ade set'):
  SX_KEY     Private key for signing/chain ops
  SX_RPC     Base chain RPC URL (default: https://mainnet.base.org)
  BEE_API    Bee node URL (e.g., http://localhost:1633)
  BEE_STAMP  Postage batch ID (64 hex chars)
  SX_API     Custom API URL (default: https://agents.datafund.io)`)
}

export function showResourceHelp(resource: string): void {
  // Handle meta commands
  if (resource === 'sell' || resource === 'create') {
    showSellHelp()
    return
  }
  if (resource === 'buy') {
    showBuyHelp()
    return
  }
  if (resource === 'respond') {
    showRespondHelp()
    return
  }
  if (resource === 'watch') {
    showWatchHelp()
    return
  }
  if (resource === 'scan-bounties') {
    showScanBountiesHelp()
    return
  }

  if (!RESOURCES.includes(resource as Resource)) {
    console.log(`Unknown resource: ${resource}

Available resources: ${RESOURCES.join(', ')}, sell, buy, respond, watch, scan-bounties

Run 'ade help' for overview.`)
    return
  }

  const actions = ACTIONS[resource as Resource]
  console.log(`ade ${resource} - ${getResourceDescription(resource as Resource)}

Usage:
  ade ${resource} <action> [args] [options]

Actions:`)

  for (const action of actions) {
    console.log(`  ${action.padEnd(14)} ${getActionDescription(resource as Resource, action)}`)
  }

  console.log(`
For detailed help on an action:
  ade ${resource} <action> --help
  ade help ${resource} <action>`)
}

function showSellHelp(): void {
  console.log(`ade sell - Sell data via escrow

USAGE:
  ade sell --file <path> --price <eth> [options]
  ade sell --dir <path> --price <eth> [--max-value <eth>] [options]

DESCRIPTION:
  The unified seller command that handles the complete escrow creation flow:
  1. Reads and encrypts your file with AES-256-GCM
  2. Uploads encrypted data to Swarm
  3. Creates escrow on-chain with key commitment
  4. Stores encryption keys in OS keychain
  5. Publishes to marketplace

REQUIRED:
  --file <path>      File to encrypt and escrow (max 50MB)
  --price <eth>      Price in ETH (e.g., "0.1")

OPTIONS:
  --title <text>     Title for the data
  --description <text>  Description
  --category <cat>   Marketplace category
  --tags <t1,t2>     Comma-separated tags
  --dry-run          Validate everything without executing (no uploads, no tx)
  --yes              Skip confirmation prompt

BATCH OPTIONS (--dir mode):
  --dir <path>       Batch sell: encrypt and escrow all files in directory
  --max-value <eth>  Max price per file (required with --dir --yes)
  --max-files <n>    Max files to process (default: 50)
  --skip-existing    Skip files already listed on marketplace

REQUIRED SECRETS (set via 'ade set'):
  SX_KEY            Private key for transactions
  BEE_API           Bee node URL (e.g., http://localhost:1633)
  BEE_STAMP         Postage batch ID (64 hex chars)

EXAMPLES:
  # Sell single file
  ade sell --file ./data.csv --price 0.01

  # Dry run to validate without spending gas
  ade sell --file ./data.csv --price 0.1 --dry-run

  # Sell with metadata and skip confirmation
  ade sell --file ./report.pdf --price 0.1 --title "Q4 Report" --yes

  # Batch sell a directory
  ade sell --dir ./data/ --price 0.01 --yes --max-value 0.1

  # Batch sell with skip existing
  ade sell --dir ./data/ --price 0.01 --skip-existing --yes --max-value 0.1

  # Dry run batch
  ade sell --dir ./data/ --price 0.01 --dry-run

NOTES:
  --file and --dir are mutually exclusive.
  In batch mode, filenames are used as titles.
  With --yes, encryption keys are stored in keychain and omitted from output.

OUTPUT:
  Returns escrow ID, transaction hash, Swarm reference, and encryption keys.
  Keys are automatically stored in keychain as:
    ESCROW_<id>_KEY           Encryption key
    ESCROW_<id>_SALT          Salt for commitment
    ESCROW_<id>_SWARM         Swarm reference
    ESCROW_<id>_CONTENT_HASH  Content hash for verification

NEXT STEPS:
  After buyer funds the escrow:
    ade escrows commit-key <id> --yes
    # Wait 2 blocks + 60 seconds
    ade escrows reveal-key <id> --yes
    # After 24h dispute window
    ade escrows claim <id> --yes`)
}

function showWatchHelp(): void {
  console.log(`ade watch - Watch escrows and auto-complete lifecycle

Usage: ade watch [options]

Watch escrows and auto-complete lifecycle (commit, reveal, claim, download).
Outputs machine-readable NDJSON events on stdout.

Modes:
  ade watch [--yes]             Daemon mode (long-running, NDJSON on stdout)
  ade watch --once              Single poll cycle then exit
  ade watch --status            Query running instance status
  ade watch --reset-state       Reset corrupted state file

Daemon Options:
  --yes                   Non-interactive mode (requires --max-value)
  --dry-run               Show actions without executing transactions
  --seller-only           Only handle seller duties (commit, reveal, claim)
  --buyer-only            Only handle buyer duties (download, decrypt)
  --interval <seconds>    Poll interval (default: 20)
  --download-dir <path>   Directory for buyer downloads (default: cwd)
  --escrow-ids <ids>      Comma-separated escrow IDs to watch
  --password-stdin        Read Fairdrop account password from stdin for ECDH

Spending Limits:
  --max-value <ETH>       Max single escrow value (required with --yes, max 10 ETH)
  --max-daily <ETH>       Max daily cumulative value (resets UTC midnight)
  --max-cumulative <ETH>  Lifetime cumulative cap (never resets, persisted in keychain)
  --max-tx-per-cycle <n>  Max transactions per poll cycle (default: 10)

Output:
  --quiet                 Suppress stderr logs (NDJSON only on stdout)
  --verbose               Debug-level stderr logs

NDJSON Protocol:
  Stdout emits one JSON object per line. Events: hello, heartbeat, cycle_start,
  escrow_found, key_committed, key_revealed, download_start, download_complete,
  claim_executed, error, spending_limit, cycle_end, shutdown.

Required Secrets:
  SX_KEY                  Ethereum private key (ade set SX_KEY)

Examples:
  ade watch --yes --max-value 0.1 --max-daily 1.0
  ade watch --once --dry-run
  ade watch --status

Exit Codes:
  0  Clean shutdown       5  Spending limit exceeded
  1  Invalid arguments    7  Another instance running
  2  Missing credentials  8  Corrupted state file
  3  Chain error`)
}

function showScanBountiesHelp(): void {
  console.log(`ade scan-bounties - Match local files against open bounties

Usage: ade scan-bounties --dir <path> [options]

Match local files against open bounties on the marketplace.

Options:
  --dir <path>            Directory to scan (required)
  --respond               Auto-respond to best matches (creates escrows)
  --dry-run               With --respond: show what would happen
  --yes                   Non-interactive (requires --max-value with --respond)
  --min-score <0-1>       Minimum match score (default: 0, forced 0.5 with --respond --yes)
  --max-responses <n>     Max bounties to respond to (default: 3, max: 10)
  --max-value <ETH>       Max bounty reward value per response (required with --respond --yes)
  --exclude <patterns>    Comma-separated glob patterns to exclude (added to defaults)

Default Excludes:
  *.env, *.pem, *.key, *.p12, *.pfx, .ssh/*, .gnupg/*, .config/*,
  id_rsa*, *.sqlite, *.db, *.log, node_modules/*

Scoring:
  Simple keyword overlap between filename terms and bounty terms.
  Score = matched_terms / total_bounty_terms. Agents can pipe JSON output
  through their own LLM-based relevance scoring for better results.

Auth Escalation:
  Base auth is "none" (read-only scan). When --respond is set, auth escalates
  to "chain" (requires SX_KEY for escrow creation).

Examples:
  ade scan-bounties --dir ./knowledge/
  ade scan-bounties --dir ./data/ --respond --dry-run
  ade scan-bounties --dir ./data/ --respond --yes --max-value 0.05 --max-responses 3
  ade scan-bounties --min-score 0.5 --dir ./data/

Exit Codes:
  0  Success (even zero matches)
  1  Configuration error
  6  Partial response failures (some --respond calls failed)`)
}

function showBuyHelp(): void {
  console.log(`ade buy - Complete buyer flow for data escrow

USAGE:
  ade buy <escrow-id> [options]

DESCRIPTION:
  One command to purchase escrowed data:
  1. Reads escrow details from chain (price, seller, content hash)
  2. Verifies you have sufficient balance
  3. Funds the escrow
  4. Waits for seller to reveal the encryption key
  5. Downloads encrypted data from Swarm
  6. Verifies content hash matches on-chain hash
  7. Decrypts data with revealed key
  8. Writes to output file

ARGUMENTS:
  <escrow-id>        The escrow ID to purchase (required)

OPTIONS:
  --output <path>    Output file path (default: escrow_<id>_data)
  --wait-timeout <s> Seconds to wait for key reveal (default: 86400 = 24h)
  --yes              Skip confirmation prompt

REQUIRED SECRETS (set via 'ade set'):
  SX_KEY            Private key for transactions
  BEE_API           Bee node URL for downloading

EXAMPLES:
  # Purchase escrow and save to default file
  ade buy 42 --yes

  # Specify output file
  ade buy 42 --output ./purchased_data.csv --yes

  # Custom timeout for key reveal (1 hour)
  ade buy 42 --wait-timeout 3600

OUTPUT:
  Returns fund transaction hash, output file path, and verification status.

NOTE:
  The command will wait for the seller to reveal the key. If the seller
  doesn't reveal within the timeout, you can retry later or raise a dispute.`)
}

function showRespondHelp(): void {
  console.log(`ade respond - Respond to a bounty with deliverable

USAGE:
  ade respond <bounty-id> --file <path> [options]

DESCRIPTION:
  Respond to a bounty by creating an escrow with your deliverable:
  1. Fetches bounty details (reward, requirements, creator)
  2. Displays bounty info and confirms response
  3. Encrypts, uploads, and creates escrow (like 'ade create')
  4. Links escrow to bounty via API

ARGUMENTS:
  <bounty-id>        The bounty ID to respond to (required)

REQUIRED:
  --file <path>      File to deliver (max 50MB)

OPTIONS:
  --message <text>   Optional message to bounty creator
  --yes              Skip confirmation prompt

REQUIRED SECRETS (set via 'ade set'):
  SX_KEY            Private key for transactions
  BEE_API           Bee node URL
  BEE_STAMP         Postage batch ID

EXAMPLES:
  # Respond to bounty with solution file
  ade respond abc123 --file ./solution.zip --yes

  # Include a message for the creator
  ade respond abc123 --file ./analysis.csv --message "Here's the data analysis"

OUTPUT:
  Returns escrow ID, bounty details, and link confirmation.
  The bounty creator can then fund your escrow to purchase the deliverable.

WORKFLOW:
  1. Bounty creator posts bounty: ade bounties create --title "..." --reward 0.5
  2. You respond: ade respond <bounty-id> --file ./solution.zip
  3. Creator purchases: ade buy <escrow-id>
  4. You reveal key: ade escrows reveal-key <escrow-id>
  5. You claim payment: ade escrows claim <escrow-id>`)
}

export function showActionHelp(resource: string, action: string): void {
  if (!RESOURCES.includes(resource as Resource)) {
    console.log(`Unknown resource: ${resource}`)
    return
  }

  const actions = ACTIONS[resource as Resource]
  if (!actions.includes(action)) {
    console.log(`Unknown action: ${action} for ${resource}

Available actions: ${actions.join(', ')}`)
    return
  }

  const help = getDetailedHelp(resource as Resource, action)
  console.log(help)
}

function getResourceDescription(resource: Resource): string {
  switch (resource) {
    case 'skills': return 'Manage skill listings'
    case 'bounties': return 'Manage bounties'
    case 'agents': return 'View agents and reputation'
    case 'escrows': return 'Manage data escrows'
    case 'wallets': return 'View wallets'
    case 'config': return 'View configuration'
    case 'account': return 'Manage Fairdrop accounts for ECDH key exchange'
  }
}

function getActionDescription(resource: Resource, action: string): string {
  // Account-specific descriptions
  if (resource === 'account') {
    const accountDescs: Record<string, string> = {
      'create': 'Create a new Fairdrop account',
      'unlock': 'Unlock account for use in session',
      'lock': 'Lock the active account',
      'status': 'Show active account status',
      'list': 'List all stored accounts',
      'export': 'Export account keystore for backup',
      'delete': 'Delete an account permanently',
    }
    return accountDescs[action] || action
  }

  const descriptions: Record<string, string> = {
    'list': 'List items with optional filters',
    'show': 'Show details for a specific item',
    'create': 'Create a new item',
    'vote': 'Vote up or down',
    'comment': 'Add a comment',
    'fund': 'Fund an escrow',
    'commit-key': 'Commit encryption key release',
    'reveal-key': 'Reveal encryption key to buyer',
    'claim': 'Claim payment after dispute window',
    'status': 'Check escrow state and local keys',
  }
  return descriptions[action] || action
}

function getDetailedHelp(resource: Resource, action: string): string {
  // Common list options
  const listOpts = `  --limit <n>    Max results (default: 50)
  --offset <n>   Pagination offset`

  switch (`${resource} ${action}`) {
    case 'skills list':
      return `ade skills list - List available skills

Usage:
  ade skills list [options]

Options:
${listOpts}
  --category <s> Filter by category
  --status <s>   Filter by status (default: active)

Examples:
  ade skills list
  ade skills list --category ai --limit 10`

    case 'skills show':
      return `ade skills show - Show skill details

Usage:
  ade skills show <id>

Arguments:
  <id>    Skill ID (required)

Examples:
  ade skills show abc123`

    case 'skills vote':
      return `ade skills vote - Vote on a skill

Usage:
  ade skills vote <id> <direction>

Arguments:
  <id>         Skill ID (required)
  <direction>  Vote direction: up or down (required)

Authentication:
  Requires SX_KEY in keychain (ade set SX_KEY)

Examples:
  ade skills vote abc123 up
  ade skills vote abc123 down`

    case 'skills comment':
      return `ade skills comment - Comment on a skill

Usage:
  ade skills comment <id> "<body>"

Arguments:
  <id>     Skill ID (required)
  <body>   Comment text (required)

Authentication:
  Requires SX_KEY in keychain (ade set SX_KEY)

Examples:
  ade skills comment abc123 "Great skill!"`

    case 'skills create':
      return `ade skills create - Create a skill listing

Usage:
  ade skills create --title <s> --price <n> [options]

Options:
  --title <s>       Skill title (required)
  --price <n>       Price in ETH (required)
  --description <s> Description
  --category <s>    Category

Authentication:
  Requires SX_KEY in keychain (ade set SX_KEY)

Examples:
  ade skills create --title "Data Analysis" --price 0.1`

    case 'bounties list':
      return `ade bounties list - List bounties

Usage:
  ade bounties list [options]

Options:
${listOpts}
  --status <s>   Filter by status (default: open)

Examples:
  ade bounties list --status open`

    case 'bounties show':
      return `ade bounties show - Show bounty details

Usage:
  ade bounties show <id>

Arguments:
  <id>    Bounty ID (required)`

    case 'bounties create':
      return `ade bounties create - Create a bounty

Usage:
  ade bounties create --title <s> --reward <n> [options]

Options:
  --title <s>       Bounty title (required)
  --reward <n>      Reward in ETH (required)
  --description <s> Description
  --category <s>    Category

Authentication:
  Requires SX_KEY in keychain (ade set SX_KEY)`

    case 'agents list':
      return `ade agents list - List agents with reputation

Usage:
  ade agents list [options]

Options:
${listOpts}
  --sort <s>     Sort field (e.g. reputation)`

    case 'agents show':
      return `ade agents show - Show agent reputation

Usage:
  ade agents show <id>

Arguments:
  <id>    Agent ID (required)`

    case 'escrows list':
      return `ade escrows list - List escrows

Usage:
  ade escrows list [options]

Options:
${listOpts}
  --state <s>    Filter by state (created, funded, key_committed, released, claimed)`

    case 'escrows show':
      return `ade escrows show - Show escrow details

Usage:
  ade escrows show <id>

Arguments:
  <id>    Escrow ID (required)`

    case 'escrows create':
      return `ade escrows create - Create an escrow on-chain

Usage:
  ade escrows create --content-hash <0x...> --price <n> [options]

Options:
  --content-hash <0x...>  Content hash (required)
  --price <n>             Price in ETH (required)
  --yes                   Skip confirmation prompt

Authentication:
  Requires SX_KEY and SX_RPC in keychain

Key Management:
  On success, encryption key and salt are automatically stored in keychain:
    ESCROW_<id>_KEY   Encryption key
    ESCROW_<id>_SALT  Salt for commitment

Examples:
  ade escrows create --content-hash 0xabc... --price 0.1 --yes`

    case 'escrows fund':
      return `ade escrows fund - Fund an escrow

Usage:
  ade escrows fund <id> [options]

Arguments:
  <id>    Escrow ID (required)

Options:
  --yes   Skip confirmation prompt

Authentication:
  Requires SX_KEY and SX_RPC in keychain

Examples:
  ade escrows fund 42 --yes`

    case 'escrows commit-key':
      return `ade escrows commit-key - Commit encryption key release

Usage:
  ade escrows commit-key <id> [options]

Arguments:
  <id>    Escrow ID (required)

Options:
  --yes   Skip confirmation prompt

Authentication:
  Requires SX_KEY and SX_RPC in keychain

Key Retrieval:
  Automatically reads from keychain:
    ESCROW_<id>_KEY   Encryption key
    ESCROW_<id>_SALT  Salt for commitment

Note:
  Keys are auto-stored when you create an escrow with 'ade escrows create'.
  No need to manually specify --key or --salt flags.

Examples:
  ade escrows commit-key 42 --yes`

    case 'escrows reveal-key':
      return `ade escrows reveal-key - Reveal encryption key to buyer

Usage:
  ade escrows reveal-key <id> [options]

Arguments:
  <id>    Escrow ID (required)

Options:
  --buyer-pubkey <hex>  Buyer's secp256k1 public key for ECDH encryption
  --yes                 Skip confirmation prompt

ECDH Key Exchange (Recommended):
  If --buyer-pubkey is provided, the AES key will be encrypted using ECDH
  so only the buyer can decrypt it. The buyer should share their public key:
    Buyer runs: ade account status
    Buyer shares publicKey with seller

  Without --buyer-pubkey, the raw key is revealed on-chain (less secure).

Authentication:
  Requires SX_KEY and SX_RPC in keychain

Key Retrieval:
  Automatically reads from keychain:
    ESCROW_<id>_KEY   Encryption key
    ESCROW_<id>_SALT  Salt for commitment

Examples:
  # With ECDH (recommended)
  ade escrows reveal-key 42 --buyer-pubkey 0x02abc123... --yes

  # Without ECDH (raw key on-chain)
  ade escrows reveal-key 42 --yes`

    case 'escrows claim':
      return `ade escrows claim - Claim payment after dispute window

Usage:
  ade escrows claim <id> [options]

Arguments:
  <id>    Escrow ID (required)

Options:
  --yes   Skip confirmation prompt

Authentication:
  Requires SX_KEY and SX_RPC in keychain

Note:
  Can only claim after the dispute window has passed (24h default).

Examples:
  ade escrows claim 42 --yes`

    case 'escrows status':
      return `ade escrows status - Check escrow state and local keys

Usage:
  ade escrows status <id>

Arguments:
  <id>    Escrow ID (required)

Description:
  Shows comprehensive status of an escrow including:
  - On-chain state (Created, Funded, KeyCommitted, Released, Claimed, etc.)
  - Whether local keys are stored in keychain
  - Seller/buyer addresses
  - Price and expiration
  - Content hash

Output:
  {
    "escrowId": 42,
    "state": "Funded",
    "hasLocalKeys": true,
    "hasSwarmRef": true,
    "hasContentHash": true,
    "onChain": { ... },
    "local": { ... }
  }

Examples:
  ade escrows status 42
  ade escrows status 42 --format json`

    case 'wallets list':
      return `ade wallets list - List wallets with reputation

Usage:
  ade wallets list [options]

Options:
${listOpts}
  --role <s>     Filter by role (seller/buyer)`

    case 'config show':
      return `ade config show - Show active configuration

Usage:
  ade config show

Output:
  Shows current configuration including:
  - API endpoint
  - RPC endpoint
  - Key status (masked)
  - Contract address
  - Chain ID`

    case 'account create':
      return `ade account create - Create a new Fairdrop account

Usage:
  ade account create <subdomain>

Arguments:
  <subdomain>    Unique name for your account (letters, numbers, hyphens, underscores)

Description:
  Creates a new secp256k1 keypair for ECDH key exchange and stores it encrypted
  in the OS keychain. You'll be prompted to enter a password twice.

  The keypair enables secure key exchange in escrow transactions:
  - Sellers encrypt AES keys for specific buyers using ECDH
  - Buyers decrypt with their private key
  - Keys are never revealed publicly on-chain

Examples:
  ade account create alice
  ade account create my-trading-account`

    case 'account unlock':
      return `ade account unlock - Unlock an account for use

Usage:
  ade account unlock <subdomain>

Arguments:
  <subdomain>    Name of the account to unlock

Description:
  Decrypts the account's keystore and loads it into the session.
  You'll be prompted for your password.

  While unlocked, the account is used for:
  - Encrypting revealed keys for buyers (as seller)
  - Decrypting received keys (as buyer)

Examples:
  ade account unlock alice`

    case 'account lock':
      return `ade account lock - Lock the active account

Usage:
  ade account lock

Description:
  Clears the unlocked account from memory, removing the private key
  from the current session. Use this when done with sensitive operations.

Examples:
  ade account lock`

    case 'account status':
      return `ade account status - Show active account status

Usage:
  ade account status

Output:
  Shows whether an account is currently unlocked and its details:
  - Subdomain name
  - Public key (hex) - Share this with sellers for ECDH key exchange
  - Ethereum-style address

ECDH Key Exchange:
  When buying data, share your public key with the seller so they can
  encrypt the AES key specifically for you. This keeps the key private
  on-chain (only you can decrypt it with your private key).

  Workflow:
    1. Buyer: ade account create mybuyeraccount
    2. Buyer: ade account unlock mybuyeraccount
    3. Buyer: ade account status  # Get your public key
    4. Buyer: Share public key with seller (any channel)
    5. Seller: ade escrows reveal-key <id> --buyer-pubkey <your-pubkey>
    6. Buyer: ade buy <id>  # Decrypts with your private key

Examples:
  ade account status`

    case 'account list':
      return `ade account list - List all stored accounts

Usage:
  ade account list

Output:
  Lists all accounts stored in the keychain with their status:
  - subdomain: The account name
  - active: Whether this account is currently unlocked

Examples:
  ade account list`

    case 'account export':
      return `ade account export - Export account keystore for backup

Usage:
  ade account export <subdomain>

Arguments:
  <subdomain>    Name of the account to export

Output:
  Returns the encrypted keystore JSON. Save this securely as a backup.
  The keystore is encrypted with your password and can be imported later.

Examples:
  ade account export alice > alice-backup.json
  ade account export alice --format json`

    case 'account delete':
      return `ade account delete - Delete an account permanently

Usage:
  ade account delete <subdomain> --yes

Arguments:
  <subdomain>    Name of the account to delete

Options:
  --yes          Required confirmation flag

WARNING:
  This permanently deletes the account from your keychain.
  Make sure you have a backup (ade account export) before deleting.
  Lost private keys cannot be recovered.

Examples:
  ade account delete alice --yes`

    default:
      return `No detailed help available for: ade ${resource} ${action}`
  }
}
