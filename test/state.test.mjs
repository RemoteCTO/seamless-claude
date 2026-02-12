import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import {
  STATE_DIR,
  readState,
  shouldCompact,
  shouldWrapUp,
  writeState,
} from '../lib/state.mjs'

describe('state', () => {
  let tempDir

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'state-test-'))
    process.env.SEAMLESS_STATE_DIR = tempDir
  })

  after(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  const validId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

  describe('STATE_DIR export', () => {
    it('is defined', () => {
      assert.ok(STATE_DIR)
    })
  })

  describe('readState', () => {
    it('returns defaults for missing file', () => {
      const state = readState(validId)
      assert.equal(state.session_id, validId)
      assert.equal(state.compact_at, null)
      assert.equal(state.wrapup_at, null)
      assert.equal(state.wrapup_injected, false)
      assert.equal(state.last_pct, 0)
    })

    it('returns saved state after writeState', () => {
      const savedState = {
        session_id: validId,
        compact_at: '2026-02-12T10:00:00.000Z',
        wrapup_at: null,
        wrapup_injected: false,
        last_pct: 73.5,
      }
      writeState(validId, savedState)
      const loaded = readState(validId)
      assert.deepEqual(loaded, savedState)
    })

    it('rejects invalid session IDs', () => {
      assert.throws(
        () => readState('not-a-uuid'),
        /Invalid session ID format/,
      )
    })

    it('rejects path traversal attempts', () => {
      assert.throws(
        () => readState('../../../etc/passwd'),
        /Invalid session ID format/,
      )
    })
  })

  describe('writeState', () => {
    it('creates file with 0o600 permissions', () => {
      const state = {
        session_id: validId,
        compact_at: null,
        wrapup_at: null,
        wrapup_injected: false,
        last_pct: 42.0,
      }
      writeState(validId, state)

      const filePath = join(tempDir, `${validId}.json`)
      const stats = statSync(filePath)
      const mode = stats.mode & 0o777
      assert.equal(mode, 0o600)
    })

    it('creates STATE_DIR if missing', () => {
      const newTempDir = mkdtempSync(join(tmpdir(), 'state-missing-'))
      process.env.SEAMLESS_STATE_DIR = newTempDir
      rmSync(newTempDir, { recursive: true, force: true })

      const state = {
        session_id: validId,
        compact_at: null,
        wrapup_at: null,
        wrapup_injected: false,
        last_pct: 0,
      }
      writeState(validId, state)

      const filePath = join(newTempDir, `${validId}.json`)
      assert.doesNotThrow(() => statSync(filePath))

      rmSync(newTempDir, { recursive: true, force: true })
      process.env.SEAMLESS_STATE_DIR = tempDir
    })

    it('rejects invalid session IDs', () => {
      const state = {
        session_id: 'not-a-uuid',
        compact_at: null,
        wrapup_at: null,
        wrapup_injected: false,
        last_pct: 0,
      }
      assert.throws(
        () => writeState('not-a-uuid', state),
        /Invalid session ID format/,
      )
    })
  })

  describe('shouldCompact', () => {
    it('returns true at threshold', () => {
      const state = {
        session_id: validId,
        compact_at: null,
        wrapup_at: null,
        wrapup_injected: false,
        last_pct: 65,
      }
      assert.equal(shouldCompact(state, 70, 70), true)
    })

    it('returns true above threshold', () => {
      const state = {
        session_id: validId,
        compact_at: null,
        wrapup_at: null,
        wrapup_injected: false,
        last_pct: 65,
      }
      assert.equal(shouldCompact(state, 75, 70), true)
    })

    it('returns false below threshold', () => {
      const state = {
        session_id: validId,
        compact_at: null,
        wrapup_at: null,
        wrapup_injected: false,
        last_pct: 50,
      }
      assert.equal(shouldCompact(state, 65, 70), false)
    })

    it('returns false after compact_at set', () => {
      const state = {
        session_id: validId,
        compact_at: '2026-02-12T10:00:00.000Z',
        wrapup_at: null,
        wrapup_injected: false,
        last_pct: 70,
      }
      assert.equal(shouldCompact(state, 75, 70), false)
    })
  })

  describe('shouldWrapUp', () => {
    it('returns true at threshold', () => {
      const state = {
        session_id: validId,
        compact_at: '2026-02-12T10:00:00.000Z',
        wrapup_at: null,
        wrapup_injected: false,
        last_pct: 85,
      }
      assert.equal(shouldWrapUp(state, 90, 90), true)
    })

    it('returns true above threshold', () => {
      const state = {
        session_id: validId,
        compact_at: '2026-02-12T10:00:00.000Z',
        wrapup_at: null,
        wrapup_injected: false,
        last_pct: 85,
      }
      assert.equal(shouldWrapUp(state, 95, 90), true)
    })

    it('returns false below threshold', () => {
      const state = {
        session_id: validId,
        compact_at: '2026-02-12T10:00:00.000Z',
        wrapup_at: null,
        wrapup_injected: false,
        last_pct: 85,
      }
      assert.equal(shouldWrapUp(state, 85, 90), false)
    })

    it('returns false after wrapup_at set', () => {
      const state = {
        session_id: validId,
        compact_at: '2026-02-12T10:00:00.000Z',
        wrapup_at: '2026-02-12T11:00:00.000Z',
        wrapup_injected: false,
        last_pct: 90,
      }
      assert.equal(shouldWrapUp(state, 95, 90), false)
    })
  })
})
