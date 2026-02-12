#!/usr/bin/env node
/**
 * Cleanup hook for plugin uninstall.
 *
 * Removes the ~/.seamless-claude/ directory and
 * all session data. Warns user to stderr before
 * deletion. Idempotent — exits cleanly if data
 * dir doesn't exist.
 */

import { existsSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DATA_DIR = join(homedir(), '.seamless-claude')

if (!existsSync(DATA_DIR)) {
  process.stderr.write('seamless-claude: no data to clean up\n')
  process.exit(0)
}

// Count sessions and state files for user feedback
const sessionDir = join(DATA_DIR, 'sessions')
const stateDir = join(DATA_DIR, 'state')
let sessionCount = 0
let stateCount = 0
if (existsSync(sessionDir)) {
  sessionCount = readdirSync(sessionDir).filter((f) =>
    f.endsWith('.md'),
  ).length
}
if (existsSync(stateDir)) {
  stateCount = readdirSync(stateDir).length
}

process.stderr.write(
  `seamless-claude: removing ${DATA_DIR} ` +
    `(${sessionCount} sessions, ` +
    `${stateCount} state files)\n`,
)

rmSync(DATA_DIR, { recursive: true, force: true })

process.stderr.write('seamless-claude: cleanup complete\n')
