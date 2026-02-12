import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

export const SESSIONS_DIR = join(
  homedir(),
  '.seamless-claude',
  'sessions',
)
export const HOOKS_DIR = join(homedir(), '.seamless-claude', 'hooks.d')
export const TOOL_RESULT_MAX = 300
export const MAX_OUTPUT = 200_000
export const MIN_RESULT_LENGTH = 500
export const EXPECTED_SECTIONS = [
  'Session Summary',
  'Technical Context',
  'Knowledge Extractions',
  'Next Steps',
  'Active Context',
]

// Validate session ID is a UUID. Throws on invalid.
// Returns the validated ID string.
// Security: prevents path traversal via crafted IDs.
export function validateSessionId(id) {
  if (!id || typeof id !== 'string') {
    throw new Error('Session ID is required')
  }
  const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
  if (!uuid.test(id)) {
    throw new Error(`Invalid session ID format: ${id.slice(0, 20)}`)
  }
  // Belt and braces: strip any path components
  const safe = basename(id)
  if (safe !== id) {
    throw new Error('Session ID contains path separators')
  }
  return safe
}

// Returns paths for a session's output files.
// Creates the sessions directory if needed.
export function sessionPaths(sessionId) {
  mkdirSync(SESSIONS_DIR, { recursive: true })
  return {
    md: join(SESSIONS_DIR, `${sessionId}.md`),
    json: join(SESSIONS_DIR, `${sessionId}.json`),
    log: join(SESSIONS_DIR, `${sessionId}.log`),
    lock: join(SESSIONS_DIR, `${sessionId}.lock`),
  }
}
