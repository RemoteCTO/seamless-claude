import { EXPECTED_SECTIONS, MIN_RESULT_LENGTH } from './config.mjs'

// Returns true if the compactor result is valid.
export function validateResult(result) {
  if (!result || result.trim().length === 0) {
    return false
  }
  if (result.length < MIN_RESULT_LENGTH) return false
  const found = EXPECTED_SECTIONS.filter((s) =>
    result.includes(s),
  ).length
  return found >= 3
}
