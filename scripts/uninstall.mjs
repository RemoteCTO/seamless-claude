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

// Count sessions for user feedback
const sessionDir = join(DATA_DIR, 'sessions')
let sessionCount = 0
if (existsSync(sessionDir)) {
  sessionCount = readdirSync(sessionDir).filter((f) =>
    f.endsWith('.md'),
  ).length
}

process.stderr.write(
  `seamless-claude: removing ${DATA_DIR} ` +
    `(${sessionCount} session summaries)\n`,
)

rmSync(DATA_DIR, { recursive: true, force: true })

process.stderr.write('seamless-claude: cleanup complete\n')
