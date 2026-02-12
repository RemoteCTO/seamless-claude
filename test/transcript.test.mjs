import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { extractTail, parseTranscript } from '../lib/transcript.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(__dirname, 'fixtures')

describe('transcript', () => {
  describe('parseTranscript', () => {
    it('parses fixture transcript.jsonl correctly', async () => {
      const path = join(FIXTURES, 'transcript.jsonl')
      const { conversation, totalChars, bytesRead } =
        await parseTranscript(path)

      assert.ok(conversation.length > 0)
      assert.ok(bytesRead > 0)
      assert.ok(totalChars > 0)
    })

    it('prefixes user messages with USER:', async () => {
      const path = join(FIXTURES, 'transcript.jsonl')
      const { conversation } = await parseTranscript(path)

      const userMessages = conversation.filter((entry) =>
        entry.startsWith('USER:'),
      )
      assert.ok(userMessages.length > 0)
      assert.ok(
        userMessages.some((m) =>
          m.includes('Help me fix the login bug'),
        ),
      )
    })

    it('prefixes assistant text with ASSISTANT:', async () => {
      const path = join(FIXTURES, 'transcript.jsonl')
      const { conversation } = await parseTranscript(path)

      const assistantMessages = conversation.filter((entry) =>
        entry.startsWith('ASSISTANT:'),
      )
      assert.ok(assistantMessages.length > 0)
    })

    it('formats tool use entries as TOOL [Name]: brief', async () => {
      const path = join(FIXTURES, 'transcript.jsonl')
      const { conversation } = await parseTranscript(path)

      const toolUse = conversation.filter((entry) =>
        entry.startsWith('TOOL ['),
      )
      assert.ok(toolUse.length > 0)
      assert.ok(toolUse.some((t) => t.includes('TOOL [Read]:')))
      assert.ok(toolUse.some((t) => t.includes('TOOL [Edit]:')))
      assert.ok(toolUse.some((t) => t.includes('TOOL [Bash]:')))
    })

    it('formats tool results as TOOL_RESULT:', async () => {
      const path = join(FIXTURES, 'transcript.jsonl')
      const { conversation } = await parseTranscript(path)

      const toolResults = conversation.filter((entry) =>
        entry.startsWith('TOOL_RESULT:'),
      )
      assert.ok(toolResults.length > 0)
    })

    it('skips isMeta entries', async () => {
      const path = join(FIXTURES, 'transcript.jsonl')
      const { conversation } = await parseTranscript(path)

      const metaEntries = conversation.filter((entry) =>
        entry.includes('system metadata'),
      )
      assert.equal(metaEntries.length, 0)
    })

    it('parses empty.jsonl correctly', async () => {
      const path = join(FIXTURES, 'empty.jsonl')
      const { conversation, totalChars, bytesRead } =
        await parseTranscript(path)

      assert.deepEqual(conversation, [])
      assert.equal(totalChars, 0)
      assert.ok(bytesRead >= 0)
    })

    it('parses malformed.jsonl skipping bad lines', async () => {
      const path = join(FIXTURES, 'malformed.jsonl')
      const { conversation } = await parseTranscript(path)

      const userMessages = conversation.filter((entry) =>
        entry.startsWith('USER:'),
      )
      const assistantMessages = conversation.filter((entry) =>
        entry.startsWith('ASSISTANT:'),
      )

      assert.ok(userMessages.some((m) => m.includes('valid line')))
      assert.ok(assistantMessages.some((m) => m.includes('also valid')))
    })

    it('respects maxChars option', async () => {
      const path = join(FIXTURES, 'transcript.jsonl')
      const { totalChars } = await parseTranscript(path, {
        maxChars: 100,
      })

      assert.ok(totalChars > 50)
    })
  })

  describe('extractTail', () => {
    it('extracts from offset 0 returning entries', async () => {
      const path = join(FIXTURES, 'transcript.jsonl')
      const tail = await extractTail(path, 0)

      assert.ok(tail.length > 0)
    })

    it('extracts from offset near end returning fewer', async () => {
      const path = join(FIXTURES, 'transcript.jsonl')
      const allEntries = await extractTail(path, 0)
      const tailEntries = await extractTail(path, 800)

      assert.ok(tailEntries.length < allEntries.length)
    })

    it('returns empty array for non-existent file', async () => {
      const path = join(FIXTURES, 'does-not-exist.jsonl')
      await assert.rejects(
        async () => await extractTail(path, 0),
        /ENOENT/,
      )
    })

    it('respects maxChars option', async () => {
      const path = join(FIXTURES, 'transcript.jsonl')
      const tail = await extractTail(path, 0, {
        maxChars: 100,
      })

      let totalChars = 0
      for (const entry of tail) {
        totalChars += entry.length
      }

      assert.ok(totalChars > 50)
    })
  })
})
