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

import { existsSync } from 'node:fs'
import { appendFile, writeFile } from 'node:fs/promises'
import { runClaude } from '../lib/claude.mjs'
import {
  HOOKS_DIR,
  TOOL_RESULT_MAX,
  sessionPaths,
  validateSessionId,
} from '../lib/config.mjs'
import { formatHookOutput, runAllHooks } from '../lib/hooks.mjs'
import { releaseLock } from '../lib/lockfile.mjs'
import { parseTranscript } from '../lib/transcript.mjs'
import { validateResult } from '../lib/validate.mjs'

const SESSION_ID = process.argv[2]
const TRANSCRIPT = process.argv[3]
const MODEL = process.env.SEAMLESS_MODEL || 'sonnet'
const TIMEOUT =
  Number.parseInt(process.env.SEAMLESS_TIMEOUT || '300', 10) * 1000
const MAX_CHARS = Number.parseInt(
  process.env.SEAMLESS_MAX_CHARS || '400000',
  10,
)
const HOOK_TIMEOUT =
  Number.parseInt(process.env.SEAMLESS_HOOK_TIMEOUT || '60', 10) * 1000

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

const SYSTEM_PROMPT =
  'You are a session ' +
  'summarisation assistant. You produce structured ' +
  'summaries of Claude Code conversation ' +
  'transcripts. Follow the instructions in the ' +
  'user message exactly. Do not ask questions or ' +
  'refuse. Do not offer to help with anything ' +
  'else. Just produce the requested structured ' +
  'output.'

let PATHS = null

async function log(msg) {
  if (!PATHS) return
  const ts = new Date().toISOString().slice(11, 19)
  await appendFile(PATHS.log, `[${ts}] ${msg}\n`).catch(() => {})
}

async function main() {
  if (!SESSION_ID || !TRANSCRIPT) {
    console.error('Usage: compactor.mjs <session_id> <path>')
    process.exit(1)
  }

  // Validate session ID
  let validatedId
  try {
    validatedId = validateSessionId(SESSION_ID)
  } catch (err) {
    console.error(`Invalid session ID: ${err.message}`)
    process.exit(1)
  }

  PATHS = sessionPaths(validatedId)

  if (!existsSync(TRANSCRIPT)) {
    await log(`Transcript not found: ${TRANSCRIPT}`)
    await releaseLock(PATHS.lock)
    process.exit(1)
  }

  await log(`Starting compaction model=${MODEL}`)
  await log(`Transcript: ${TRANSCRIPT}`)

  const { conversation, totalChars, bytesRead } = await parseTranscript(
    TRANSCRIPT,
    { maxChars: MAX_CHARS, toolResultMax: TOOL_RESULT_MAX },
  )

  if (conversation.length === 0) {
    await log('No conversation content found')
    await releaseLock(PATHS.lock)
    process.exit(1)
  }

  await log(
    `Extracted ${conversation.length} entries, ${totalChars} chars`,
  )

  const transcriptText = conversation.join('\n\n')
  const cmd = [
    'claude',
    '-p',
    '--model',
    MODEL,
    '--no-session-persistence',
    '--output-format',
    'text',
    '--system-prompt',
    SYSTEM_PROMPT,
  ]

  let result = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      let input
      if (attempt === 1) {
        input = `${PROMPT}\n\n---\n\nTRANSCRIPT (${conversation.length} entries):\n\n${transcriptText}`
      } else {
        const half = Math.floor(transcriptText.length / 2)
        const shortened = transcriptText.slice(-half)
        input = `${PROMPT}\n\n---\n\nTRANSCRIPT (truncated, retry):\n\n${shortened}`
        await log(
          `Retry with ${input.length} chars (transcript halved)`,
        )
      }

      await log(`Attempt ${attempt}: calling claude -p`)
      const res = await runClaude(cmd, input, TIMEOUT)

      if (!validateResult(res)) {
        throw new Error(
          `Output failed validation (length=${(res || '').length})`,
        )
      }

      result = res
      break
    } catch (err) {
      await log(`Attempt ${attempt} failed: ${err.message}`)
      if (attempt >= 2) {
        await log('Giving up after 2 attempts')
        await releaseLock(PATHS.lock)
        process.exit(1)
      }
      await log('Retrying with halved transcript...')
    }
  }

  await log(`Got ${result.length} chars response`)

  // Write summary
  const header = [
    `<!-- seamless-claude: ${validatedId} -->`,
    `<!-- generated: ${new Date().toISOString()} -->`,
    `<!-- model: ${MODEL} -->`,
    `<!-- entries: ${conversation.length} -->`,
    '',
  ].join('\n')

  await writeFile(PATHS.md, `${header}\n${result}`, { mode: 0o600 })
  await log(`Wrote summary to ${PATHS.md}`)

  // Write metadata
  const metadata = {
    session_id: validatedId,
    generated_at: new Date().toISOString(),
    model: MODEL,
    transcript_path: TRANSCRIPT,
    transcript_entries: conversation.length,
    transcript_chars: totalChars,
    transcript_byte_offset: bytesRead,
    summary_chars: result.length,
  }
  await writeFile(PATHS.json, JSON.stringify(metadata, null, 2), {
    mode: 0o600,
  })

  // Run hooks.d scripts (if any exist)
  const hookResults = await runAllHooks(
    validatedId,
    TRANSCRIPT,
    PATHS.md,
    { hooksDir: HOOKS_DIR, timeoutMs: HOOK_TIMEOUT },
  )

  if (hookResults.length > 0) {
    const ran = hookResults.map((r) => r.name)
    await log(`Ran ${ran.length} hook(s): ${ran.join(', ')}`)

    const hookOutput = formatHookOutput(hookResults)
    if (hookOutput) {
      // Append hook output to summary
      const enriched = `${header}\n${result}\n\n---\n\n${hookOutput}`
      await writeFile(PATHS.md, enriched, { mode: 0o600 })
      await log('Enriched summary with hook output')
    }

    // Update metadata with hooks info
    metadata.hooks_ran = hookResults.map((r) => ({
      name: r.name,
      exitCode: r.exitCode,
      timedOut: r.timedOut || false,
    }))
    await writeFile(PATHS.json, JSON.stringify(metadata, null, 2), {
      mode: 0o600,
    })
  }

  await releaseLock(PATHS.lock)
  await log('Compaction complete')
}

main().catch(async (err) => {
  if (PATHS) {
    await log(`Fatal: ${err.message}`).catch(() => {})
    await releaseLock(PATHS.lock).catch(() => {})
  }
  process.exit(1)
})
