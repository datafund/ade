/**
 * Scan local files and match against marketplace bounties.
 * Simple term-overlap scoring — AI agents provide the intelligence.
 */

import { respond } from './commands'
import type { RespondOpts } from './commands'
import { apiFetch } from './api'
import { CLIError } from './errors'
import type { Keychain } from './secrets'
import * as defaultKeychain from './keychain'
import { readdirSync, lstatSync } from 'fs'
import { join, basename, extname, relative } from 'path'
import { realpathSync } from 'fs'

// ── Types ──

interface Bounty {
  id: string
  title: string
  description?: string
  rewardAmount: string
  tags?: string[]
  category?: string
  status: string
  creator: string
}

export interface ScanBountiesOpts {
  dir: string
  respond?: boolean
  dryRun?: boolean
  yes?: boolean
  minScore?: number
  maxResponses?: number
  maxValue?: string
  exclude?: string
}

export interface ScanBountiesResult {
  matches: Array<{
    bountyId: string
    bountyTitle: string
    bountyReward: string
    file: string
    score: number
    matchedTerms: string[]
  }>
  total: number
  scanned: number
  excluded: number
  minScore: number
  dryRun?: true
  responses?: Array<{
    bountyId: string
    file: string
    escrowId?: number
    txHash?: string
    error?: string
    status: 'ok' | 'failed' | 'would_respond'
  }>
  responded?: number
  respondFailed?: number
}

// ── Helpers ──

function sanitizeApiString(s: string): string {
  return s.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 500)
}

function matchGlob(name: string, pattern: string): boolean {
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
  return re.test(name)
}

function computeScore(file: string, bounty: { title: string; description: string; tags: string[]; category: string }): { score: number; matchedTerms: string[] } {
  const fileTerms = new Set(
    basename(file, extname(file))
      .toLowerCase()
      .split(/[-_.\s]+/)
      .filter(t => t.length > 2)
  )
  const ext = extname(file).slice(1).toLowerCase()
  if (ext) fileTerms.add(ext)

  const bountyText = [bounty.title, bounty.description, bounty.category, ...bounty.tags].join(' ')
  const bountyTerms = bountyText
    .toLowerCase()
    .split(/[\s,;:.()\[\]{}]+/)
    .filter(t => t.length > 2)
  const uniqueBountyTerms = [...new Set(bountyTerms)]

  const matched = uniqueBountyTerms.filter(t => fileTerms.has(t))
  const score = uniqueBountyTerms.length > 0 ? matched.length / uniqueBountyTerms.length : 0

  return { score: Math.round(score * 100) / 100, matchedTerms: matched }
}

async function fetchAllBounties(): Promise<Bounty[]> {
  const bounties: Bounty[] = []
  let offset = 0
  const limit = 50
  while (true) {
    try {
      const result = await apiFetch<{ bounties: Bounty[] }>(`/bounties?status=open&limit=${limit}&offset=${offset}`)
      const page = result.bounties ?? []
      bounties.push(...page)
      if (page.length < limit || bounties.length >= 500) {
        if (bounties.length >= 500) {
          console.error('Warning: Bounty results capped at 500. Use --min-score to filter.')
        }
        break
      }
      offset += limit
    } catch { break }
  }
  return bounties
}

// ── Main ──

export async function scanBounties(
  opts: ScanBountiesOpts,
  keychain: Keychain = defaultKeychain
): Promise<ScanBountiesResult> {
  if (opts.respond && opts.yes && !opts.maxValue) {
    throw new CLIError('ERR_INVALID_ARGUMENT',
      '--max-value is required when using --respond --yes',
      'Set maximum value per response: ade scan-bounties --respond --yes --max-value 0.05')
  }
  const minScore = opts.respond && opts.yes
    ? Math.max(opts.minScore ?? 0, 0.5)
    : (opts.minScore ?? 0)
  const maxResponses = Math.min(opts.maxResponses ?? 3, 10)

  // Discover local files
  const dir = realpathSync(opts.dir)
  const defaultExcludes = ['*.env', '*.pem', '*.key', '*.p12', '*.pfx', '.ssh/*', '.gnupg/*', '.config/*', 'id_rsa*', '*.sqlite', '*.db', '*.log', 'node_modules/*']
  const userExcludes = opts.exclude?.split(',').map(s => s.trim()).filter(p => {
    if (/[{(|]/.test(p)) {
      console.error(`Warning: Ignoring exclude pattern with unsupported syntax: ${p}`)
      return false
    }
    return p.length > 0
  }) ?? []
  const allExcludes = [...defaultExcludes, ...userExcludes]

  const files: string[] = []
  let excluded = 0
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) continue
    if (entry.name.startsWith('.')) { excluded++; continue }
    const fstat = lstatSync(join(dir, entry.name))
    if (fstat.isSymbolicLink()) { excluded++; continue }
    const realPath = realpathSync(join(dir, entry.name))
    if (!realPath.startsWith(dir)) { excluded++; continue }
    if (allExcludes.some(pat => matchGlob(entry.name, pat))) { excluded++; continue }
    files.push(realPath)
  }

  // Fetch bounties
  const bounties = await fetchAllBounties()

  // Score matches
  const matches: ScanBountiesResult['matches'] = []
  for (const file of files) {
    for (const bounty of bounties) {
      const { score, matchedTerms } = computeScore(file, {
        title: sanitizeApiString(bounty.title),
        description: sanitizeApiString(bounty.description || ''),
        tags: bounty.tags || [],
        category: bounty.category || '',
      })
      if (score >= minScore) {
        matches.push({
          bountyId: bounty.id,
          bountyTitle: sanitizeApiString(bounty.title),
          bountyReward: bounty.rewardAmount,
          file: relative(dir, file),
          score,
          matchedTerms,
        })
      }
    }
  }
  matches.sort((a, b) => b.score - a.score)

  const result: ScanBountiesResult = {
    matches,
    total: matches.length,
    scanned: files.length,
    excluded,
    minScore,
  }

  // Respond to matches
  if (opts.respond) {
    const responses: NonNullable<ScanBountiesResult['responses']> = []
    const topMatches = matches.slice(0, maxResponses)

    for (const match of topMatches) {
      if (opts.dryRun) {
        responses.push({ bountyId: match.bountyId, file: match.file, status: 'would_respond' })
        continue
      }
      try {
        const absoluteFile = join(dir, match.file.replace(/^\.\//, ''))
        const respondResult = await respond({
          bountyId: match.bountyId,
          file: absoluteFile,
          yes: opts.yes,
        }, keychain)
        responses.push({
          bountyId: match.bountyId,
          file: match.file,
          escrowId: respondResult.escrowId,
          txHash: respondResult.txHash,
          status: 'ok',
        })
      } catch (err) {
        responses.push({
          bountyId: match.bountyId,
          file: match.file,
          error: (err as Error).message,
          status: 'failed',
        })
      }
    }

    result.responses = responses
    if (opts.dryRun) { result.dryRun = true }
    else {
      result.responded = responses.filter(r => r.status === 'ok').length
      result.respondFailed = responses.filter(r => r.status === 'failed').length
    }
  }

  return result
}
