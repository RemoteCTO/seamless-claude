import { spawn } from 'node:child_process'
import {
  constants,
  accessSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

/**
 * Discover executable hook scripts in a directory.
 * Returns sorted array of absolute paths.
 * Skips dotfiles and non-executable entries.
 */
export async function discoverHooks(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const hooks = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (entry.name.startsWith('.')) continue

    const fullPath = join(dir, entry.name)
    try {
      accessSync(fullPath, constants.X_OK)
    } catch {
      continue
    }
    hooks.push(fullPath)
  }

  return hooks.sort((a, b) => basename(a).localeCompare(basename(b)))
}

/**
 * Run a single hook script. Captures stdout.
 * Returns { name, stdout, exitCode, timedOut }.
 * Never throws — failures are returned in the result.
 */
export function runHook(scriptPath, env, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(scriptPath, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      detached: true,
    })

    let stdout = ''
    let timedOut = false

    child.stdout.on('data', (d) => {
      stdout += d
    })
    // stderr intentionally ignored

    const timer = setTimeout(() => {
      timedOut = true
      // Kill entire process group (shell + children)
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }, timeoutMs)

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        name: basename(scriptPath),
        stdout: stdout.trimEnd(),
        exitCode: timedOut ? -1 : (code ?? 1),
        timedOut,
      })
    })

    child.on('error', () => {
      clearTimeout(timer)
      resolve({
        name: basename(scriptPath),
        stdout: '',
        exitCode: -1,
        timedOut: false,
      })
    })
  })
}

/**
 * Run all hooks in hooks.d for a session.
 * Returns array of results with collected file output.
 *
 * Options:
 *   hooksDir  — override hooks directory (for testing)
 *   timeoutMs — per-hook timeout (default: 60000)
 */
export async function runAllHooks(
  sessionId,
  transcriptPath,
  summaryPath,
  opts = {},
) {
  const { hooksDir, timeoutMs = 60_000 } = opts

  const hooks = await discoverHooks(hooksDir)
  if (hooks.length === 0) return []

  const outputDir = mkdtempSync(join(tmpdir(), 'seamless-hooks-'))

  const env = {
    SEAMLESS_SESSION_ID: sessionId,
    SEAMLESS_TRANSCRIPT: transcriptPath,
    SEAMLESS_SUMMARY: summaryPath,
    SEAMLESS_OUTPUT_DIR: outputDir,
  }

  const results = []
  for (const hook of hooks) {
    const result = await runHook(hook, env, timeoutMs)

    // Collect any .md files written to OUTPUT_DIR
    let files = []
    try {
      const entries = readdirSync(outputDir)
      files = entries
        .filter((f) => f.endsWith('.md'))
        .sort()
        .map((f) => ({
          name: f,
          content: readFileSync(join(outputDir, f), 'utf8').trimEnd(),
        }))
      // Clean collected files for next hook
      for (const f of entries) {
        try {
          rmSync(join(outputDir, f))
        } catch {
          // ignore
        }
      }
    } catch {
      // empty or inaccessible — fine
    }

    results.push({ ...result, files })
  }

  // Clean up temp dir
  try {
    rmSync(outputDir, { recursive: true })
  } catch {
    // ignore
  }

  return results
}

/**
 * Format hook results into markdown sections for
 * appending to a session summary.
 * Only includes hooks that produced output.
 */
export function formatHookOutput(results) {
  const sections = []
  for (const r of results) {
    const parts = []
    if (r.stdout) parts.push(r.stdout)
    if (r.files) {
      for (const f of r.files) {
        if (f.content) parts.push(f.content)
      }
    }
    if (parts.length === 0) continue

    sections.push(
      `## Post-compaction: ${r.name}\n\n${parts.join('\n\n')}`,
    )
  }
  return sections.join('\n\n')
}
