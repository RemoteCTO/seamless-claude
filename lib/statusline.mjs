/**
 * Pure functions for statusline display.
 *
 * Extracted from scripts/statusline.mjs for testability.
 * No side effects — no filesystem, no process spawning.
 */

import { WRAPUP_PCT } from './config.mjs'

const STATUS_ICONS = {
  idle: '',
  compacting: '🔄',
  ready: '✅',
  wrapup: '⚠️',
  error: '❌',
}

/**
 * Build a 20-character progress bar.
 * @param {number} pct - Percentage (0-100)
 * @returns {string} Bar like "██████████░░░░░░░░░░"
 */
export function buildBar(pct) {
  const filled = Math.round((pct / 100) * 20)
  return '█'.repeat(filled) + '░'.repeat(20 - filled)
}

/**
 * Resolve the current seamless status.
 * @param {object} state - Session state
 * @param {number} pct - Current context usage %
 * @param {boolean} summaryExists - Whether .md exists
 * @param {boolean} lockStale - Lock missing or stale
 * @returns {string} idle|compacting|ready|wrapup|error
 */
export function resolveStatus(state, pct, summaryExists, lockStale) {
  if (pct >= WRAPUP_PCT) return 'wrapup'
  if (state.compact_at && summaryExists) return 'ready'
  if (state.compact_at && lockStale) return 'error'
  if (state.compact_at) return 'compacting'
  return 'idle'
}

/**
 * Format a statusline display string.
 * @param {number} pct - Current context usage %
 * @param {string} status - Status from resolveStatus
 * @param {string} shortId - First 8 chars of session ID
 * @returns {string} Formatted display line
 */
export function formatLine(pct, status, shortId) {
  const bar = buildBar(pct)
  const icon = STATUS_ICONS[status] || ''
  const parts = [`seamless: ${pct.toFixed(0)}% ${bar}`]
  if (icon) parts.push(icon)
  if (status !== 'idle') parts.push(shortId)
  return parts.join(' ')
}

/**
 * Extract the last non-empty line from a log string.
 * @param {string} content - Log file content
 * @returns {string} Last line, or empty string
 */
export function lastLogLine(content) {
  if (!content) return ''
  const lines = content.trim().split('\n')
  return lines[lines.length - 1] || ''
}

export { STATUS_ICONS }
