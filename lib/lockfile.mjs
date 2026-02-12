import {
  constants,
  closeSync,
  openSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs'

// Acquires lock atomically using O_EXCL.
// Returns true if acquired, false if already held.
export function acquireLock(lockPath) {
  try {
    const fd = openSync(
      lockPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    )
    const data = `${process.pid}:${Date.now()}\n`
    const buf = Buffer.from(data, 'utf8')
    writeSync(fd, buf)
    closeSync(fd)
    return true
  } catch (err) {
    if (err.code === 'EEXIST') {
      return false
    }
    throw err
  }
}

// Removes lockfile. Ignores ENOENT.
export function releaseLock(lockPath) {
  try {
    unlinkSync(lockPath)
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err
    }
  }
}

// Returns true if lock exists and is older than maxAgeMs.
export function isLockStale(lockPath, maxAgeMs = 600_000) {
  try {
    const stats = statSync(lockPath)
    return Date.now() - stats.mtimeMs > maxAgeMs
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false
    }
    throw err
  }
}
