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
import { join } from 'node:path'
import { homedir } from 'node:os'

const OUTPUT_DIR = join(
  homedir(), '.seamless-claude', 'sessions'
)
const MAX_OUTPUT = 200_000

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

  const summaryPath = join(
    OUTPUT_DIR, `${sessionId}.md`
  )
  if (!existsSync(summaryPath)) process.exit(0)

  let summary = await readFile(summaryPath, 'utf8')

  // Build context injection
  let output = [
    '# Session Context (restored by seamless-claude)',
    '',
    'The following is a structured summary of your',
    'session before compaction. Treat this as your',
    'working memory — pick up where you left off.',
    '',
    summary
  ].join('\n')

  if (output.length > MAX_OUTPUT) {
    output = output.slice(0, MAX_OUTPUT)
    process.stderr.write(
      `seamless-claude: output truncated to `
      + `${MAX_OUTPUT} chars\n`
    )
  }

  // stdout → injected into Claude's context
  process.stdout.write(output)
}

main().catch(() => process.exit(0))
