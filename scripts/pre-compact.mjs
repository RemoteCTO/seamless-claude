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
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  const outputDir = join(
    homedir(), '.seamless-claude', 'sessions'
  )
  await mkdir(outputDir, { recursive: true })

  let input
  try {
    input = JSON.parse(await readStdin())
  } catch {
    process.exit(1)
  }

  const sessionId = input.session_id
  const transcript = input.transcript_path
  if (!sessionId || !transcript) process.exit(1)

  const outFile = join(outputDir, `${sessionId}.md`)
  const lockFile = join(
    outputDir, `${sessionId}.lock`
  )

  // Already done or in progress
  if (existsSync(outFile)) process.exit(0)
  if (existsSync(lockFile)) {
    // Check for stale lock (>10 min)
    const { mtimeMs } = await import('node:fs')
      .then(fs => fs.statSync(lockFile))
    if (Date.now() - mtimeMs < 600_000) {
      process.exit(0)
    }
  }

  // Write lock
  await writeFile(
    lockFile, `${process.pid}:${Date.now()}`
  )

  // Spawn compactor detached
  const compactor = join(__dirname, 'compactor.mjs')
  const child = spawn(
    'node',
    [compactor, sessionId, transcript],
    {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, HOME: homedir() }
    }
  )
  child.unref()
}

main().catch(() => process.exit(1))
