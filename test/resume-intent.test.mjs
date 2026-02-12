import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import {
  INTENT_PATH,
  clearIntent,
  createIntent,
  readIntent,
} from '../lib/resume-intent.mjs'

describe('resume-intent', () => {
  let tmpDir
  let intentPath

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'resume-intent-test-'))
    intentPath = join(tmpDir, 'resume-intent.json')
  })

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('exports INTENT_PATH constant', () => {
    assert.ok(INTENT_PATH)
    assert.ok(INTENT_PATH.includes('.seamless-claude'))
    assert.ok(INTENT_PATH.endsWith('resume-intent.json'))
  })

  it('createIntent writes file with correct JSON structure', () => {
    const projectDir = '/test/project'
    const sessionId = '12345678-1234-1234-1234-123456789abc'

    createIntent(projectDir, sessionId, { intentPath })

    const content = readFileSync(intentPath, 'utf8')
    const intent = JSON.parse(content)

    assert.equal(intent.project_dir, projectDir)
    assert.equal(intent.session_id, sessionId)
    assert.ok(intent.created_at)
    assert.ok(new Date(intent.created_at).getTime() > 0)
  })

  it('createIntent file has 0o600 permissions', () => {
    const projectDir = '/test/project'
    const sessionId = '12345678-1234-1234-1234-123456789abc'

    createIntent(projectDir, sessionId, { intentPath })

    const stats = statSync(intentPath)
    const mode = stats.mode & 0o777
    assert.equal(mode, 0o600)
  })

  it('createIntent validates session ID (rejects invalid)', () => {
    const projectDir = '/test/project'
    const invalidSessionId = 'not-a-uuid'

    assert.throws(
      () => createIntent(projectDir, invalidSessionId, { intentPath }),
      /Invalid session ID format/,
    )
  })

  it('readIntent returns intent for matching project dir', () => {
    const projectDir = '/test/project'
    const sessionId = '12345678-1234-1234-1234-123456789abc'

    createIntent(projectDir, sessionId, { intentPath })

    const intent = readIntent(projectDir, { intentPath })

    assert.ok(intent)
    assert.equal(intent.project_dir, projectDir)
    assert.equal(intent.session_id, sessionId)
  })

  it('readIntent returns null for wrong project dir', () => {
    const projectDir = '/test/project'
    const sessionId = '12345678-1234-1234-1234-123456789abc'

    createIntent(projectDir, sessionId, { intentPath })

    const intent = readIntent('/different/project', { intentPath })

    assert.equal(intent, null)
  })

  it('readIntent returns null for stale intent (>1h)', () => {
    const projectDir = '/test/project'
    const sessionId = '12345678-1234-1234-1234-123456789abc'

    // Create intent with old timestamp
    const staleIntent = {
      project_dir: projectDir,
      session_id: sessionId,
      created_at: new Date(
        Date.now() - 2 * 60 * 60 * 1000,
      ).toISOString(),
    }

    rmSync(intentPath, { force: true })
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(intentPath, JSON.stringify(staleIntent), {
      mode: 0o600,
    })

    const intent = readIntent(projectDir, { intentPath })

    assert.equal(intent, null)
  })

  it("readIntent returns null when file doesn't exist", () => {
    rmSync(intentPath, { force: true })

    const intent = readIntent('/test/project', { intentPath })

    assert.equal(intent, null)
  })

  it('readIntent returns null for malformed JSON', () => {
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(intentPath, 'not valid json', { mode: 0o600 })

    const intent = readIntent('/test/project', { intentPath })

    assert.equal(intent, null)
  })

  it('clearIntent removes existing file', () => {
    const projectDir = '/test/project'
    const sessionId = '12345678-1234-1234-1234-123456789abc'

    createIntent(projectDir, sessionId, { intentPath })

    assert.ok(statSync(intentPath))

    clearIntent({ intentPath })

    assert.throws(() => statSync(intentPath), { code: 'ENOENT' })
  })

  it("clearIntent doesn't throw when file missing", () => {
    rmSync(intentPath, { force: true })

    assert.doesNotThrow(() => clearIntent({ intentPath }))
  })
})
