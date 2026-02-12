#!/usr/bin/env node
/**
 * Background session compactor.
 *
 * Reads a JSONL transcript, extracts conversation,
 * pipes to `claude -p` for a structured summary.
 * Output enables seamless session resume after
 * compaction.
 *
 * Usage: node compactor.mjs <session_id> <transcript>
 * Env:   SEAMLESS_MODEL (default: sonnet)
 *        SEAMLESS_TIMEOUT (default: 300)
 *        SEAMLESS_MAX_CHARS (default: 400000)
 */

import { existsSync, createReadStream } from 'node:fs'
import {
  writeFile, unlink, mkdir, appendFile
} from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const SESSION_ID = process.argv[2]
const TRANSCRIPT = process.argv[3]
const MODEL = process.env.SEAMLESS_MODEL || 'sonnet'
const TIMEOUT = parseInt(
  process.env.SEAMLESS_TIMEOUT || '300', 10
) * 1000
const MAX_CHARS = parseInt(
  process.env.SEAMLESS_MAX_CHARS || '400000', 10
)
const TOOL_RESULT_MAX = 300
const MIN_RESULT_LENGTH = 500

const OUTPUT_DIR = join(
  homedir(), '.seamless-claude', 'sessions'
)
const OUTPUT_FILE = join(
  OUTPUT_DIR, `${SESSION_ID}.md`
)
const META_FILE = join(
  OUTPUT_DIR, `${SESSION_ID}.json`
)
const LOG_FILE = join(
  OUTPUT_DIR, `${SESSION_ID}.log`
)
const LOCKFILE = join(
  OUTPUT_DIR, `${SESSION_ID}.lock`
)

const EXPECTED_SECTIONS = [
  'Session Summary',
  'Technical Context',
  'Knowledge Extractions',
  'Next Steps',
  'Active Context'
]

async function log(msg) {
  const ts = new Date().toISOString().slice(11, 19)
  await appendFile(LOG_FILE, `[${ts}] ${msg}\n`)
    .catch(() => {})
}

async function cleanupLock() {
  await unlink(LOCKFILE).catch(() => {})
}

function validateResult(result) {
  if (!result || result.trim().length === 0) {
    return false
  }
  if (result.length < MIN_RESULT_LENGTH) return false
  const found = EXPECTED_SECTIONS.filter(
    s => result.includes(s)
  ).length
  return found >= 3
}

// --- Parse JSONL transcript ---

async function parseTranscript(path) {
  const conversation = []
  let totalChars = 0
  let bytesRead = 0

  const rl = createInterface({
    input: createReadStream(path, 'utf8'),
    crlfDelay: Infinity
  })

  for await (const line of rl) {
    bytesRead += Buffer.byteLength(line, 'utf8') + 1
    let entry
    try { entry = JSON.parse(line) } catch { continue }

    if (entry.type === 'user') {
      if (entry.isMeta) continue
      const msg = entry.message?.content
      if (!msg) continue

      if (typeof msg === 'string') {
        const text = msg.trim()
        if (text) {
          conversation.push(`USER: ${text}`)
          totalChars += text.length
        }
      } else if (Array.isArray(msg)) {
        for (const block of msg) {
          if (block.type === 'text') {
            const text = (block.text || '').trim()
            if (text) {
              conversation.push(`USER: ${text}`)
              totalChars += text.length
            }
          } else if (block.type === 'tool_result') {
            const raw = String(block.content || '')
            const t = raw.length > TOOL_RESULT_MAX
              ? raw.slice(0, TOOL_RESULT_MAX)
                + '...[truncated]'
              : raw
            conversation.push(`TOOL_RESULT: ${t}`)
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
            conversation.push(`ASSISTANT: ${text}`)
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
              brief = `${inp.file_path || ''}`
              break
            case 'Glob':
              brief = String(inp.pattern || '')
              break
            case 'Grep':
              brief = `${inp.pattern} in ${inp.path}`
              break
            case 'WebSearch':
              brief = String(inp.query || '')
              break
            case 'Task':
              brief = `${inp.subagent_type}: `
                + `${inp.description || ''}`
              break
            default:
              brief = JSON.stringify(inp)
                .slice(0, 100)
          }
          conversation.push(
            `TOOL [${name}]: ${brief}`
          )
          totalChars += brief.length + name.length
        }
      }
    }

    if (totalChars > MAX_CHARS) break
  }

  return { conversation, totalChars, bytesRead }
}

// --- Call claude -p ---

function runClaude(cmd, inputText) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd[0], cmd.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(
        `Timed out after ${TIMEOUT / 1000}s`
      ))
    }, TIMEOUT)

    child.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(
          `Exit ${code}: ${stderr.slice(0, 500)}`
        ))
      } else {
        resolve(stdout)
      }
    })

    child.on('error', err => {
      clearTimeout(timer)
      reject(err)
    })

    child.stdin.write(inputText)
    child.stdin.end()
  })
}

// --- Prompt ---

const PROMPT = `You are a session continuity assistant. \
Below is a Claude Code conversation transcript. \
Produce a structured handoff document that enables \
a new session to continue seamlessly.

## Required sections:

### 1. Session Summary
Concise overview: what the user requested, what was \
accomplished, current state, what remains.

### 2. Technical Context
PRESERVE ALL specific details verbatim:
- File paths created/modified (full paths)
- Configuration values, IP addresses, ports
- Command sequences (working and failed)
- Error messages and their resolutions
- Architecture decisions with reasoning
- Environment details (branches, versions)

### 3. Knowledge Extractions
Extract reusable knowledge in these exact formats:
\`\`\`
DECISION: [choice with full reasoning]
LEARNED:  [discovery with specifics]
PATTERN:  [code pattern with example]
BLOCKER:  [what doesn't work and why]
\`\`\`

### 4. Next Steps
Specific, actionable items. Priority ordered.
Include any open questions or blockers.

### 5. Active Context
- Working directory
- Git branch
- Active ticket/epic (if mentioned)
- Key files being worked on

## CRITICAL RULES:
- Preserve IPs, paths, commands, config values \
  VERBATIM — do not paraphrase technical specifics
- Include error messages exactly as they appeared
- Note what was TRIED but FAILED (prevents repeats)
- The next session has NO conversation history — \
  this document IS the entire history`

const SYSTEM_PROMPT = 'You are a session ' +
  'summarisation assistant. You produce structured ' +
  'summaries of Claude Code conversation ' +
  'transcripts. Follow the instructions in the ' +
  'user message exactly. Do not ask questions or ' +
  'refuse. Do not offer to help with anything ' +
  'else. Just produce the requested structured ' +
  'output.'

// --- Main ---

async function main() {
  if (!SESSION_ID || !TRANSCRIPT) {
    console.error(
      'Usage: compactor.mjs <session_id> <path>'
    )
    await cleanupLock()
    process.exit(1)
  }

  if (!existsSync(TRANSCRIPT)) {
    await log(`Transcript not found: ${TRANSCRIPT}`)
    await cleanupLock()
    process.exit(1)
  }

  await mkdir(OUTPUT_DIR, { recursive: true })
  await log(`Starting compaction model=${MODEL}`)
  await log(`Transcript: ${TRANSCRIPT}`)

  const {
    conversation, totalChars, bytesRead
  } = await parseTranscript(TRANSCRIPT)

  if (conversation.length === 0) {
    await log('No conversation content found')
    await cleanupLock()
    process.exit(1)
  }

  await log(
    `Extracted ${conversation.length} entries, `
    + `${totalChars} chars`
  )

  const transcriptText = conversation.join('\n\n')
  const cmd = [
    'claude', '-p',
    '--model', MODEL,
    '--no-session-persistence',
    '--output-format', 'text',
    '--system-prompt', SYSTEM_PROMPT
  ]

  let result = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      let input
      if (attempt === 1) {
        input = `${PROMPT}\n\n---\n\n`
          + `TRANSCRIPT `
          + `(${conversation.length} entries):\n\n`
          + transcriptText
      } else {
        const half = Math.floor(
          transcriptText.length / 2
        )
        const shortened = transcriptText.slice(-half)
        input = `${PROMPT}\n\n---\n\n`
          + `TRANSCRIPT (truncated, retry):\n\n`
          + shortened
        await log(
          `Retry with ${input.length} chars `
          + `(transcript halved)`
        )
      }

      await log(
        `Attempt ${attempt}: calling claude -p`
      )
      const res = await runClaude(cmd, input)

      if (!validateResult(res)) {
        throw new Error(
          'Output failed validation '
          + `(length=${(res || '').length})`
        )
      }

      result = res
      break
    } catch (err) {
      await log(
        `Attempt ${attempt} failed: ${err.message}`
      )
      if (attempt >= 2) {
        await log('Giving up after 2 attempts')
        await cleanupLock()
        process.exit(1)
      }
      await log('Retrying with halved transcript...')
    }
  }

  await log(`Got ${result.length} chars response`)

  // Write summary
  const header = [
    `<!-- seamless-claude: ${SESSION_ID} -->`,
    `<!-- generated: ${new Date().toISOString()} -->`,
    `<!-- model: ${MODEL} -->`,
    `<!-- entries: ${conversation.length} -->`,
    ''
  ].join('\n')

  await writeFile(OUTPUT_FILE, header + '\n' + result)
  await log(`Wrote summary to ${OUTPUT_FILE}`)

  // Write metadata
  const metadata = {
    session_id: SESSION_ID,
    generated_at: new Date().toISOString(),
    model: MODEL,
    transcript_path: TRANSCRIPT,
    transcript_entries: conversation.length,
    transcript_chars: totalChars,
    transcript_byte_offset: bytesRead,
    summary_chars: result.length
  }
  await writeFile(
    META_FILE, JSON.stringify(metadata, null, 2)
  )

  // Run post-compact hook if configured
  const hookCmd = process.env.SEAMLESS_POST_HOOK
  if (hookCmd) {
    await log(`Running post-compact hook: ${hookCmd}`)
    const expanded = hookCmd
      .replace('%{output}', OUTPUT_FILE)
      .replace('%{meta}', META_FILE)
      .replace('%{session}', SESSION_ID)
    const { execSync } = await import('node:child_process')
    try {
      execSync(expanded, {
        timeout: 30_000,
        stdio: 'ignore'
      })
      await log('Post-compact hook completed')
    } catch (err) {
      await log(
        `Post-compact hook failed: ${err.message}`
      )
    }
  }

  await cleanupLock()
  await log('Compaction complete')
}

main().catch(async (err) => {
  await log(`Fatal: ${err.message}`).catch(() => {})
  await cleanupLock().catch(() => {})
  process.exit(1)
})
