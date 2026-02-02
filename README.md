# ade

A minimal CLI for securely storing secrets using OS-native keychains.

## Installation

Download the latest binary for your platform from [Releases](https://github.com/datafund/ade/releases).

```bash
# macOS/Linux
chmod +x ade
mv ade /usr/local/bin/
```

## Usage

```bash
ade set <key>     # Store a secret (prompts for value)
ade get <key>     # Retrieve a secret
ade rm <key>      # Remove a secret
ade ls            # List all secret keys
ade update        # Self-update from GitHub
ade version       # Show version
```

## How it works

Secrets are stored in your OS keychain:
- **macOS**: Keychain via `security` CLI
- **Linux**: libsecret via `secret-tool`
- **Windows**: Credential Manager via `cmdkey`

## Development

Requires [Bun](https://bun.sh).

```bash
bun install
bun run src/index.ts set my-key
bun run build  # Creates standalone binary
```
