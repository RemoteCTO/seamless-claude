#!/usr/bin/env node
/**
 * UserPromptSubmit hook — injector.
 *
 * Fires before every user prompt. Injects one-time
 * messages into Claude's context:
 * - Wrap-up instruction when context critically full
 * - Error notification when compaction failed
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DATA_DIR,
  sessionPaths,
  validateSessionId,
} from '../lib/config.mjs'
import { isLockStale } from '../lib/lockfile.mjs'
import { readState, writeState } from '../lib/state.mjs'
import { lastLogLine } from '../lib/statusline.mjs'

const UPS_LOG = join(DATA_DIR, 'ups-errors.log')

function logError(msg) {
  try {
    const ts = new Date().toISOString().slice(0, 19)
    appendFileSync(UPS_LOG, `[${ts}] ${msg}\n`)
  } catch {
    // Logging itself failed — nothing we can do
  }
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  const input = await readStdin()

  let payload
  try {
    payload = JSON.parse(input)
  } catch {
    return
  }

  const { session_id: sessionId } = payload
  if (!sessionId) return

  let safeId
  try {
    safeId = validateSessionId(sessionId)
  } catch {
    return
  }

  const state = readState(safeId)
  const paths = sessionPaths(safeId)

  // Error notification (compactor died)
  if (
    state.compact_at &&
    !state.error_notified &&
    !existsSync(paths.md) &&
    (!existsSync(paths.lock) || isLockStale(paths.lock))
  ) {
    let detail = 'No log available.'
    if (existsSync(paths.log)) {
      try {
        const log = readFileSync(paths.log, 'utf8')
        detail = lastLogLine(log) || detail
      } catch {
        // Log read failed — use default
      }
    }

    process.stdout.write(
      `[seamless-claude] Background compaction failed.\n\nLast log entry: ${detail}\nFull log: ${paths.log}\n`,
    )

    state.error_notified = true
    writeState(safeId, state)
    return
  }

  // Wrap-up injection (context critically full)
  if (state.wrapup_at && !state.wrapup_injected) {
    process.stdout.write(
      '[seamless-claude] Context window is ' +
        'critically full.\n\n' +
        'A session summary has been prepared in ' +
        'the background.\n' +
        'Please complete your current task, then ' +
        'tell the user\n' +
        'to start a fresh session. Their context ' +
        'will be\n' +
        'automatically restored.\n\n' +
        'Do not start new tasks.\n',
    )

    state.wrapup_injected = true
    writeState(safeId, state)
  }
}

main().catch((err) => {
  logError(err.message || String(err))
  process.exit(0)
})
