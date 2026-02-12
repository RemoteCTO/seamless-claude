import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(
  __dirname,
  '..',
  'scripts',
  'user-prompt-submit.mjs',
)
const SESSION_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

function runScript(stdinJson, env = {}) {
  const input =
    typeof stdinJson === 'string'
      ? stdinJson
      : JSON.stringify(stdinJson)
  const result = execFileSync('node', [SCRIPT], {
    input,
    env: {
      ...process.env,
      ...env,
      HOME: process.env.HOME,
      PATH: process.env.PATH,
    },
    timeout: 10000,
    encoding: 'utf8',
  })
  return result
}

describe('user-prompt-submit', () => {
  let tempState
  let tempData

  before(() => {
    tempState = mkdtempSync(join(tmpdir(), 'ups-state-'))
    tempData = mkdtempSync(join(tmpdir(), 'ups-data-'))
  })

  after(() => {
    rmSync(tempState, { recursive: true, force: true })
    rmSync(tempData, { recursive: true, force: true })
  })

  function env() {
    return {
      SEAMLESS_STATE_DIR: tempState,
      SEAMLESS_DATA_DIR: tempData,
    }
  }

  function writeState(state) {
    writeFileSync(
      join(tempState, `${SESSION_ID}.json`),
      JSON.stringify(state),
      { mode: 0o600 },
    )
  }

  it('outputs nothing when state is idle', () => {
    const e = env()
    writeState({
      session_id: SESSION_ID,
      compact_at: null,
      wrapup_at: null,
      wrapup_injected: false,
      error_notified: false,
      last_pct: 50,
    })
    const out = runScript({ session_id: SESSION_ID }, e)
    assert.equal(out, '')
  })

  it('injects wrapup message once', () => {
    const e = env()
    writeState({
      session_id: SESSION_ID,
      compact_at: '2026-02-12T10:00:00Z',
      wrapup_at: '2026-02-12T11:00:00Z',
      wrapup_injected: false,
      error_notified: false,
      last_pct: 92,
    })
    // Summary must exist, otherwise error fires first
    const sessDir = join(e.SEAMLESS_DATA_DIR, 'sessions')
    mkdirSync(sessDir, { recursive: true })
    writeFileSync(join(sessDir, `${SESSION_ID}.md`), '# Summary\n')

    const out = runScript({ session_id: SESSION_ID }, e)
    assert.match(out, /critically full/)

    // Second run should NOT inject again
    const out2 = runScript({ session_id: SESSION_ID }, e)
    assert.equal(out2, '')
  })

  it('injects error notification with log path', () => {
    const e = env()
    // Clean up .md from previous test
    const sessDir = join(e.SEAMLESS_DATA_DIR, 'sessions')
    const mdPath = join(sessDir, `${SESSION_ID}.md`)
    rmSync(mdPath, { force: true })
    // Set up state as if compaction started but no lock
    writeState({
      session_id: SESSION_ID,
      compact_at: '2026-02-12T10:00:00Z',
      wrapup_at: null,
      wrapup_injected: false,
      error_notified: false,
      last_pct: 75,
    })
    // Write a log file in sessions dir
    mkdirSync(sessDir, { recursive: true })
    const logPath = join(sessDir, `${SESSION_ID}.log`)
    writeFileSync(logPath, '[10:05:00] Attempt 2 failed: timeout\n')

    const out = runScript({ session_id: SESSION_ID }, e)
    assert.match(out, /compaction failed/i)
    assert.match(out, /Attempt 2 failed: timeout/)
    assert.match(out, /\.log/)
  })

  it('does not repeat error notification', () => {
    const e = env()
    writeState({
      session_id: SESSION_ID,
      compact_at: '2026-02-12T10:00:00Z',
      wrapup_at: null,
      wrapup_injected: false,
      error_notified: true,
      last_pct: 75,
    })
    const out = runScript({ session_id: SESSION_ID }, e)
    assert.equal(out, '')
  })

  it('outputs nothing for invalid JSON', () => {
    const out = runScript('not json', env())
    assert.equal(out, '')
  })

  it('outputs nothing for missing session_id', () => {
    const out = runScript({ foo: 'bar' }, env())
    assert.equal(out, '')
  })
})
