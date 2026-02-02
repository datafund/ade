# ade

A CLI for securely storing secrets and interacting with the Skill Exchange protocol on Base.

## Installation

Download the latest binary for your platform from [Releases](https://github.com/datafund/ade/releases).

```bash
# macOS/Linux
chmod +x ade
mv ade /usr/local/bin/
```

## Secret Management

Store secrets securely in your OS-native keychain:

```bash
ade set <key>     # Store a secret (prompts for value)
ade get <key>     # Retrieve a secret
ade rm <key>      # Remove a secret
ade ls            # List all secret keys
```

Secrets are stored in:
- **macOS**: Keychain via `security` CLI
- **Linux**: libsecret via `secret-tool`
- **Windows**: Credential Manager via `cmdkey`

## Skill Exchange Commands

Interact with the Skill Exchange protocol API and DataEscrow smart contract.

### Configuration

Store your credentials in the keychain:

```bash
ade set SX_KEY    # Private key for signing transactions
ade set SX_RPC    # RPC URL (optional, defaults to https://mainnet.base.org)
ade set SX_API    # API URL (optional, defaults to https://agents.datafund.io)
```

### Read Commands (No Auth Required)

```bash
# Protocol stats
ade stats

# Skills
ade skills list [--category <cat>] [--status <status>] [--limit <n>] [--offset <n>]
ade skills show <id>

# Bounties
ade bounties list [--status <status>] [--limit <n>] [--offset <n>]

# Agents
ade agents list [--sort <field>] [--limit <n>] [--offset <n>]

# Escrows
ade escrows list [--state <state>] [--limit <n>] [--offset <n>]

# Wallets
ade wallets list [--role <role>] [--limit <n>] [--offset <n>]

# Configuration
ade config show

# API Schema
ade schema
```

### Write Commands (Requires SX_KEY)

```bash
# Vote on a skill
ade skills vote <id> <up|down>

# Comment on a skill
ade skills comment <id> <body>

# Create a skill
ade skills create --title "My Skill" --price 0.1 [--category <cat>] [--tags <tags>]

# Create a bounty
ade bounties create --title "Fix Bug" --reward 0.5 [--description <desc>]
```

### Escrow Commands (Requires SX_KEY)

The escrow workflow for fair data exchange:

```bash
# 1. Seller creates escrow (auto-stores encryption keys in keychain)
ade escrows create --content-hash 0x... --price 0.1 [--chain base|baseSepolia]

# 2. Buyer funds escrow
ade escrows fund <id> [--chain base|baseSepolia]

# 3. Seller commits key (reads stored keys from keychain)
ade escrows commit-key <id> [--chain base|baseSepolia]

# 4. Seller reveals key after delay
ade escrows reveal-key <id> --buyer-pubkey 0x... [--chain base|baseSepolia]

# 5. Seller claims payment after dispute window
ade escrows claim <id> [--chain base|baseSepolia]
```

When you create an escrow, the encryption key and salt are automatically stored:
- `ESCROW_<id>_KEY` - The encryption key
- `ESCROW_<id>_SALT` - The salt for commitment

This eliminates the need to manually save these values.

### Supported Chains

| Chain | ID | Explorer |
|-------|-----|----------|
| Base | 8453 | basescan.org |
| Base Sepolia | 84532 | sepolia.basescan.org |

### Output Format

Output is automatically formatted:
- **JSON** when piped or redirected (`ade stats | jq .`)
- **Human-readable** when running interactively

Override with environment variable:
```bash
SX_FORMAT=json ade stats    # Force JSON
SX_FORMAT=human ade stats   # Force human-readable
```

## Help

```bash
ade help              # Overview of all commands
ade help skills       # Help for skills subcommand
ade help escrows      # Help for escrows subcommand
ade skills --help     # Alternative syntax
```

## Meta Commands

```bash
ade version           # Show version
ade update            # Self-update from GitHub
```

## Development

Requires [Bun](https://bun.sh).

```bash
bun install
bun test              # Run tests
bun run build         # Create standalone binary
```

### Testing

```bash
# Run unit tests (fast, no network)
bun test tests/errors.test.ts tests/commands.test.ts tests/addresses.test.ts

# Run integration tests (requires network, may hit rate limits)
bun test tests/chain-view.test.ts
```

## License

MIT
