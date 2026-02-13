import { EXPECTED_SECTIONS, MIN_RESULT_LENGTH } from './config.mjs'

// Returns true if the compactor result is valid.
export function validateResult(result) {
  if (!result || result.trim().length === 0) {
    return false
  }
  if (result.length < MIN_RESULT_LENGTH) return false
  const lower = result.toLowerCase()
  const found = EXPECTED_SECTIONS.filter((s) =>
    lower.includes(s.toLowerCase()),
  ).length
  return found >= 3
}
