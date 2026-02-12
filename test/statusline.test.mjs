import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildBar,
  formatLine,
  lastLogLine,
  resolveStatus,
} from '../lib/statusline.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(__dirname, '..', 'scripts', 'statusline.mjs')
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
  return result.trim()
}

describe('statusline', () => {
  describe('buildBar', () => {
    it('returns all empty at 0%', () => {
      assert.equal(buildBar(0), '░░░░░░░░░░░░░░░░░░░░')
    })

    it('returns all filled at 100%', () => {
      assert.equal(buildBar(100), '████████████████████')
    })

    it('returns 10 filled at 50%', () => {
      assert.equal(buildBar(50), '██████████░░░░░░░░░░')
    })

    it('returns 14 filled at 70%', () => {
      assert.equal(buildBar(70), '██████████████░░░░░░')
    })

    it('rounds correctly at 73%', () => {
      // 73% of 20 = 14.6 → rounds to 15
      const bar = buildBar(73)
      const filled = (bar.match(/█/g) || []).length
      assert.equal(filled, 15)
    })

    it('is always 20 characters', () => {
      for (const pct of [0, 25, 33, 50, 67, 75, 100]) {
        assert.equal(
          [...buildBar(pct)].length,
          20,
          `bar at ${pct}% should be 20 chars`,
        )
      }
    })
  })

  describe('resolveStatus', () => {
    it('returns idle when no compact_at', () => {
      const state = { compact_at: null }
      assert.equal(resolveStatus(state, 45, false), 'idle')
    })

    it('returns compacting when compact_at set', () => {
      const state = {
        compact_at: '2026-02-12T10:00:00Z',
      }
      assert.equal(resolveStatus(state, 72, false), 'compacting')
    })

    it('returns ready when summary exists', () => {
      const state = {
        compact_at: '2026-02-12T10:00:00Z',
      }
      assert.equal(resolveStatus(state, 75, true), 'ready')
    })

    it('returns wrapup at wrapup threshold', () => {
      const state = {
        compact_at: '2026-02-12T10:00:00Z',
      }
      assert.equal(resolveStatus(state, 90, true), 'wrapup')
    })

    it('returns wrapup above wrapup threshold', () => {
      const state = {
        compact_at: '2026-02-12T10:00:00Z',
      }
      assert.equal(resolveStatus(state, 95, false), 'wrapup')
    })

    it('wrapup overrides ready status', () => {
      const state = {
        compact_at: '2026-02-12T10:00:00Z',
      }
      assert.equal(resolveStatus(state, 92, true), 'wrapup')
    })

    it('returns error when lock stale and no summary', () => {
      const state = {
        compact_at: '2026-02-12T10:00:00Z',
      }
      assert.equal(resolveStatus(state, 75, false, true), 'error')
    })

    it('returns compacting when lock not stale', () => {
      const state = {
        compact_at: '2026-02-12T10:00:00Z',
      }
      assert.equal(resolveStatus(state, 75, false, false), 'compacting')
    })

    it('returns ready even with stale lock', () => {
      const state = {
        compact_at: '2026-02-12T10:00:00Z',
      }
      assert.equal(resolveStatus(state, 75, true, true), 'ready')
    })

    it('wrapup overrides error status', () => {
      const state = {
        compact_at: '2026-02-12T10:00:00Z',
      }
      assert.equal(resolveStatus(state, 92, false, true), 'wrapup')
    })
  })

  describe('formatLine', () => {
    it('shows bar only when idle', () => {
      const line = formatLine(45, 'idle', 'a1b2c3d4')
      assert.equal(line, 'seamless: 45% █████████░░░░░░░░░░░')
    })

    it('includes icon when compacting', () => {
      const line = formatLine(73, 'compacting', 'a1b2c3d4')
      assert.match(line, /🔄/)
      assert.match(line, /a1b2c3d4/)
    })

    it('includes icon when ready', () => {
      const line = formatLine(80, 'ready', 'deadbeef')
      assert.match(line, /✅/)
      assert.match(line, /deadbeef/)
    })

    it('includes icon when wrapup', () => {
      const line = formatLine(92, 'wrapup', 'cafebabe')
      assert.match(line, /⚠️/)
      assert.match(line, /cafebabe/)
    })

    it('includes icon when error', () => {
      const line = formatLine(75, 'error', 'deadbeef')
      assert.match(line, /❌/)
      assert.match(line, /deadbeef/)
    })

    it('omits session hash when idle', () => {
      const line = formatLine(30, 'idle', 'a1b2c3d4')
      assert.ok(
        !line.includes('a1b2c3d4'),
        'idle line should not include hash',
      )
    })

    it('starts with seamless: prefix', () => {
      const line = formatLine(50, 'idle', 'a1b2c3d4')
      assert.match(line, /^seamless:/)
    })

    it('includes percentage', () => {
      const line = formatLine(73, 'compacting', 'a1b2c3d4')
      assert.match(line, /73%/)
    })
  })

  describe('lastLogLine', () => {
    it('returns last line from multi-line log', () => {
      const log = [
        '[10:00:00] Starting compaction',
        '[10:00:05] Extracted 42 entries',
        '[10:00:30] Attempt 1 failed: timeout',
      ].join('\n')
      assert.equal(
        lastLogLine(log),
        '[10:00:30] Attempt 1 failed: timeout',
      )
    })

    it('handles trailing newline', () => {
      assert.equal(lastLogLine('line one\nline two\n'), 'line two')
    })

    it('returns single line as-is', () => {
      assert.equal(lastLogLine('only line'), 'only line')
    })

    it('returns empty string for empty input', () => {
      assert.equal(lastLogLine(''), '')
    })

    it('returns empty string for null', () => {
      assert.equal(lastLogLine(null), '')
    })

    it('returns empty string for undefined', () => {
      assert.equal(lastLogLine(undefined), '')
    })
  })

  describe('script integration', () => {
    let tempState
    let tempData

    before(() => {
      tempState = mkdtempSync(join(tmpdir(), 'sl-state-'))
      tempData = mkdtempSync(join(tmpdir(), 'sl-data-'))
    })

    after(() => {
      rmSync(tempState, { recursive: true, force: true })
      rmSync(tempData, { recursive: true, force: true })
    })

    function env() {
      return {
        SEAMLESS_STATE_DIR: tempState,
        SEAMLESS_DATA_DIR: tempData,
        SEAMLESS_STATUS_PATH: join(tempData, 'status.json'),
      }
    }

    it('shows fallback for invalid JSON', () => {
      const out = runScript('not json', env())
      assert.match(out, /seamless: --% ░/)
    })

    it('shows fallback for missing session_id', () => {
      const out = runScript(
        {
          context_window: { used_percentage: 50 },
        },
        env(),
      )
      assert.match(out, /seamless: --% ░/)
    })

    it('shows fallback for null pct', () => {
      const out = runScript(
        {
          session_id: SESSION_ID,
          context_window: { used_percentage: null },
        },
        env(),
      )
      assert.match(out, /seamless: --% ░/)
    })

    it('shows fallback for invalid session ID', () => {
      const out = runScript(
        {
          session_id: 'not-a-uuid',
          context_window: { used_percentage: 50 },
        },
        env(),
      )
      assert.match(out, /seamless: --% ░/)
    })

    it('shows bar for valid low-pct input', () => {
      const out = runScript(
        {
          session_id: SESSION_ID,
          cwd: '/tmp',
          context_window: { used_percentage: 45 },
        },
        env(),
      )
      assert.match(out, /seamless: 45%/)
      assert.match(out, /█/)
    })

    it('omits hash below compact threshold', () => {
      const out = runScript(
        {
          session_id: SESSION_ID,
          cwd: '/tmp',
          context_window: { used_percentage: 30 },
        },
        env(),
      )
      assert.ok(
        !out.includes(SESSION_ID.slice(0, 8)),
        'should not show session hash when idle',
      )
    })

    it('writes status.json', () => {
      const e = env()
      runScript(
        {
          session_id: SESSION_ID,
          cwd: '/tmp',
          context_window: { used_percentage: 55 },
        },
        e,
      )
      const statusPath = e.SEAMLESS_STATUS_PATH
      assert.ok(existsSync(statusPath), 'status.json should exist')
      const status = JSON.parse(readFileSync(statusPath, 'utf8'))
      assert.equal(status.pct, 55)
      assert.equal(status.session_id, SESSION_ID)
      assert.equal(status.session_short, SESSION_ID.slice(0, 8))
      assert.equal(status.status, 'idle')
    })

    it('delegates to SEAMLESS_DISPLAY_CMD', () => {
      const e = {
        ...env(),
        SEAMLESS_DISPLAY_CMD: 'echo "custom:$SEAMLESS_PCT"',
      }
      const out = runScript(
        {
          session_id: SESSION_ID,
          cwd: '/tmp',
          context_window: { used_percentage: 42 },
        },
        e,
      )
      assert.equal(out, 'custom:42')
    })

    it('falls back when DISPLAY_CMD fails', () => {
      const e = {
        ...env(),
        SEAMLESS_DISPLAY_CMD: 'exit 1',
      }
      const out = runScript(
        {
          session_id: SESSION_ID,
          cwd: '/tmp',
          context_window: { used_percentage: 42 },
        },
        e,
      )
      assert.match(out, /seamless: 42%/)
    })

    it('passes env vars to DISPLAY_CMD', () => {
      const e = {
        ...env(),
        SEAMLESS_DISPLAY_CMD:
          'echo "$SEAMLESS_STATUS:$SEAMLESS_SESSION_SHORT"',
      }
      const out = runScript(
        {
          session_id: SESSION_ID,
          cwd: '/tmp',
          context_window: { used_percentage: 42 },
        },
        e,
      )
      assert.equal(out, `idle:${SESSION_ID.slice(0, 8)}`)
    })

    it('writes state for session', () => {
      const e = env()
      runScript(
        {
          session_id: SESSION_ID,
          cwd: '/tmp',
          context_window: { used_percentage: 60 },
        },
        e,
      )
      const stateFile = join(e.SEAMLESS_STATE_DIR, `${SESSION_ID}.json`)
      assert.ok(existsSync(stateFile), 'state file should exist')
      const state = JSON.parse(readFileSync(stateFile, 'utf8'))
      assert.equal(state.last_pct, 60)
      assert.equal(state.session_id, SESSION_ID)
    })

    it('includes error details in status.json', () => {
      const e = env()
      // Pre-populate state as if compaction started
      const stateFile = join(e.SEAMLESS_STATE_DIR, `${SESSION_ID}.json`)
      writeFileSync(
        stateFile,
        JSON.stringify({
          session_id: SESSION_ID,
          compact_at: '2026-02-12T10:00:00Z',
          wrapup_at: null,
          wrapup_injected: false,
          error_notified: false,
          last_pct: 70,
        }),
        { mode: 0o600 },
      )
      // Write a fake log file in sessions dir
      const sessDir = join(e.SEAMLESS_DATA_DIR, 'sessions')
      mkdirSync(sessDir, { recursive: true })
      writeFileSync(
        join(sessDir, `${SESSION_ID}.log`),
        '[10:00:30] Attempt 2 failed: timeout\n',
      )
      // No .md file, no .lock file → error state
      const out = runScript(
        {
          session_id: SESSION_ID,
          cwd: '/tmp',
          context_window: { used_percentage: 75 },
        },
        e,
      )
      assert.match(out, /❌/)
      const status = JSON.parse(
        readFileSync(e.SEAMLESS_STATUS_PATH, 'utf8'),
      )
      assert.equal(status.status, 'error')
      assert.ok(status.log_path, 'should include log_path')
      assert.match(status.error_message, /Attempt 2 failed: timeout/)
    })
  })
})
