import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import {
  acquireLock,
  isLockStale,
  releaseLock,
} from '../lib/lockfile.mjs'

describe('lockfile', () => {
  let tmpDir
  let lockPath

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'seamless-lock-'))
    lockPath = join(tmpDir, 'test.lock')
  })

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('acquireLock', () => {
    it('creates lockfile and returns true', () => {
      const result = acquireLock(lockPath)
      assert.equal(result, true)

      const content = readFileSync(lockPath, 'utf8')
      assert.ok(content.includes(String(process.pid)))
    })

    it('returns false when lock already held', () => {
      const testPath = join(tmpDir, 'test2.lock')
      const firstAcquire = acquireLock(testPath)
      assert.equal(firstAcquire, true)

      const secondAcquire = acquireLock(testPath)
      assert.equal(secondAcquire, false)

      releaseLock(testPath)
    })

    it('lockfile contains PID', () => {
      acquireLock(lockPath)
      const content = readFileSync(lockPath, 'utf8')
      assert.ok(content.includes(String(process.pid)))
      releaseLock(lockPath)
    })
  })

  describe('releaseLock', () => {
    it('removes existing lockfile', () => {
      acquireLock(lockPath)
      releaseLock(lockPath)

      assert.throws(() => readFileSync(lockPath, 'utf8'), /ENOENT/)
    })

    it('does not error on missing file', () => {
      assert.doesNotThrow(() => releaseLock(lockPath))
    })
  })

  describe('isLockStale', () => {
    it('returns false for fresh lock', () => {
      acquireLock(lockPath)
      const stale = isLockStale(lockPath, 10_000)
      assert.equal(stale, false)
      releaseLock(lockPath)
    })

    it('returns true for old lock', () => {
      acquireLock(lockPath)

      const oldTime = Date.now() - 20_000
      utimesSync(lockPath, new Date(oldTime), new Date(oldTime))

      const stale = isLockStale(lockPath, 10_000)
      assert.equal(stale, true)
      releaseLock(lockPath)
    })

    it('returns false for missing file', () => {
      const stale = isLockStale(lockPath)
      assert.equal(stale, false)
    })
  })
})
