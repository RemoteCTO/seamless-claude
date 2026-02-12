import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { SESSIONS_DIR } from './config.mjs'

// Returns { path, mtime }[] sorted by mtime desc, max 10.
export function getMetaFiles(dir = SESSIONS_DIR) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({
      path: join(dir, f),
      mtime: statSync(join(dir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 10)
}

// Finds session by ID, prefix, or --latest.
// Returns parsed metadata object or null.
export async function findSession(arg, dir = SESSIONS_DIR) {
  const files = getMetaFiles(dir)
  if (files.length === 0) return null

  if (!arg || arg === '--latest') {
    return JSON.parse(await readFile(files[0].path, 'utf8'))
  }

  // Exact match
  const exact = join(dir, `${arg}.json`)
  if (existsSync(exact)) {
    return JSON.parse(await readFile(exact, 'utf8'))
  }

  // Prefix match
  const matches = files.filter((f) =>
    basename(f.path, '.json').startsWith(arg),
  )
  if (matches.length === 1) {
    return JSON.parse(await readFile(matches[0].path, 'utf8'))
  }
  if (matches.length > 1) {
    console.error(
      `Ambiguous prefix '${arg}' — ${matches.length} matches`,
    )
    return null
  }

  return null
}

// Prints session list to console.log.
export async function listSessions(dir = SESSIONS_DIR) {
  const files = getMetaFiles(dir)
  if (files.length === 0) {
    console.error('No sessions available.')
    return
  }
  for (const { path } of files) {
    const meta = JSON.parse(await readFile(path, 'utf8'))
    const id = meta.session_id
    const short = id.slice(0, 8)
    const ts = meta.generated_at || '?'
    const model = meta.model || '?'
    const entries = meta.transcript_entries || 0
    console.log(`${short}  ${ts}  ${model}  ${entries} entries`)
  }
}
