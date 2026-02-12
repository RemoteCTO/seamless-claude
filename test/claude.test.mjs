import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runClaude } from '../lib/claude.mjs'

describe('claude', () => {
  describe('runClaude', () => {
    it('resolves with stdout for successful command', async () => {
      const result = await runClaude(['echo', 'hello'], '', 5000)
      assert.equal(result.trim(), 'hello')
    })

    it('rejects for failed command', async () => {
      await assert.rejects(
        async () => {
          await runClaude(['sh', '-c', 'exit 1'], '', 5000)
        },
        (err) => {
          assert.ok(err.message.includes('Exit 1'))
          return true
        },
      )
    })

    it('rejects on timeout and sends kill signal', async () => {
      await assert.rejects(
        async () => {
          await runClaude(['sleep', '10'], '', 100)
        },
        (err) => {
          assert.ok(err.message.includes('Timed out'))
          return true
        },
      )
    })

    it('passes input text to stdin', async () => {
      const result = await runClaude(['cat'], 'test input', 5000)
      assert.equal(result, 'test input')
    })
  })
})
