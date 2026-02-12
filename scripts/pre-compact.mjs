#!/usr/bin/env node
/**
 * PreCompact hook handler.
 *
 * Receives session JSON on stdin from Claude Code's
 * PreCompact event. Spawns the compactor as a detached
 * background process so compaction isn't blocked.
 *
 * Async hook — Claude continues immediately.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sessionPaths, validateSessionId } from '../lib/config.mjs'
import { acquireLock, isLockStale } from '../lib/lockfile.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

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
    process.exit(1)
  }

  const sessionId = input.session_id
  const transcript = input.transcript_path
  if (!sessionId || !transcript) process.exit(1)

  // Validate session ID before using in paths
  let validatedId
  try {
    validatedId = validateSessionId(sessionId)
  } catch {
    process.exit(1)
  }

  const paths = sessionPaths(validatedId)

  // Already done
  if (existsSync(paths.md)) process.exit(0)

  // Check for stale lock
  if (existsSync(paths.lock) && !isLockStale(paths.lock)) {
    process.exit(0)
  }

  // Acquire lock
  if (!acquireLock(paths.lock)) process.exit(0)

  // Spawn compactor detached
  const compactor = join(__dirname, 'compactor.mjs')
  const child = spawn('node', [compactor, validatedId, transcript], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  })
  child.unref()
}

main().catch(() => process.exit(1))
