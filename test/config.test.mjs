import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  SESSIONS_DIR,
  sessionPaths,
  validateSessionId,
} from '../lib/config.mjs'

describe('config', () => {
  describe('validateSessionId', () => {
    it('returns valid UUID unchanged', () => {
      const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      assert.equal(validateSessionId(id), id)
    })

    it('throws on empty string', () => {
      assert.throws(
        () => validateSessionId(''),
        /Session ID is required/,
      )
    })

    it('throws on null', () => {
      assert.throws(
        () => validateSessionId(null),
        /Session ID is required/,
      )
    })

    it('throws on undefined', () => {
      assert.throws(
        () => validateSessionId(undefined),
        /Session ID is required/,
      )
    })

    it('throws on non-UUID string', () => {
      assert.throws(
        () => validateSessionId('not-a-uuid'),
        /Invalid session ID format/,
      )
    })

    it('throws on path traversal attempt', () => {
      assert.throws(
        () => validateSessionId('../../../etc/passwd'),
        /Invalid session ID format/,
      )
    })

    it('throws on path separators', () => {
      const idWithPath =
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890/../../etc'
      assert.throws(
        () => validateSessionId(idWithPath),
        /Invalid session ID format/,
      )
    })

    it('accepts UUID with mixed case', () => {
      const id = 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890'
      assert.equal(validateSessionId(id), id)
    })
  })

  describe('sessionPaths', () => {
    it('returns object with md, json, log, lock keys', () => {
      const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      const paths = sessionPaths(id)

      assert.ok(paths.md)
      assert.ok(paths.json)
      assert.ok(paths.log)
      assert.ok(paths.lock)
    })

    it('all paths end with the session ID', () => {
      const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      const paths = sessionPaths(id)

      assert.ok(paths.md.endsWith(`${id}.md`))
      assert.ok(paths.json.endsWith(`${id}.json`))
      assert.ok(paths.log.endsWith(`${id}.log`))
      assert.ok(paths.lock.endsWith(`${id}.lock`))
    })

    it('all paths are under SESSIONS_DIR', () => {
      const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      const paths = sessionPaths(id)

      assert.ok(paths.md.startsWith(SESSIONS_DIR))
      assert.ok(paths.json.startsWith(SESSIONS_DIR))
      assert.ok(paths.log.startsWith(SESSIONS_DIR))
      assert.ok(paths.lock.startsWith(SESSIONS_DIR))
    })
  })
})
