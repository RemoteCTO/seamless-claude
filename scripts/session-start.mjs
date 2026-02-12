#!/usr/bin/env node
/**
 * SessionStart hook handler.
 *
 * Handles two matchers:
 * - startup: auto-resume from previous session
 *   via resume-intent (cross-session)
 * - compact: restore context after in-session
 *   compaction (existing behaviour)
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import {
  MAX_OUTPUT,
  sessionPaths,
  validateSessionId,
} from '../lib/config.mjs'
import { clearIntent, readIntent } from '../lib/resume-intent.mjs'

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Handle startup matcher (cross-session resume)
 * @param {object} input - Hook input
 * @returns {Promise<string|null>} Output or null
 */
async function handleStartup(input) {
  if (!input.cwd) return null

  const intent = readIntent(input.cwd)
  if (!intent) return null

  // Validate previous session ID
  let validatedId
  try {
    validatedId = validateSessionId(intent.session_id)
  } catch {
    clearIntent()
    return null
  }

  const paths = sessionPaths(validatedId)
  if (!existsSync(paths.md)) {
    clearIntent()
    return null
  }

  const summary = await readFile(paths.md, 'utf8')

  clearIntent()

  return [
    '# Session Resume (restored by seamless-claude)',
    '',
    'The following is a structured summary of your',
    'previous session. This was prepared automatically',
    'in the background. Pick up where you left off.',
    '',
    summary,
  ].join('\n')
}

/**
 * Handle compact matcher (in-session resume)
 * @param {object} input - Hook input
 * @returns {Promise<string|null>} Output or null
 */
async function handleCompact(input) {
  const sessionId = input.session_id
  if (!sessionId) return null

  let validatedId
  try {
    validatedId = validateSessionId(sessionId)
  } catch {
    return null
  }

  const paths = sessionPaths(validatedId)
  if (!existsSync(paths.md)) return null

  const summary = await readFile(paths.md, 'utf8')

  return [
    '# Session Context (restored by seamless-claude)',
    '',
    'The following is a structured summary of your',
    'session before compaction. Treat this as your',
    'working memory — pick up where you left off.',
    '',
    summary,
  ].join('\n')
}

async function main() {
  let input
  try {
    input = JSON.parse(await readStdin())
  } catch {
    process.exit(0)
  }

  // Try startup path first, fall back to compact
  let output = await handleStartup(input)
  if (!output) {
    output = await handleCompact(input)
  }

  if (!output) process.exit(0)

  if (output.length > MAX_OUTPUT) {
    output = output.slice(0, MAX_OUTPUT)
    process.stderr.write(
      `seamless-claude: output truncated to ${MAX_OUTPUT} chars\n`,
    )
  }

  process.stdout.write(output)
}

main().catch(() => process.exit(0))
