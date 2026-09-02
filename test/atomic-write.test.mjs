import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { atomicWriteFileSync } from '../lib/atomic-write.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HELPER = join(__dirname, '..', 'lib', 'atomic-write.mjs')

function runWriter(filePath, value) {
  const helperPath = HELPER.replaceAll('\\', '\\\\')
  const source = [
    `import { atomicWriteFileSync } from '${helperPath}';`,
    `const filePath = ${JSON.stringify(filePath)};`,
    `const value = ${JSON.stringify(value)};`,
    'for (let index = 0; index < 300; index += 1) {',
    '  atomicWriteFileSync(filePath, value, { mode: 0o600 });',
    '}',
  ].join('\n')

  return spawn(process.execPath, ['--input-type=module', '-e', source])
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`writer exited with code ${code}`))
      }
    })
  })
}

describe('atomicWriteFileSync', () => {
  let tempDir

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'atomic-write-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('WITH failed rename preserves the previous file', () => {
    const filePath = join(tempDir, 'state.json')
    writeFileSync(filePath, 'previous', { mode: 0o600 })

    const operations = {
      renameSync() {
        throw new Error('simulated interruption')
      },
      unlinkSync,
      writeFileSync,
    }

    assert.throws(
      () =>
        atomicWriteFileSync(filePath, 'replacement', {}, operations),
      /simulated interruption/,
    )
    assert.equal(readFileSync(filePath, 'utf8'), 'previous')
  })

  it('WITH a write records the temporary file beside the target', () => {
    const filePath = join(tempDir, 'state.json')
    let temporaryPath
    const operations = {
      renameSync,
      unlinkSync,
      writeFileSync(path, data, options) {
        temporaryPath = path
        writeFileSync(path, data, options)
      },
    }

    atomicWriteFileSync(filePath, 'complete', {}, operations)

    assert.equal(dirname(temporaryPath), dirname(filePath))
    assert.notEqual(temporaryPath, filePath)
  })

  it('WITH mode 0o600 is never wider before or after rename', () => {
    const filePath = join(tempDir, 'state.json')
    let temporaryMode
    const operations = {
      renameSync(source, target) {
        temporaryMode = statSync(source).mode & 0o777
        renameSync(source, target)
      },
      unlinkSync,
      writeFileSync,
    }

    atomicWriteFileSync(
      filePath,
      'private',
      { mode: 0o600 },
      operations,
    )

    assert.equal(temporaryMode, 0o600)
    assert.equal(statSync(filePath).mode & 0o777, 0o600)
  })

  it('WITH concurrent writers never exposes partial content', async () => {
    const filePath = join(tempDir, 'status.json')
    const values = [
      JSON.stringify({ writer: 'a', body: 'a'.repeat(32_768) }),
      JSON.stringify({ writer: 'b', body: 'b'.repeat(32_768) }),
    ]
    writeFileSync(filePath, values[0], { mode: 0o600 })
    const writers = values.map((value) => runWriter(filePath, value))
    let reads = 0

    const reader = setInterval(() => {
      const content = readFileSync(filePath, 'utf8')
      assert.ok(values.includes(content))
      JSON.parse(content)
      reads += 1
    })

    try {
      await Promise.all(writers.map(waitForExit))
    } finally {
      clearInterval(reader)
    }

    assert.ok(reads > 0)
  })
})
