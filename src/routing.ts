/**
 * CLI argument parsing and routing.
 */

export type ParsedCommand =
  | { type: 'secrets'; command: string; args: string[]; flags: Record<string, string | boolean> }
  | { type: 'resource'; resource: string; action: string; args: string[]; flags: Record<string, string | boolean> }
  | { type: 'meta'; command: string; args: string[]; flags: Record<string, string | boolean> }
  | { type: 'help'; topic?: string; subtopic?: string }
  | { type: 'unknown'; command: string }

const SECRETS_COMMANDS = ['set', 'get', 'rm', 'ls']
const RESOURCES = ['skills', 'bounties', 'agents', 'escrows', 'wallets', 'config']
const META_COMMANDS = ['stats', 'schema', 'version', 'update', 'dashboard']

export function parseArgs(argv: string[]): ParsedCommand {
  if (argv.length === 0) {
    return { type: 'help', topic: undefined, subtopic: undefined }
  }

  const [first, ...rest] = argv

  // Check for --help or -h anywhere in args
  const helpIndex = argv.findIndex(a => a === '--help' || a === '-h')
  if (helpIndex !== -1) {
    // ade --help or ade -h
    if (helpIndex === 0) {
      return { type: 'help', topic: undefined, subtopic: undefined }
    }
    // ade <resource> --help
    if (helpIndex === 1 && RESOURCES.includes(first)) {
      return { type: 'help', topic: first, subtopic: undefined }
    }
    // ade <resource> <action> --help
    if (helpIndex === 2 && RESOURCES.includes(first)) {
      return { type: 'help', topic: first, subtopic: rest[0] }
    }
    // Any other position, treat as help for the first arg
    return { type: 'help', topic: first, subtopic: undefined }
  }

  // Version shortcuts
  if (first === '--version' || first === '-v') {
    return { type: 'meta', command: 'version', args: [], flags: {} }
  }

  // Help command
  if (first === 'help') {
    return { type: 'help', topic: rest[0], subtopic: rest[1] }
  }

  // Secrets commands
  if (SECRETS_COMMANDS.includes(first)) {
    const { args, flags } = parseRest(rest)
    return { type: 'secrets', command: first, args, flags }
  }

  // Meta commands (single word, no subcommand)
  if (META_COMMANDS.includes(first)) {
    const { args, flags } = parseRest(rest)
    return { type: 'meta', command: first, args, flags }
  }

  // Resource commands
  if (RESOURCES.includes(first)) {
    const action = rest[0] || 'list'
    const { args, flags } = parseRest(rest.slice(1))
    return { type: 'resource', resource: first, action, args, flags }
  }

  // Unknown command
  return { type: 'unknown', command: first }
}

interface ParsedRest {
  args: string[]
  flags: Record<string, string | boolean>
}

function parseRest(argv: string[]): ParsedRest {
  const args: string[] = []
  const flags: Record<string, string | boolean> = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (arg.startsWith('--')) {
      // Handle --flag=value syntax
      if (arg.includes('=')) {
        const [key, value] = arg.slice(2).split('=')
        flags[key] = value
      } else {
        const key = arg.slice(2)
        const next = argv[i + 1]
        // Check if next arg is a value (not starting with -)
        if (next && !next.startsWith('-')) {
          flags[key] = next
          i++
        } else {
          // Boolean flag
          flags[key] = true
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      // Short flags like -h, -v (already handled above for help)
      const key = arg.slice(1)
      flags[key] = true
    } else {
      // Positional argument
      args.push(arg)
    }
  }

  return { args, flags }
}
