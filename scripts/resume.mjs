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

import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
import { createReadStream } from 'node:fs'

const OUTPUT_DIR = join(
  homedir(), '.seamless-claude', 'sessions'
)
const TOOL_RESULT_MAX = 200
const MAX_OUTPUT = 200_000

function getMetaFiles() {
  if (!existsSync(OUTPUT_DIR)) return []
  return readdirSync(OUTPUT_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => ({
      path: join(OUTPUT_DIR, f),
      mtime: statSync(join(OUTPUT_DIR, f)).mtimeMs
    }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 10)
}

async function listSessions() {
  const files = getMetaFiles()
  if (files.length === 0) {
    console.error('No sessions available.')
    return
  }
  for (const { path } of files) {
    const meta = JSON.parse(
      await readFile(path, 'utf8')
    )
    const id = meta.session_id
    const short = id.slice(0, 8)
    const ts = meta.generated_at || '?'
    const model = meta.model || '?'
    const entries = meta.transcript_entries || 0
    console.log(
      `${short}  ${ts}  ${model}  ${entries} entries`
    )
  }
}

async function findSession(arg) {
  const files = getMetaFiles()
  if (files.length === 0) return null

  if (!arg || arg === '--latest') {
    return JSON.parse(
      await readFile(files[0].path, 'utf8')
    )
  }

  // Exact match
  const exact = join(OUTPUT_DIR, `${arg}.json`)
  if (existsSync(exact)) {
    return JSON.parse(await readFile(exact, 'utf8'))
  }

  // Prefix match
  const matches = files.filter(f =>
    basename(f.path, '.json').startsWith(arg)
  )
  if (matches.length === 1) {
    return JSON.parse(
      await readFile(matches[0].path, 'utf8')
    )
  }
  if (matches.length > 1) {
    console.error(
      `Ambiguous prefix '${arg}' — `
      + `${matches.length} matches`
    )
    return null
  }

  return null
}

async function pickSession() {
  const files = getMetaFiles()
  if (files.length === 0) {
    console.error('No sessions available.')
    return null
  }

  const metas = []
  for (const { path } of files) {
    metas.push(
      JSON.parse(await readFile(path, 'utf8'))
    )
  }

  console.error('Available sessions:')
  metas.forEach((meta, i) => {
    const short = meta.session_id.slice(0, 8)
    const ts = meta.generated_at || '?'
    const entries = meta.transcript_entries || 0
    console.error(
      `  ${i + 1}. ${short}  ${ts}  ${entries} entries`
    )
  })
  console.error('')

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr
  })

  const choice = await new Promise(resolve => {
    rl.question(
      `Select session (1-${metas.length}): `,
      answer => { rl.close(); resolve(answer) }
    )
  })

  const idx = parseInt(choice, 10) - 1
  if (idx < 0 || idx >= metas.length) {
    console.error('Invalid selection.')
    return null
  }

  return metas[idx]
}

async function extractTail(transcriptPath, offset) {
  if (!existsSync(transcriptPath)) return []

  const tail = []
  let totalChars = 0

  const stream = createReadStream(
    transcriptPath, { start: offset, encoding: 'utf8' }
  )
  const rl = createInterface({
    input: stream, crlfDelay: Infinity
  })

  for await (const line of rl) {
    let entry
    try { entry = JSON.parse(line) } catch { continue }

    if (entry.type === 'user') {
      if (entry.isMeta) continue
      const msg = entry.message?.content
      if (!msg) continue

      if (typeof msg === 'string') {
        const text = msg.trim()
        if (text) {
          tail.push(`USER: ${text}`)
          totalChars += text.length
        }
      } else if (Array.isArray(msg)) {
        for (const block of msg) {
          if (block.type === 'text') {
            const text = (block.text || '').trim()
            if (text) {
              tail.push(`USER: ${text}`)
              totalChars += text.length
            }
          } else if (block.type === 'tool_result') {
            const raw = String(block.content || '')
            const t = raw.length > TOOL_RESULT_MAX
              ? raw.slice(0, TOOL_RESULT_MAX) + '...'
              : raw
            tail.push(`TOOL_RESULT: ${t}`)
            totalChars += t.length
          }
        }
      }
    } else if (entry.type === 'assistant') {
      const msg = entry.message?.content
      if (!Array.isArray(msg)) continue

      for (const block of msg) {
        if (block.type === 'text') {
          const text = (block.text || '').trim()
          if (text) {
            tail.push(`ASSISTANT: ${text}`)
            totalChars += text.length
          }
        } else if (block.type === 'tool_use') {
          const name = block.name
          const inp = block.input || {}
          let brief
          switch (name) {
            case 'Bash':
              brief = String(
                inp.command || ''
              ).slice(0, 120)
              break
            case 'Read':
              brief = String(inp.file_path || '')
              break
            case 'Write':
            case 'Edit':
              brief = String(inp.file_path || '')
              break
            default:
              brief = JSON.stringify(inp).slice(0, 80)
          }
          tail.push(`TOOL [${name}]: ${brief}`)
        }
      }
    }

    if (totalChars > 100_000) break
  }

  return tail
}

// --- Main ---

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
      'No session found. '
      + 'Use --list to see available sessions.'
    )
    process.exit(1)
  }

  const sessionId = meta.session_id
  const summaryPath = join(
    OUTPUT_DIR, `${sessionId}.md`
  )

  if (!existsSync(summaryPath)) {
    console.error(
      `Summary not found: ${summaryPath}`
    )
    process.exit(1)
  }

  const summary = await readFile(
    summaryPath, 'utf8'
  )

  // Extract post-compaction tail
  let tail = []
  if (meta.transcript_path
    && meta.transcript_byte_offset) {
    tail = await extractTail(
      meta.transcript_path,
      meta.transcript_byte_offset
    )
  }

  // Build output
  const parts = [
    '# Session Resume (seamless-claude)',
    '',
    summary,
    ''
  ]

  if (tail.length > 0) {
    parts.push('---')
    parts.push('')
    parts.push('## Post-compaction Conversation')
    parts.push('')
    parts.push(
      'The following exchanges happened AFTER '
      + 'the summary above was generated. Treat '
      + 'these as the most recent context:'
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
      `Warning: output truncated from `
      + `${original} to ${MAX_OUTPUT} chars`
    )
  }

  process.stdout.write(output)
}

main().catch(err => {
  console.error(`Error: ${err.message}`)
  process.exit(1)
})
