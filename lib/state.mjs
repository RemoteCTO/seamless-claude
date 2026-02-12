import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { validateSessionId } from './config.mjs'

// Returns STATE_DIR, respecting SEAMLESS_STATE_DIR env var.
function getStateDir() {
  return (
    process.env.SEAMLESS_STATE_DIR ||
    join(homedir(), '.seamless-claude', 'state')
  )
}

export const STATE_DIR = getStateDir()

// Returns the default state object for a new session.
function defaultState(sessionId) {
  return {
    session_id: sessionId,
    compact_at: null,
    wrapup_at: null,
    wrapup_injected: false,
    error_notified: false,
    last_pct: 0,
  }
}

// Reads state for a session. Returns defaults if file missing.
export function readState(sessionId) {
  const safeId = validateSessionId(sessionId)
  const filePath = join(getStateDir(), `${safeId}.json`)

  try {
    const content = readFileSync(filePath, 'utf8')
    return JSON.parse(content)
  } catch (err) {
    if (err.code === 'ENOENT') {
      return defaultState(safeId)
    }
    throw err
  }
}

// Writes state for a session. Creates STATE_DIR if needed.
// Sets file permissions to 0o600 (owner read/write only).
export function writeState(sessionId, state) {
  const safeId = validateSessionId(sessionId)
  const stateDir = getStateDir()
  mkdirSync(stateDir, { recursive: true })

  const filePath = join(stateDir, `${safeId}.json`)
  const content = JSON.stringify(state, null, 2)

  writeFileSync(filePath, content, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

// Returns true if compaction should be triggered.
// Compacts when pct >= threshold AND compact_at is null.
export function shouldCompact(state, pct, threshold) {
  return pct >= threshold && state.compact_at === null
}

// Returns true if wrap-up should be triggered.
// Wraps up when pct >= threshold AND wrapup_at is null.
export function shouldWrapUp(state, pct, threshold) {
  return pct >= threshold && state.wrapup_at === null
}
