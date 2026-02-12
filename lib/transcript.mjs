import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

// Shared entry processor for JSONL transcript parsing.
// Returns { entries: string[], chars: number }
function processEntry(entry, opts = {}) {
  const toolResultMax = opts.toolResultMax || 300
  const entries = []
  let chars = 0

  if (entry.type === 'user') {
    if (entry.isMeta) return { entries, chars }
    const msg = entry.message?.content
    if (!msg) return { entries, chars }

    if (typeof msg === 'string') {
      const text = msg.trim()
      if (text) {
        entries.push(`USER: ${text}`)
        chars += text.length
      }
    } else if (Array.isArray(msg)) {
      for (const block of msg) {
        if (block.type === 'text') {
          const text = (block.text || '').trim()
          if (text) {
            entries.push(`USER: ${text}`)
            chars += text.length
          }
        } else if (block.type === 'tool_result') {
          const raw = String(block.content || '')
          const t =
            raw.length > toolResultMax
              ? `${raw.slice(0, toolResultMax)}...[truncated]`
              : raw
          entries.push(`TOOL_RESULT: ${t}`)
          chars += t.length
        }
      }
    }
  } else if (entry.type === 'assistant') {
    const msg = entry.message?.content
    if (!Array.isArray(msg)) return { entries, chars }

    for (const block of msg) {
      if (block.type === 'text') {
        const text = (block.text || '').trim()
        if (text) {
          entries.push(`ASSISTANT: ${text}`)
          chars += text.length
        }
      } else if (block.type === 'tool_use') {
        const name = block.name
        const inp = block.input || {}
        let brief
        switch (name) {
          case 'Bash':
            brief = String(inp.command || '').slice(0, 120)
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
            brief = `${inp.subagent_type}: ${inp.description || ''}`
            break
          default:
            brief = JSON.stringify(inp).slice(0, 100)
        }
        entries.push(`TOOL [${name}]: ${brief}`)
        chars += brief.length + name.length
      }
    }
  }

  return { entries, chars }
}

// Reads JSONL transcript, extracts conversation entries.
// Returns { conversation, totalChars, bytesRead }.
export async function parseTranscript(path, opts = {}) {
  const maxChars = opts.maxChars || 400_000
  const toolResultMax = opts.toolResultMax || 300

  const conversation = []
  let totalChars = 0
  let bytesRead = 0

  const rl = createInterface({
    input: createReadStream(path, 'utf8'),
    crlfDelay: Number.POSITIVE_INFINITY,
  })

  for await (const line of rl) {
    bytesRead += Buffer.byteLength(line, 'utf8') + 1
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }

    const { entries, chars } = processEntry(entry, {
      toolResultMax,
    })
    conversation.push(...entries)
    totalChars += chars

    if (totalChars > maxChars) break
  }

  return { conversation, totalChars, bytesRead }
}

// Reads JSONL from byte offset, extracts conversation.
// Returns string[].
export async function extractTail(path, byteOffset, opts = {}) {
  const maxChars = opts.maxChars || 100_000
  const toolResultMax = opts.toolResultMax || 200

  const tail = []
  let totalChars = 0

  const stream = createReadStream(path, {
    start: byteOffset,
    encoding: 'utf8',
  })
  const rl = createInterface({
    input: stream,
    crlfDelay: Number.POSITIVE_INFINITY,
  })

  for await (const line of rl) {
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }

    const { entries, chars } = processEntry(entry, {
      toolResultMax,
    })
    tail.push(...entries)
    totalChars += chars

    if (totalChars > maxChars) break
  }

  return tail
}
