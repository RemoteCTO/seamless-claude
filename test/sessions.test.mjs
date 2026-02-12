import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { findSession, getMetaFiles } from '../lib/sessions.mjs'

describe('sessions', () => {
  let tmpDir

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'seamless-test-'))
  })

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('getMetaFiles', () => {
    it('returns entries for fixture directory with metadata', () => {
      const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      const metaPath = join(tmpDir, `${id}.json`)
      const meta = {
        session_id: id,
        generated_at: '2026-02-12T10:00:00Z',
        model: 'sonnet',
        transcript_entries: 10,
      }
      writeFileSync(metaPath, JSON.stringify(meta, null, 2))

      const files = getMetaFiles(tmpDir)
      assert.equal(files.length, 1)
      assert.ok(files[0].path.endsWith('.json'))
      assert.ok(files[0].mtime > 0)
    })

    it('returns empty array for empty directory', () => {
      const emptyDir = mkdtempSync(join(tmpdir(), 'seamless-empty-'))
      const files = getMetaFiles(emptyDir)
      assert.deepEqual(files, [])
      rmSync(emptyDir, { recursive: true })
    })

    it('returns empty array for non-existent directory', () => {
      const nonExistent = join(tmpDir, 'does-not-exist')
      const files = getMetaFiles(nonExistent)
      assert.deepEqual(files, [])
    })
  })

  describe('findSession', () => {
    let id1
    let id2
    let meta1
    let meta2

    before(() => {
      id1 = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      id2 = 'b2c3d4e5-f6a7-8901-bcde-ef2345678901'

      meta1 = {
        session_id: id1,
        generated_at: '2026-02-12T10:00:00Z',
        model: 'sonnet',
        transcript_entries: 10,
      }

      meta2 = {
        session_id: id2,
        generated_at: '2026-02-12T11:00:00Z',
        model: 'opus',
        transcript_entries: 15,
      }

      writeFileSync(
        join(tmpDir, `${id1}.json`),
        JSON.stringify(meta1, null, 2),
      )

      setTimeout(() => {
        writeFileSync(
          join(tmpDir, `${id2}.json`),
          JSON.stringify(meta2, null, 2),
        )
      }, 10)
    })

    it('returns most recent with --latest', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))

      const session = await findSession('--latest', tmpDir)
      assert.ok(session)
      assert.equal(session.session_id, id2)
    })

    it('returns matching session with exact ID', async () => {
      const session = await findSession(id1, tmpDir)
      assert.ok(session)
      assert.equal(session.session_id, id1)
      assert.equal(session.model, 'sonnet')
    })

    it('returns matching session with short prefix', async () => {
      const prefix = id1.slice(0, 8)
      const session = await findSession(prefix, tmpDir)
      assert.ok(session)
      assert.equal(session.session_id, id1)
    })

    it('returns null for ambiguous prefix', async () => {
      const id3 = 'a1b2c3d4-ffff-7890-abcd-ef1234567890'
      const meta3 = {
        session_id: id3,
        generated_at: '2026-02-12T12:00:00Z',
        model: 'sonnet',
        transcript_entries: 5,
      }
      writeFileSync(
        join(tmpDir, `${id3}.json`),
        JSON.stringify(meta3, null, 2),
      )

      const ambiguousPrefix = 'a1b2c3d4'
      const session = await findSession(ambiguousPrefix, tmpDir)
      assert.equal(session, null)
    })

    it('returns null for non-existent ID', async () => {
      const session = await findSession(
        'ffffffff-ffff-ffff-ffff-ffffffffffff',
        tmpDir,
      )
      assert.equal(session, null)
    })

    it('returns null for empty directory', async () => {
      const emptyDir = mkdtempSync(join(tmpdir(), 'seamless-empty-'))
      const session = await findSession('--latest', emptyDir)
      assert.equal(session, null)
      rmSync(emptyDir, { recursive: true })
    })
  })
})
