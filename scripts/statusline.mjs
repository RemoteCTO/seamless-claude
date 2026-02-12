#!/usr/bin/env node
/**
 * Statusline monitor.
 *
 * Receives session JSON on stdin from Claude Code
 * after every response. Monitors context usage,
 * triggers background compaction and wrapup, then
 * produces the statusline display.
 *
 * Display is either a built-in bar or delegated to
 * a user command via SEAMLESS_DISPLAY_CMD.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  COMPACT_PCT,
  DATA_DIR,
  STATUS_PATH,
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
const DISPLAY_CMD = process.env.SEAMLESS_DISPLAY_CMD

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function resolveStatus(state, pct, paths) {
  if (pct >= WRAPUP_PCT) return 'wrapup'
  if (state.compact_at && existsSync(paths.md)) {
    return 'ready'
  }
  if (state.compact_at) return 'compacting'
  return 'idle'
}

function buildBar(pct) {
  const filled = Math.round((pct / 100) * 20)
  return '█'.repeat(filled) + '░'.repeat(20 - filled)
}

const STATUS_ICONS = {
  idle: '',
  compacting: '🔄',
  ready: '✅',
  wrapup: '⚠️',
}

function writeStatus(data) {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(STATUS_PATH, JSON.stringify(data), {
    mode: 0o600,
  })
}

function runDisplayCmd(rawStdin, env) {
  const result = spawnSync('sh', ['-c', DISPLAY_CMD], {
    input: rawStdin,
    env: { ...process.env, ...env },
    timeout: 5000,
    maxBuffer: 10 * 1024,
  })
  if (result.status === 0 && result.stdout?.length) {
    process.stdout.write(result.stdout)
    return true
  }
  return false
}

function fallbackLine(pct, status, shortId) {
  const bar = buildBar(pct)
  const icon = STATUS_ICONS[status] || ''
  const parts = [`seamless: ${pct.toFixed(0)}% ${bar}`]
  if (icon) parts.push(icon)
  if (status !== 'idle') parts.push(shortId)
  console.log(parts.join(' '))
}

const FALLBACK = 'seamless: --% ░░░░░░░░░░░░░░░░░░░░'

async function main() {
  let rawStdin
  let input
  try {
    rawStdin = await readStdin()
    input = JSON.parse(rawStdin)
  } catch {
    console.log(FALLBACK)
    return
  }

  const sessionId = input.session_id
  const cwd = input.cwd
  const transcript = input.transcript_path
  const pct = input.context_window?.used_percentage

  if (!sessionId || pct == null) {
    console.log(FALLBACK)
    return
  }

  let validatedId
  try {
    validatedId = validateSessionId(sessionId)
  } catch {
    console.log(FALLBACK)
    return
  }

  const state = readState(validatedId)
  const paths = sessionPaths(validatedId)

  // --- Monitoring ---

  if (shouldCompact(state, pct, COMPACT_PCT)) {
    if (transcript) {
      if (!existsSync(paths.lock) || isLockStale(paths.lock)) {
        if (acquireLock(paths.lock)) {
          state.compact_at = new Date().toISOString()
          writeState(validatedId, state)
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

  if (shouldWrapUp(state, pct, WRAPUP_PCT)) {
    state.wrapup_at = new Date().toISOString()
    writeState(validatedId, state)
    if (cwd) {
      try {
        createIntent(cwd, validatedId)
      } catch {
        // Intent creation failed — not fatal
      }
    }
  }

  state.last_pct = pct
  writeState(validatedId, state)

  // --- Status ---

  const status = resolveStatus(state, pct, paths)
  const summaryPath = existsSync(paths.md) ? paths.md : ''

  writeStatus({
    pct,
    status,
    session_id: validatedId,
    session_short: validatedId.slice(0, 8),
    summary_path: summaryPath,
    updated_at: new Date().toISOString(),
  })

  // --- Display ---

  if (DISPLAY_CMD) {
    const ok = runDisplayCmd(rawStdin, {
      SEAMLESS_PCT: String(pct),
      SEAMLESS_STATUS: status,
      SEAMLESS_SESSION_ID: validatedId,
      SEAMLESS_SESSION_SHORT: validatedId.slice(0, 8),
      SEAMLESS_SUMMARY_PATH: summaryPath,
    })
    if (ok) return
  }

  fallbackLine(pct, status, validatedId.slice(0, 8))
}

main().catch(() => {
  console.log(FALLBACK)
  process.exit(0)
})
