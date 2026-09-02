import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { writeBaseline } from '../scripts/check-upstream.mjs'

describe('writeBaseline', () => {
  let tempDir

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'baseline-write-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('WITH failed rename preserves the previous baseline', () => {
    const baselinePath = join(tempDir, '.compat-baseline')
    writeFileSync(baselinePath, 'previous\n')

    const operations = {
      renameSync() {
        throw new Error('simulated interruption')
      },
      unlinkSync,
      writeFileSync,
    }

    assert.throws(
      () =>
        writeBaseline(baselinePath, { version: '2.0.0' }, operations),
      /simulated interruption/,
    )
    assert.equal(readFileSync(baselinePath, 'utf8'), 'previous\n')
  })
})
