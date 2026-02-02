/**
 * Help system for CLI commands.
 */

const RESOURCES = ['skills', 'bounties', 'agents', 'escrows', 'wallets', 'config'] as const
type Resource = typeof RESOURCES[number]

const ACTIONS: Record<Resource, string[]> = {
  skills: ['list', 'show', 'vote', 'comment', 'create'],
  bounties: ['list', 'show', 'create'],
  agents: ['list', 'show'],
  escrows: ['list', 'show', 'create', 'fund', 'commit-key', 'reveal-key', 'claim'],
  wallets: ['list'],
  config: ['show'],
}

export function showHelp(): void {
  console.log(`ade - Secret Vault & Skill Exchange CLI

Usage:
  ade <command> [args] [options]

Secret Management:
  set <key>            Store a secret (prompts for value)
  get <key>            Retrieve a secret
  rm <key>             Remove a secret
  ls                   List all secret keys

Skill Exchange:
  skills               Manage skill listings
  bounties             Manage bounties
  agents               View agents and reputation
  escrows              Manage data escrows
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
  ade set SX_KEY              # Store private key in keychain
  ade skills list             # List all skills
  ade escrows create --help   # Show help for creating escrows

Configuration (stored via 'ade set'):
  SX_KEY     Private key for signing/chain ops
  SX_RPC     Base chain RPC URL
  SX_API     Custom API URL (default: https://agents.datafund.io)`)
}

export function showResourceHelp(resource: string): void {
  if (!RESOURCES.includes(resource as Resource)) {
    console.log(`Unknown resource: ${resource}

Available resources: ${RESOURCES.join(', ')}

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
  }
}

function getActionDescription(resource: Resource, action: string): string {
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
  --yes   Skip confirmation prompt

Authentication:
  Requires SX_KEY and SX_RPC in keychain

Key Retrieval:
  Automatically reads from keychain:
    ESCROW_<id>_KEY   Encryption key
    ESCROW_<id>_SALT  Salt for commitment

Examples:
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

    default:
      return `No detailed help available for: ade ${resource} ${action}`
  }
}
