#!/usr/bin/env node
/**
 * UserPromptSubmit hook — wrap-up injector.
 *
 * Fires before every user prompt. If the statusline
 * has flagged context as critically full (wrapup_at
 * set in state), injects a one-time wrap-up instruction
 * into Claude's context via stdout.
 */

import { validateSessionId } from '../lib/config.mjs'
import { readState, writeState } from '../lib/state.mjs'

// Reads all stdin into a string. Returns Promise<string>.
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
    return // Invalid JSON → exit silently
  }

  const { session_id: sessionId } = payload
  if (!sessionId) {
    return // Missing session_id → exit silently
  }

  let safeId
  try {
    safeId = validateSessionId(sessionId)
  } catch {
    return // Invalid session_id → exit silently
  }

  const state = readState(safeId)

  // Only inject if wrapup_at is set AND not already injected
  if (state.wrapup_at && !state.wrapup_injected) {
    process.stdout.write(`[seamless-claude] Context window is critically full.

A session summary has been prepared in the background.
Please complete your current task, then tell the user
to start a fresh session. Their context will be
automatically restored.

Do not start new tasks.
`)

    // Mark as injected to prevent repetition
    state.wrapup_injected = true
    writeState(safeId, state)
  }
}

main().catch(() => process.exit(0))
