#!/usr/bin/env node
/**
 * Summarise any historical Claude Code session.
 *
 * Resolves a session ID (full or prefix) to its
 * transcript path, then runs the compactor.
 *
 * Usage:
 *   node summarise.mjs <id-or-prefix>
 *   node summarise.mjs <id-or-prefix> --force
 *   node summarise.mjs --list [prefix]
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SESSIONS_DIR } from '../lib/config.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const COMPACTOR = join(__dirname, 'compactor.mjs')
const PROJECTS_DIR = join(homedir(), '.claude', 'projects')

function findTranscripts(prefix) {
  const results = []
  let dirs
  try {
    dirs = readdirSync(PROJECTS_DIR)
  } catch {
    return results
  }
  for (const dir of dirs) {
    const dirPath = join(PROJECTS_DIR, dir)
    try {
      if (!statSync(dirPath).isDirectory()) {
        continue
      }
    } catch {
      continue
    }
    let files
    try {
      files = readdirSync(dirPath)
    } catch {
      continue
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const id = f.slice(0, -6)
      if (!id.startsWith(prefix)) continue
      const full = join(dirPath, f)
      try {
        const st = statSync(full)
        results.push({
          sessionId: id,
          path: full,
          project: dir,
          size: st.size,
          modified: st.mtime,
        })
      } catch {
        // File vanished between readdir and stat
      }
    }
  }
  results.sort((a, b) => b.modified - a.modified)
  return results
}

function hasSummary(id) {
  return existsSync(join(SESSIONS_DIR, `${id}.md`))
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1_048_576) {
    return `${(bytes / 1024).toFixed(0)}KB`
  }
  return `${(bytes / 1_048_576).toFixed(1)}MB`
}

function fmtProject(slug) {
  // -Users-ed-projects-active-foo → foo
  const parts = slug.replace(/^-/, '').split('-')
  // Skip Users-name-projects[-active]
  const skip = parts.indexOf('projects')
  if (skip >= 0 && skip < parts.length - 1) {
    const rest = parts.slice(skip + 1)
    if (rest[0] === 'active') rest.shift()
    return rest.join('-') || slug
  }
  return parts[parts.length - 1] || slug
}

function fmtDate(d) {
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

function listSessions(matches) {
  const out = process.stdout
  out.write(`Found ${matches.length} session(s):\n\n`)
  for (const m of matches) {
    const dt = fmtDate(m.modified)
    const sz = fmtSize(m.size).padStart(6)
    const pj = fmtProject(m.project)
    const tag = hasSummary(m.sessionId) ? ' [done]' : ''
    out.write(
      `  ${m.sessionId.slice(0, 8)}  ` + `${dt}  ${sz}  ${pj}${tag}\n`,
    )
  }
}

// --- CLI ---

const args = process.argv.slice(2)
const force = args.includes('--force')
const list = args.includes('--list')
const positional = args.filter((a) => !a.startsWith('--'))
const prefix = positional[0] || ''

if (list) {
  const matches = findTranscripts(prefix)
  if (matches.length === 0) {
    const msg = prefix
      ? `No sessions matching "${prefix}"`
      : 'No sessions found'
    process.stderr.write(`${msg}\n`)
    process.exit(1)
  }
  listSessions(matches)
  process.exit(0)
}

if (!prefix) {
  process.stderr.write(
    'Usage: claude-summarise ' +
      '<id-or-prefix> [--force]\n' +
      '       claude-summarise ' +
      '--list [prefix]\n',
  )
  process.exit(1)
}

const matches = findTranscripts(prefix)

if (matches.length === 0) {
  process.stderr.write(`No sessions matching "${prefix}"\n`)
  process.exit(1)
}

if (matches.length > 1) {
  process.stderr.write(
    `"${prefix}" matches ` + `${matches.length} sessions:\n\n`,
  )
  for (const m of matches) {
    const dt = fmtDate(m.modified)
    const pj = fmtProject(m.project)
    process.stderr.write(`  ${m.sessionId}  ${dt}  ${pj}\n`)
  }
  process.stderr.write('\nUse a longer prefix to narrow.\n')
  process.exit(1)
}

const match = matches[0]

if (hasSummary(match.sessionId) && !force) {
  const p = join(SESSIONS_DIR, `${match.sessionId}.md`)
  process.stderr.write(
    `Summary exists: ${p}\nUse --force to re-summarise.\n`,
  )
  process.exit(0)
}

const pj = fmtProject(match.project)
const sz = fmtSize(match.size)
process.stderr.write(
  `Summarising ${match.sessionId.slice(0, 8)}... (${pj}, ${sz})\n`,
)

try {
  execFileSync(
    process.execPath,
    [COMPACTOR, match.sessionId, match.path],
    { stdio: 'inherit', timeout: 600_000 },
  )
} catch (err) {
  const log = join(SESSIONS_DIR, `${match.sessionId}.log`)
  process.stderr.write(`Compaction failed. Log: ${log}\n`)
  process.exit(err.status ?? 1)
}

const mdPath = join(SESSIONS_DIR, `${match.sessionId}.md`)
process.stderr.write(`Done: ${mdPath}\n`)
