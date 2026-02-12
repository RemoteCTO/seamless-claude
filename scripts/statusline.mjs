#!/usr/bin/env node
/**
 * Statusline hook handler.
 *
 * Receives session JSON on stdin from Claude Code after
 * every response. Outputs a display line showing context
 * usage, and triggers compaction/wrapup when thresholds
 * are crossed.
 *
 * Sync hook — must output display line and exit quickly.
 */

import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  COMPACT_PCT,
  WRAPUP_PCT,
  sessionPaths,
  validateSessionId,
} from '../lib/config.mjs'
import { acquireLock, isLockStale } from '../lib/lockfile.mjs'
import { createIntent } from '../lib/resume-intent.mjs'
import {
  readState,
  shouldCompact,
  shouldWrapUp,
  writeState,
} from '../lib/state.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

// Find transcript by globbing ~/.claude/projects/*/{sessionId}.jsonl
function findTranscript(sessionId) {
  const projectsDir = join(homedir(), '.claude', 'projects')
  if (!existsSync(projectsDir)) return null

  try {
    const hashes = readdirSync(projectsDir)
    for (const hash of hashes) {
      const candidate = join(projectsDir, hash, `${sessionId}.jsonl`)
      if (existsSync(candidate)) return candidate
    }
  } catch {
    return null
  }

  return null
}

// Build 20-char bar: █ for used, ░ for free
function buildBar(pct) {
  const filled = Math.round((pct / 100) * 20)
  const empty = 20 - filled
  return '█'.repeat(filled) + '░'.repeat(empty)
}

// Return status icon based on state
function statusIcon(state, pct, paths) {
  if (pct >= WRAPUP_PCT) return '⚠️'
  if (state.compact_at && existsSync(paths.md)) return '✅'
  if (state.compact_at) return '🔄'
  return ''
}

async function main() {
  let input
  try {
    const raw = await readStdin()
    input = JSON.parse(raw)
  } catch {
    console.log('seamless: --% ░░░░░░░░░░░░░░░░░░░░')
    return
  }

  const sessionId = input.session_id
  const cwd = input.cwd
  const pct = input.context_window?.used_percentage

  if (!sessionId || pct === undefined) {
    console.log('seamless: --% ░░░░░░░░░░░░░░░░░░░░')
    return
  }

  let validatedId
  try {
    validatedId = validateSessionId(sessionId)
  } catch {
    console.log('seamless: --% ░░░░░░░░░░░░░░░░░░░░')
    return
  }

  const state = readState(validatedId)
  const paths = sessionPaths(validatedId)

  // Trigger compaction if threshold crossed
  if (shouldCompact(state, pct, COMPACT_PCT)) {
    const transcript = findTranscript(validatedId)
    if (transcript) {
      // Check for stale lock
      if (!existsSync(paths.lock) || isLockStale(paths.lock)) {
        // Acquire lock
        if (acquireLock(paths.lock)) {
          state.compact_at = new Date().toISOString()
          writeState(validatedId, state)

          // Spawn compactor detached
          const compactor = join(__dirname, 'compactor.mjs')
          const child = spawn(
            'node',
            [compactor, validatedId, transcript],
            {
              detached: true,
              stdio: 'ignore',
              env: process.env,
            },
          )
          child.unref()
        }
      }
    }
  }

  // Trigger wrapup if threshold crossed
  if (shouldWrapUp(state, pct, WRAPUP_PCT)) {
    state.wrapup_at = new Date().toISOString()
    writeState(validatedId, state)

    if (cwd) {
      try {
        createIntent(cwd, validatedId)
      } catch (err) {
        console.error(`Failed to create resume intent: ${err.message}`)
      }
    }
  }

  // Update last_pct
  state.last_pct = pct
  writeState(validatedId, state)

  // Output display line
  const bar = buildBar(pct)
  const icon = statusIcon(state, pct, paths)
  const iconStr = icon ? ` ${icon}` : ''
  console.log(`seamless: ${pct.toFixed(0)}% ${bar}${iconStr}`)
}

main().catch(() => {
  console.log('seamless: --% ░░░░░░░░░░░░░░░░░░░░')
  process.exit(0)
})
