import { randomUUID } from 'node:crypto'
import { renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const defaultOperations = {
  renameSync,
  unlinkSync,
  writeFileSync,
}

export function atomicWriteFileSync(
  filePath,
  data,
  options = {},
  operations = defaultOperations,
) {
  const temporaryName = [
    '',
    basename(filePath),
    process.pid,
    randomUUID(),
    'tmp',
  ].join('.')
  const temporaryPath = join(dirname(filePath), temporaryName)

  try {
    operations.writeFileSync(temporaryPath, data, options)
    operations.renameSync(temporaryPath, filePath)
  } catch (error) {
    try {
      operations.unlinkSync(temporaryPath)
    } catch {}
    throw error
  }
}
