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
ade set <key> [value]   # Store a secret
ade get <key>           # Retrieve a secret
ade rm <key>            # Remove a secret
ade ls                  # List all secret keys
```

**Setting secrets (3 methods):**
```bash
# Method 1: Value as argument (best for automation/agents)
ade set SX_RPC https://sepolia.base.org

# Method 2: Pipe from stdin
echo "my-value" | ade set MY_KEY

# Method 3: Interactive prompt (for sensitive values like private keys)
ade set SX_KEY
# Enter secret: <hidden input>
```

Secrets are stored in:
- **macOS**: Keychain via `security` CLI
- **Linux**: libsecret via `secret-tool`
- **Windows**: Credential Manager via `cmdkey`

## Skill Exchange Commands

Interact with the Skill Exchange protocol API and DataEscrow smart contract.

### Configuration

Store your credentials securely in the OS keychain:

| Secret | Required | Description |
|--------|----------|-------------|
| `SX_KEY` | **Yes** (for write commands) | Ethereum private key for signing transactions |
| `SX_RPC` | No | RPC URL (defaults to https://mainnet.base.org) |
| `BEE_API` | **Yes** (for `ade sell`) | Bee node URL (e.g., http://localhost:1633) |
| `BEE_STAMP` | **Yes** (for `ade sell`) | Postage batch ID (64 hex chars) |
| `SX_API` | No | API URL (defaults to https://agents.datafund.io) |

**Quick setup for write commands:**
```bash
ade set SX_KEY                            # Interactive prompt (recommended for private keys)
```

**Optional configuration:**
```bash
ade set SX_RPC https://sepolia.base.org   # Use Base Sepolia testnet
ade set SX_API https://api.example.com    # Custom API endpoint
```

#### SX_KEY - Your Private Key

`SX_KEY` is an Ethereum private key (32 bytes, 64 hex characters) used for:
- **Signing blockchain transactions** (creating escrows, funding, claiming)
- **API authentication** via EIP-191 signatures

**How to get a private key:**

1. **From an existing wallet** (MetaMask, Rainbow, etc.):
   - Export your private key from wallet settings
   - ⚠️ Never share or expose your private key

2. **Generate a new one** using cast (from [Foundry](https://book.getfoundry.sh/)):
   ```bash
   cast wallet new
   ```

3. **Generate using openssl:**
   ```bash
   openssl rand -hex 32
   ```

**Adding your private key:**

```bash
# Interactive (recommended - hides input):
ade set SX_KEY
# Enter secret: <paste key, hidden>

# Or via argument (use with caution - visible in shell history):
ade set SX_KEY 0x1234...your_private_key
```

**Verify it's stored:**

```bash
ade config show
# Shows: SX_KEY: 0x1234...abcd (masked)
```

⚠️ **Security notes:**
- Your private key is stored in your OS-native keychain (encrypted at rest)
- Never commit private keys to git or share them
- Use a dedicated wallet for development/testing
- For production, consider using a hardware wallet or secure key management

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

### Sell Data (Unified Escrow Creation)

The `ade sell` command handles the complete seller workflow in a single step:

```bash
# One command to encrypt, upload, and create escrow
ade sell --file ./data.csv --price 0.1 --yes

# Dry run to validate without spending gas
ade sell --file ./data.csv --price 0.1 --dry-run
```

This automatically:
1. Reads and encrypts your file with AES-256-GCM
2. Uploads encrypted data to Swarm
3. Creates escrow on-chain with key commitment
4. Stores encryption keys in OS keychain

**Options:**
- `--file <path>` - File to encrypt and escrow (required)
- `--price <eth>` - Price in ETH (required)
- `--dry-run` - Validate everything without executing transactions
- `--yes` - Skip confirmation prompts

**Required secrets for `ade sell`:**
```bash
ade set SX_KEY                              # Private key (interactive prompt)
ade set BEE_API http://localhost:1633       # Bee node URL
ade set BEE_STAMP abc123...                 # Postage batch ID (64 hex chars)
```

**Example output:**
```json
{
  "escrowId": 42,
  "txHash": "0x...",
  "swarmRef": "abc123...",
  "contentHash": "0x...",
  "encryptionKey": "0x...",
  "salt": "0x..."
}
```

### Complete Buyer Flow

The `ade buy` command handles the complete purchase workflow:

```bash
# Fund escrow, wait for key, download, and decrypt
ade buy 42 --yes

# Specify output file
ade buy 42 --output ./purchased-data.csv --yes

# Custom timeout for key reveal (default: 24 hours)
ade buy 42 --wait-timeout 3600 --yes
```

This automatically:
1. Reads escrow details from chain (price, content hash)
2. Verifies sufficient balance (including gas)
3. Funds the escrow
4. Waits for seller to reveal key
5. Downloads encrypted data from Swarm
6. Verifies content hash matches on-chain
7. Decrypts and saves to file

**Required secrets for `ade buy`:**
```bash
ade set SX_KEY                              # Private key (interactive prompt)
ade set BEE_API http://localhost:1633       # Bee node URL
```

### Bounty Response Flow

The `ade respond` command creates an escrow in response to a bounty:

```bash
# Respond to a bounty with a deliverable file
ade respond abc123 --file ./solution.zip --yes

# Include a message for the bounty creator
ade respond abc123 --file ./analysis.csv --message "Here's the data analysis" --yes
```

This automatically:
1. Fetches bounty details (reward amount, requirements)
2. Creates escrow using the bounty reward as price
3. Links the escrow to the bounty via API

**Required secrets:** Same as `ade sell`

### Account Management (ECDH Key Exchange)

The `ade account` commands manage Fairdrop accounts for secure ECDH key exchange:

```bash
# Create a new account (you'll be prompted for a password)
ade account create alice

# Unlock account for the current session
ade account unlock alice

# Check active account status
ade account status

# List all stored accounts
ade account list

# Lock account when done
ade account lock

# Export keystore for backup
ade account export alice > alice-backup.json

# Delete an account (WARNING: permanent!)
ade account delete alice --yes
```

**Why use accounts?**
- Sellers can encrypt revealed keys specifically for the buyer using ECDH
- Buyers decrypt with their private key - keys are never exposed publicly on-chain
- Provides forward secrecy through ephemeral keypairs

**Workflow with ECDH:**
1. Buyer creates and unlocks their account
2. Buyer shares their public key with the seller (any channel - email, chat, etc.)
3. Buyer funds the escrow: `ade buy <id>`
4. Seller reveals key encrypted for buyer: `ade escrows reveal-key <id> --buyer-pubkey <pubkey>`
5. Buyer decrypts with their private key automatically

**Getting your public key:**
```bash
ade account status
# Output includes: publicKey: 0x02abc123...
```

### Complete Seller Flow

```bash
# 1. Configure (one-time setup)
ade set SX_KEY                              # Private key (interactive)
ade set BEE_API http://localhost:1633       # Your Bee node
ade set BEE_STAMP abc123...                 # Your postage batch ID

# 2. Sell data via escrow
ade sell --file ./data.pdf --price 0.1 --yes
# Outputs: escrowId, swarmRef, encryptionKey, etc.

# 3. Share escrow ID with buyer
# Buyer purchases via: ade buy 42 --yes

# 4. Release key (after buyer funds)
ade escrows commit-key 42 --yes
# Wait 2 blocks + 60 seconds...

# Option A: With ECDH (recommended) - buyer shares their public key first
ade escrows reveal-key 42 --buyer-pubkey 0x02abc... --yes

# Option B: Without ECDH (raw key visible on-chain)
ade escrows reveal-key 42 --yes

# 5. Claim payment (after 24h dispute window)
ade escrows claim 42 --yes
```

### Escrow Status

Check escrow state and local key availability:

```bash
ade escrows status 42
```

**Example output:**
```json
{
  "escrowId": 42,
  "state": "Funded",
  "stateCode": 1,
  "hasLocalKeys": true,
  "hasSwarmRef": true,
  "onChain": {
    "seller": "0x...",
    "buyer": "0x...",
    "contentHash": "0x...",
    "amount": "0.1 ETH",
    "expiresAt": "2024-01-15T00:00:00.000Z"
  },
  "local": {
    "encryptionKey": "(set)",
    "salt": "(set)",
    "swarmRef": "abc123..."
  }
}
```

### Manual Escrow Commands

For more control, you can use individual escrow commands:

```bash
# Create escrow manually (requires pre-computed content hash)
ade escrows create --content-hash 0x... --price 0.1

# Fund an escrow (as buyer)
ade escrows fund <id>

# Check escrow status
ade escrows status <id>

# Commit key release (as seller, reads keys from keychain)
ade escrows commit-key <id>

# Reveal key after delay (as seller)
ade escrows reveal-key <id>

# Claim payment after dispute window (as seller)
ade escrows claim <id>
```

When you create an escrow, keys are automatically stored in keychain:
- `ESCROW_<id>_KEY` - The encryption key
- `ESCROW_<id>_SALT` - The salt for commitment
- `ESCROW_<id>_SWARM` - Swarm reference (for `ade create`)
- `ESCROW_<id>_CONTENT_HASH` - Content hash for verification

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
