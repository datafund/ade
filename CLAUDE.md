# CLAUDE.md - Project Context for AI Assistants

## Project Overview

`ade` is a CLI tool for the Skill Exchange protocol on Base blockchain. It provides:
- Secure secret management via OS keychains
- DataEscrow smart contract interactions for selling/buying encrypted data
- Swarm decentralized storage integration
- API interactions for skills, bounties, and agents

## Architecture

```
src/
├── index.ts          # CLI entry point, argument parsing, command dispatch
├── commands.ts       # All command handlers (read, write, chain operations)
├── routing.ts        # Argument parser and command routing logic
├── help.ts           # Help text for all commands
├── api.ts            # API client with EIP-191 signing
├── secrets.ts        # Keychain abstraction interface
├── keychain.ts       # OS-native keychain implementation
├── escrow-keys.ts    # Escrow key storage helpers
├── swarm.ts          # Swarm upload/download via Bee API
├── addresses.ts      # Chain configs (Base, Base Sepolia)
├── errors.ts         # CLIError class for consistent error handling
├── format.ts         # JSON/human output formatting
├── schema.ts         # API schema definition
├── abi/              # Contract ABIs
│   └── DataEscrow.ts
├── crypto/           # Encryption utilities
│   ├── escrow.ts     # AES-256-GCM encrypt/decrypt for escrow
│   ├── fairdrop.ts   # ECDH key exchange for buyer-encrypted keys
│   └── keystore.ts   # Fairdrop account keystore encryption
└── utils/
    ├── events.ts     # Event parsing from transaction logs
    └── chain.ts      # Shared chain transaction helpers
```

## Key Patterns

### Command Structure
Commands are defined in `src/commands.ts` and return data objects. Formatting is handled by the caller in `index.ts` via `output()`.

```typescript
// Pattern: Commands return data, don't print directly
export async function someCommand(opts: Options, keychain: Keychain = defaultKeychain): Promise<Result> {
  // ... implementation
  return { field: value }
}
```

### Chain Transaction Helper
Use `executeContractTx()` from `src/utils/chain.ts` for all contract writes:

```typescript
const { hash, receipt } = await executeContractTx({
  wallet, pub,
  address: chainConfig.contracts.dataEscrow,
  functionName: 'functionName',
  args: [arg1, arg2],
  chainConfig,
  description: 'Human readable description',
})
```

### Gas Estimation
Use `estimateAndValidateGas()` which includes safety cap validation:

```typescript
const { gasCost } = await estimateAndValidateGas({
  pub,
  address: chainConfig.contracts.dataEscrow,
  functionName: 'functionName',
  args: [arg1, arg2],
  account: address,
  value: amount, // optional
})
```

### Error Handling
Always use `CLIError` for user-facing errors:

```typescript
throw new CLIError(
  'ERR_CODE',           // Error code (ERR_MISSING_KEY, ERR_NOT_FOUND, etc.)
  'Main error message', // What went wrong
  'Recovery hint'       // How to fix it (optional)
)
```

### Keychain Access
Commands accept an optional `keychain` parameter for testability:

```typescript
export async function myCommand(opts: Opts, keychain: Keychain = defaultKeychain) {
  const key = await keychain.get('SX_KEY')
  // ...
}
```

### Confirmation Flow
Chain operations require `--yes` flag in non-TTY mode:

```typescript
requireConfirmation(opts)  // Throws if !opts.yes && !TTY
await confirmAction('Confirm transaction?', opts)  // Interactive prompt
```

## Testing

```bash
bun test                           # Run all tests
bun test tests/sell.test.ts        # Run specific test file
bun test --watch                   # Watch mode
```

### Test Patterns

1. **Mock keychain** - Use `tests/keychain/mock.ts` for isolated tests
2. **Mock fetch** - Override `globalThis.fetch` for API/RPC mocking
3. **Restore in afterEach** - Always restore globals after tests

```typescript
import * as mockKeychain from "./keychain/mock";

beforeEach(() => {
  mockKeychain.clear();
  mockFetch = mock(() => Promise.resolve(new Response("{}")));
  globalThis.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.SX_KEY;
});
```

### Chain View Tests
Tests in `tests/chain-view.test.ts` hit real RPCs and may fail due to rate limits. These test read-only chain operations.

## Common Workflows

### Adding a New Command

1. Add handler in `src/commands.ts`
2. Add to routing in `src/routing.ts` (META_COMMANDS or resource actions)
3. Add dispatch in `src/index.ts` (handleMeta or handleResource)
4. Add help text in `src/help.ts`
5. Add tests in `tests/`
6. Update README.md

### Adding a New Chain

1. Add config in `src/addresses.ts` (CHAIN_BY_ID)
2. Add viem chain in `src/commands.ts` (VIEM_CHAINS)

## Important Constants

- `MAX_FILE_SIZE`: 50MB - File size limit for `ade sell`
- `GAS_SAFETY_CAP`: 0.01 ETH - Maximum gas cost before warning
- `CHAIN_TIMEOUT_MS`: 60 seconds - Transaction confirmation timeout
- `DEFAULT_KEY_WAIT_TIMEOUT`: 86400 seconds (24h) - Key reveal polling timeout
- `DEFAULT_EXPIRY_DAYS`: 7 days - Escrow expiration

## Secrets

| Key | Purpose |
|-----|---------|
| `SX_KEY` | Ethereum private key for signing |
| `SX_RPC` | RPC URL (default: mainnet.base.org) |
| `BEE_API` | Bee node URL (default: FDS gateway) |
| `BEE_STAMP` | Postage batch ID (auto-created if using own node) |
| `ESCROW_<id>_KEY` | Encryption key for escrow |
| `ESCROW_<id>_SALT` | Salt for key commitment |
| `ESCROW_<id>_SWARM` | Swarm reference |
| `ESCROW_<id>_CONTENT_HASH` | Content hash for verification |
| `FAIRDROP_ACCOUNTS` | JSON array of account subdomains |
| `FAIRDROP_KEYSTORE_<sub>` | Encrypted keystore for account |
| `FAIRDROP_ACTIVE` | Currently active account subdomain |

### Setting Secrets

Three methods for setting secrets (agent-friendly):

```bash
# Method 1: Value as argument (best for automation)
ade set SX_RPC https://sepolia.base.org
ade set BEE_API http://localhost:1633   # Optional - uses FDS gateway by default

# Method 2: Pipe from stdin
echo "https://mainnet.base.org" | ade set SX_RPC

# Method 3: Interactive prompt (for sensitive values)
ade set SX_KEY
# Enter secret: <hidden input>
```

**Note:** `BEE_API` is optional. Both sell and buy commands use the FDS public gateway
(`https://gateway.fairdatasociety.org`) by default. No postage stamp required!

### Changing Networks

The chain is auto-detected from the RPC URL's chainId response:

```bash
# Use Base Mainnet (default)
ade set SX_RPC https://mainnet.base.org

# Use Base Sepolia testnet
ade set SX_RPC https://sepolia.base.org
```

Contracts are automatically selected based on chain (see `src/addresses.ts`).

## Main User Flows

### Seller Flow
```bash
ade sell --file ./data.csv --price 0.1 --yes  # Encrypt, upload, create escrow
ade escrows commit-key 42 --yes                # After buyer funds
ade escrows reveal-key 42 --yes                # Reveal key to buyer (ECDH-encrypted if buyer has account)
ade escrows claim 42 --yes                     # Claim payment after 24h
```

### Buyer Flow
```bash
ade account create buyer              # Create Fairdrop account (one-time)
ade account unlock buyer              # Unlock for session
ade buy 42 --output ./data.csv --yes  # Fund, wait for key, download, decrypt
```

### Bounty Response
```bash
ade respond <bounty-id> --file ./solution.zip --yes  # Create escrow for bounty
```

### Account Management
```bash
ade account create <subdomain>  # Create keypair, encrypted with password
ade account unlock <subdomain>  # Decrypt and load into session
ade account lock                # Clear session
ade account status              # Show active account
ade account list                # List all accounts
ade account export <subdomain>  # Export keystore backup
ade account delete <subdomain>  # Delete account
```

## Code Style

- TypeScript strict mode
- No semicolons (handled by formatter)
- Use `console.error()` for progress output (stdout is for data)
- Prefer `const` over `let`
- Use explicit return types on exported functions
- Avoid over-engineering - keep solutions minimal

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
