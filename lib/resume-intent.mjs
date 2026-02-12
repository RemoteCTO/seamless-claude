import {
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { validateSessionId } from './config.mjs'

const MAX_AGE_MS = 3_600_000 // 1 hour

export const INTENT_PATH = join(
  homedir(),
  '.seamless-claude',
  'resume-intent.json',
)

/**
 * Create a resume intent for a project
 * @param {string} projectDir - The project directory
 * @param {string} sessionId - The session ID
 * @param {object} opts - Options
 * @param {string} opts.intentPath - Override intent path
 */
export function createIntent(projectDir, sessionId, opts = {}) {
  validateSessionId(sessionId)

  const intentPath = opts.intentPath || INTENT_PATH
  const intent = {
    project_dir: projectDir,
    session_id: sessionId,
    created_at: new Date().toISOString(),
  }

  const dir = join(intentPath, '..')
  mkdirSync(dir, { recursive: true })

  writeFileSync(intentPath, JSON.stringify(intent), { mode: 0o600 })
}

/**
 * Read the resume intent for a project
 * @param {string} projectDir - The project directory
 * @param {object} opts - Options
 * @param {string} opts.intentPath - Override intent path
 * @returns {object|null} The intent or null
 */
export function readIntent(projectDir, opts = {}) {
  const intentPath = opts.intentPath || INTENT_PATH

  try {
    const content = readFileSync(intentPath, 'utf8')
    const intent = JSON.parse(content)

    // Check project dir matches
    if (intent.project_dir !== projectDir) {
      return null
    }

    // Check age
    const createdAt = new Date(intent.created_at).getTime()
    const now = Date.now()
    if (now - createdAt > MAX_AGE_MS) {
      return null
    }

    return intent
  } catch (err) {
    return null
  }
}

/**
 * Clear the resume intent
 * @param {object} opts - Options
 * @param {string} opts.intentPath - Override intent path
 */
export function clearIntent(opts = {}) {
  const intentPath = opts.intentPath || INTENT_PATH

  try {
    unlinkSync(intentPath)
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err
    }
  }
}
