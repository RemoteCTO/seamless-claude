import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BIN = join(ROOT, 'bin', 'claude-resume')

const ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

function run(args, env = {}) {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    })
    return { stdout, stderr: '', code: 0 }
  } catch (err) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      code: err.status ?? 1,
    }
  }
}

function makeTmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'seamless-cli-'))
  mkdirSync(join(dir, 'sessions'))
  return dir
}

function writeSession(dir, id, summary) {
  const meta = {
    session_id: id,
    generated_at: '2026-02-12T10:00:00Z',
    model: 'sonnet',
    transcript_entries: 42,
  }
  writeFileSync(
    join(dir, 'sessions', `${id}.json`),
    JSON.stringify(meta),
  )
  if (summary) {
    writeFileSync(join(dir, 'sessions', `${id}.md`), summary)
  }
}

describe('claude-resume CLI', () => {
  describe('--help', () => {
    it('exits 0 with usage text', () => {
      const r = run(['--help'])
      assert.equal(r.code, 0)
      assert.ok(r.stdout.includes('Usage:'))
      assert.ok(r.stdout.includes('claude-resume'))
    })

    it('shows all options', () => {
      const r = run(['--help'])
      assert.ok(r.stdout.includes('--list'))
      assert.ok(r.stdout.includes('--pick'))
      assert.ok(r.stdout.includes('--print'))
    })

    it('accepts help without dashes', () => {
      const r = run(['help'])
      assert.equal(r.code, 0)
      assert.ok(r.stdout.includes('Usage:'))
    })
  })

  describe('--list', () => {
    let dir

    before(() => {
      dir = makeTmpDir()
      writeSession(dir, ID)
    })

    after(() => {
      rmSync(dir, {
        recursive: true,
        force: true,
      })
    })

    it('shows sessions', () => {
      const r = run(['--list'], { SEAMLESS_DATA_DIR: dir })
      assert.equal(r.code, 0)
      assert.ok(r.stdout.includes('a1b2c3d4'))
    })

    it('outputs nothing when empty', () => {
      const empty = makeTmpDir()
      const r = run(['--list'], { SEAMLESS_DATA_DIR: empty })
      assert.equal(r.code, 0)
      assert.equal(r.stdout.trim(), '')
      rmSync(empty, { recursive: true })
    })
  })

  describe('--print', () => {
    let dir

    before(() => {
      dir = makeTmpDir()
      writeSession(dir, ID, '## Session Summary\n\nTest content.')
    })

    after(() => {
      rmSync(dir, {
        recursive: true,
        force: true,
      })
    })

    it('outputs resume text', () => {
      const r = run(['--print'], { SEAMLESS_DATA_DIR: dir })
      assert.equal(r.code, 0)
      assert.ok(r.stdout.includes('Session Resume'))
      assert.ok(r.stdout.includes('Test content'))
    })

    it('exits non-zero when empty', () => {
      const empty = makeTmpDir()
      const r = run(['--print'], { SEAMLESS_DATA_DIR: empty })
      assert.notEqual(r.code, 0)
      rmSync(empty, { recursive: true })
    })

    it('accepts session prefix', () => {
      const r = run(['--print', 'a1b2c3d4'], { SEAMLESS_DATA_DIR: dir })
      assert.equal(r.code, 0)
      assert.ok(r.stdout.includes('Test content'))
    })
  })
})
