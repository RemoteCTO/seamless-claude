import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { discoverHooks, runAllHooks, runHook } from '../lib/hooks.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(__dirname, 'fixtures', 'hooks')

describe('hooks', () => {
  describe('discoverHooks', () => {
    it('finds executable scripts sorted by name', async () => {
      const hooks = await discoverHooks(FIXTURES)
      const names = hooks.map((h) => h.split('/').pop())
      // Should include numbered scripts, exclude dotfiles
      // and non-executable
      assert.ok(names.includes('01-echo.sh'))
      assert.ok(names.includes('02-env.sh'))
      assert.ok(names.includes('03-fail.sh'))
      assert.ok(names.includes('04-write-file.sh'))
      assert.ok(names.includes('05-slow.sh'))
    })

    it('sorts scripts alphabetically', async () => {
      const hooks = await discoverHooks(FIXTURES)
      const names = hooks.map((h) => h.split('/').pop())
      const sorted = [...names].sort()
      assert.deepEqual(names, sorted)
    })

    it('skips dotfiles', async () => {
      const hooks = await discoverHooks(FIXTURES)
      const names = hooks.map((h) => h.split('/').pop())
      assert.ok(!names.includes('.hidden.sh'))
    })

    it('skips non-executable files', async () => {
      const hooks = await discoverHooks(FIXTURES)
      const names = hooks.map((h) => h.split('/').pop())
      assert.ok(!names.includes('not-executable.sh'))
    })

    it('returns empty array for nonexistent dir', async () => {
      const hooks = await discoverHooks('/nonexistent/path')
      assert.deepEqual(hooks, [])
    })

    it('returns empty array for empty dir', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'hooks-empty-'))
      const hooks = await discoverHooks(dir)
      assert.deepEqual(hooks, [])
    })
  })

  describe('runHook', () => {
    it('captures stdout', async () => {
      const result = await runHook(
        join(FIXTURES, '01-echo.sh'),
        {},
        5000,
      )
      assert.equal(result.name, '01-echo.sh')
      assert.match(result.stdout, /Hello from hook 01/)
      assert.equal(result.exitCode, 0)
    })

    it('passes env vars to script', async () => {
      const result = await runHook(
        join(FIXTURES, '02-env.sh'),
        {
          SEAMLESS_SESSION_ID: 'test-uuid',
          SEAMLESS_TRANSCRIPT: '/tmp/test.jsonl',
          SEAMLESS_SUMMARY: '/tmp/test.md',
        },
        5000,
      )
      assert.match(result.stdout, /session=test-uuid/)
      assert.match(result.stdout, /transcript=\/tmp\/test\.jsonl/)
      assert.match(result.stdout, /summary=\/tmp\/test\.md/)
    })

    it('handles non-zero exit gracefully', async () => {
      const result = await runHook(
        join(FIXTURES, '03-fail.sh'),
        {},
        5000,
      )
      assert.equal(result.exitCode, 1)
      assert.match(result.stdout, /about to fail/)
    })

    it('kills child on timeout', async () => {
      const result = await runHook(
        join(FIXTURES, '05-slow.sh'),
        {},
        200,
      )
      assert.ok(result.exitCode !== 0)
      assert.ok(result.timedOut)
    })
  })

  describe('runAllHooks', () => {
    const SESSION_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    const TRANSCRIPT = '/tmp/test-transcript.jsonl'
    const SUMMARY = '/tmp/test-summary.md'

    it('returns empty array when no hooks dir', async () => {
      const result = await runAllHooks(
        SESSION_ID,
        TRANSCRIPT,
        SUMMARY,
        { hooksDir: '/nonexistent/path', timeoutMs: 5000 },
      )
      assert.deepEqual(result, [])
    })

    it('passes correct env vars', async () => {
      // Use a temp dir with just the env-checking hook
      const dir = mkdtempSync(join(tmpdir(), 'hooks-env-'))
      const src = join(FIXTURES, '02-env.sh')
      const { readFileSync, copyFileSync, chmodSync } = await import(
        'node:fs'
      )
      copyFileSync(src, join(dir, '01-env.sh'))
      chmodSync(join(dir, '01-env.sh'), 0o755)

      const result = await runAllHooks(
        SESSION_ID,
        TRANSCRIPT,
        SUMMARY,
        { hooksDir: dir, timeoutMs: 5000 },
      )
      assert.equal(result.length, 1)
      assert.match(result[0].stdout, new RegExp(SESSION_ID))
      assert.match(result[0].stdout, new RegExp(TRANSCRIPT))
      assert.match(result[0].stdout, new RegExp(SUMMARY))
    })

    it('collects .md files from OUTPUT_DIR', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'hooks-md-'))
      const { copyFileSync, chmodSync } = await import('node:fs')
      copyFileSync(
        join(FIXTURES, '04-write-file.sh'),
        join(dir, '01-write.sh'),
      )
      chmodSync(join(dir, '01-write.sh'), 0o755)

      const result = await runAllHooks(
        SESSION_ID,
        TRANSCRIPT,
        SUMMARY,
        { hooksDir: dir, timeoutMs: 5000 },
      )
      assert.equal(result.length, 1)
      assert.ok(result[0].files.length > 0)
      assert.match(result[0].files[0].content, /File output from hook/)
    })

    it('continues after hook failure', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'hooks-fail-'))
      const { copyFileSync, chmodSync } = await import('node:fs')

      // 01-fail, then 02-echo
      copyFileSync(
        join(FIXTURES, '03-fail.sh'),
        join(dir, '01-fail.sh'),
      )
      chmodSync(join(dir, '01-fail.sh'), 0o755)
      copyFileSync(
        join(FIXTURES, '01-echo.sh'),
        join(dir, '02-echo.sh'),
      )
      chmodSync(join(dir, '02-echo.sh'), 0o755)

      const result = await runAllHooks(
        SESSION_ID,
        TRANSCRIPT,
        SUMMARY,
        { hooksDir: dir, timeoutMs: 5000 },
      )
      // Both ran — failure doesn't abort
      assert.equal(result.length, 2)
      assert.equal(result[0].exitCode, 1)
      assert.equal(result[1].exitCode, 0)
    })

    it('formats output sections', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'hooks-fmt-'))
      const { copyFileSync, chmodSync } = await import('node:fs')
      copyFileSync(
        join(FIXTURES, '01-echo.sh'),
        join(dir, '01-echo.sh'),
      )
      chmodSync(join(dir, '01-echo.sh'), 0o755)

      const result = await runAllHooks(
        SESSION_ID,
        TRANSCRIPT,
        SUMMARY,
        { hooksDir: dir, timeoutMs: 5000 },
      )
      assert.equal(result.length, 1)
      assert.equal(result[0].name, '01-echo.sh')
    })
  })
})
