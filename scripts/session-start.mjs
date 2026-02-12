#!/usr/bin/env node
/**
 * SessionStart hook handler (matcher: compact).
 *
 * Fires when a session restarts after compaction.
 * If a precompact summary exists for this session,
 * outputs it to stdout so Claude Code injects it
 * into the fresh context window.
 *
 * This is the automatic resume path — no user
 * action required.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import {
  MAX_OUTPUT,
  sessionPaths,
  validateSessionId,
} from '../lib/config.mjs'

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  let input
  try {
    input = JSON.parse(await readStdin())
  } catch {
    process.exit(0)
  }

  const sessionId = input.session_id
  if (!sessionId) process.exit(0)

  // Validate session ID, but don't crash on invalid
  let validatedId
  try {
    validatedId = validateSessionId(sessionId)
  } catch {
    process.exit(0)
  }

  const paths = sessionPaths(validatedId)
  if (!existsSync(paths.md)) process.exit(0)

  const summary = await readFile(paths.md, 'utf8')

  // Build context injection
  let output = [
    '# Session Context (restored by seamless-claude)',
    '',
    'The following is a structured summary of your',
    'session before compaction. Treat this as your',
    'working memory — pick up where you left off.',
    '',
    summary,
  ].join('\n')

  if (output.length > MAX_OUTPUT) {
    output = output.slice(0, MAX_OUTPUT)
    process.stderr.write(
      `seamless-claude: output truncated to ${MAX_OUTPUT} chars\n`,
    )
  }

  // stdout → injected into Claude's context
  process.stdout.write(output)
}

main().catch(() => process.exit(0))
