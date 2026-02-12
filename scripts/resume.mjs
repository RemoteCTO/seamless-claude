#!/usr/bin/env node
/**
 * Cross-session resume.
 *
 * Lists available precompact summaries and outputs
 * a selected one for context injection. Used by the
 * /seamless-claude:resume skill.
 *
 * Usage:
 *   node resume.mjs --list
 *   node resume.mjs --latest
 *   node resume.mjs --pick
 *   node resume.mjs <session_id or prefix>
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { MAX_OUTPUT, sessionPaths } from '../lib/config.mjs'
import {
  findSession,
  getMetaFiles,
  listSessions,
} from '../lib/sessions.mjs'
import { extractTail } from '../lib/transcript.mjs'

async function pickSession() {
  const files = getMetaFiles()
  if (files.length === 0) {
    console.error('No sessions available.')
    return null
  }

  const metas = []
  for (const { path } of files) {
    metas.push(JSON.parse(await readFile(path, 'utf8')))
  }

  console.error('Available sessions:')
  metas.forEach((meta, i) => {
    const short = meta.session_id.slice(0, 8)
    const ts = meta.generated_at || '?'
    const entries = meta.transcript_entries || 0
    console.error(`  ${i + 1}. ${short}  ${ts}  ${entries} entries`)
  })
  console.error('')

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  })

  const choice = await new Promise((resolve) => {
    rl.question(`Select session (1-${metas.length}): `, (answer) => {
      rl.close()
      resolve(answer)
    })
  })

  const idx = Number.parseInt(choice, 10) - 1
  if (idx < 0 || idx >= metas.length) {
    console.error('Invalid selection.')
    return null
  }

  return metas[idx]
}

async function main() {
  const arg = process.argv[2]

  if (arg === '--list') {
    await listSessions()
    process.exit(0)
  }

  let meta
  if (arg === '--pick') {
    meta = await pickSession()
  } else {
    meta = await findSession(arg)
  }

  if (!meta) {
    console.error(
      'No session found. Use --list to see available sessions.',
    )
    process.exit(1)
  }

  const sessionId = meta.session_id
  const paths = sessionPaths(sessionId)

  if (!existsSync(paths.md)) {
    console.error(`Summary not found: ${paths.md}`)
    process.exit(1)
  }

  const summary = await readFile(paths.md, 'utf8')

  // Extract post-compaction tail
  let tail = []
  if (meta.transcript_path && meta.transcript_byte_offset) {
    if (existsSync(meta.transcript_path)) {
      tail = await extractTail(
        meta.transcript_path,
        meta.transcript_byte_offset,
      )
    }
  }

  // Build output
  const parts = ['# Session Resume (seamless-claude)', '', summary, '']

  if (tail.length > 0) {
    parts.push('---')
    parts.push('')
    parts.push('## Post-compaction Conversation')
    parts.push('')
    parts.push(
      'The following exchanges happened AFTER ' +
        'the summary above was generated. Treat ' +
        'these as the most recent context:',
    )
    parts.push('')
    for (const line of tail) {
      parts.push(line)
      parts.push('')
    }
  }

  let output = parts.join('\n')
  if (output.length > MAX_OUTPUT) {
    const original = output.length
    output = output.slice(0, MAX_OUTPUT)
    console.error(
      `Warning: output truncated from ${original} to ${MAX_OUTPUT} chars`,
    )
  }

  process.stdout.write(output)
}

main().catch((err) => {
  console.error(`Error: ${err.message}`)
  process.exit(1)
})
