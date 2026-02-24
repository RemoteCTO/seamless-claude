#!/usr/bin/env node
/**
 * Compatibility check for Claude Code upstream changes.
 *
 * Compares installed Claude Code version against the
 * tracked baseline, scans release notes for keywords
 * that touch our integration surface, and runs a
 * contract smoke test.
 *
 * Usage: node scripts/check-upstream.mjs [--update]
 */

import { execSync, spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_PATH = join(ROOT, '.compat-baseline')
const UPDATE = process.argv.includes('--update')

const KEYWORDS = [
  'hook',
  'PreCompact',
  'SessionStart',
  'UserPromptSubmit',
  'statusLine',
  'statusline',
  'compac',
  'autocompact',
  'transcript',
  'plugin',
  '-p ',
  'stream-json',
  'CLAUDECODE',
  'context_window',
  'session_id',
  'print mode',
]

function getInstalledVersion() {
  try {
    const raw = execSync('claude --version', {
      encoding: 'utf8',
      timeout: 5000,
    }).trim()
    const match = raw.match(/(\d+\.\d+\.\d+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

function readBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  } catch {
    return null
  }
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

async function fetchReleases(baseline, current) {
  const url =
    'https://api.github.com/repos/' +
    'anthropics/claude-code/releases?per_page=50'
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${res.statusText}`)
  }
  const releases = await res.json()
  return releases.filter((r) => {
    const m = r.tag_name.match(/(\d+\.\d+\.\d+)/)
    if (!m) return false
    const v = m[1]
    return (
      compareVersions(v, baseline) > 0 &&
      compareVersions(v, current) <= 0
    )
  })
}

function scanRelease(release) {
  const body = release.body || ''
  const tag = release.tag_name
  const matches = []
  for (const kw of KEYWORDS) {
    if (body.includes(kw)) {
      const line = body.split('\n').find((l) => l.includes(kw))
      const context = line ? line.trim().slice(0, 60) : '(in body)'
      matches.push({ tag, keyword: kw, context })
    }
  }
  return matches
}

function runContractTest() {
  return new Promise((resolve) => {
    const start = Date.now()
    const child = spawn(
      'claude',
      [
        '-p',
        '--model',
        'sonnet',
        '--no-session-persistence',
        '--output-format',
        'text',
        '--system-prompt',
        'test',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )

    let stdout = ''
    child.stdout.on('data', (d) => {
      stdout += d.toString()
    })

    const timer = setTimeout(() => {
      child.kill()
      resolve({ pass: false, reason: 'timeout (15s)' })
    }, 15000)

    child.on('error', () => {
      clearTimeout(timer)
      resolve({
        pass: false,
        reason: 'claude binary not found',
      })
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      const elapsed = ((Date.now() - start) / 1000).toFixed(1)
      if (code === 0 && stdout.length > 0) {
        resolve({ pass: true, elapsed })
      } else {
        resolve({
          pass: false,
          reason: `exit ${code}, ${stdout.length} bytes`,
        })
      }
    })

    child.stdin.write('reply OK')
    child.stdin.end()
  })
}

async function main() {
  const current = getInstalledVersion()
  if (!current) {
    console.error('Could not detect Claude Code version.')
    process.exit(1)
  }

  const baseline = readBaseline()
  if (!baseline) {
    console.error(
      'No .compat-baseline found. Run with --update' +
        ' to create one.',
    )
    process.exit(1)
  }

  console.log('seamless-claude compatibility check')
  console.log('====================================')
  console.log(
    `Baseline: ${baseline.version}` +
      ` (${baseline.checked_at.slice(0, 10)})`,
  )
  console.log(`Current:  ${current}`)

  if (compareVersions(current, baseline.version) <= 0) {
    console.log('\nUp to date. No new releases.\n')
    process.exit(0)
  }

  const releases = await fetchReleases(baseline.version, current)
  console.log(`Releases: ${releases.length}\n`)

  const allMatches = releases.flatMap(scanRelease)

  console.log('## Keyword Matches')
  if (allMatches.length === 0) {
    console.log('None — no integration surface hits.\n')
  } else {
    for (const m of allMatches) {
      console.log(`${m.tag}: "${m.keyword}" (${m.context})`)
    }
    console.log()
  }

  console.log('## Contract Test')
  const test = await runContractTest()
  if (test.pass) {
    console.log(`claude -p: PASS (v${current}, ${test.elapsed}s)`)
  } else {
    console.log(`claude -p: FAIL (${test.reason})`)
  }

  console.log()
  console.log('## Verdict')
  if (allMatches.length === 0 && test.pass) {
    console.log('CLEAR — no keyword matches, contract OK.')
  } else if (allMatches.length > 0) {
    const tags = [...new Set(allMatches.map((m) => m.tag))]
    console.log(
      `REVIEW NEEDED — ${allMatches.length} keyword` +
        ` match(es) across ${tags.length} release(s).`,
    )
  }
  if (!test.pass) {
    console.log(`CONTRACT FAIL — ${test.reason}`)
  }

  console.log('\nRun with --update to set new baseline.\n')

  if (UPDATE) {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, 'package.json'), 'utf8'),
    )
    const data = {
      version: current,
      checked_at: new Date().toISOString(),
      seamless_version: pkg.version,
    }
    writeFileSync(BASELINE_PATH, `${JSON.stringify(data, null, 2)}\n`)
    console.log(`.compat-baseline updated to ${current}.\n`)
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`)
  process.exit(1)
})
