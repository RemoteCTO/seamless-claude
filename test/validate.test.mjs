import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateResult } from '../lib/validate.mjs'

describe('validate', () => {
  describe('validateResult', () => {
    it('returns true for valid result with all 5 sections', () => {
      const padding = 'x'.repeat(100)
      const result = `
## Session Summary

Some summary text here. ${padding}

## Technical Context

Technical details. ${padding}

## Knowledge Extractions

LEARNED: something new

## Next Steps

1. Do this
2. Do that

## Active Context

Current state. ${padding}
      `.trim()

      assert.equal(validateResult(result), true)
    })

    it('returns true for valid result with 3 sections', () => {
      const padding = 'x'.repeat(200)
      const result = `
## Session Summary

Summary here. ${padding}

## Technical Context

Context here. ${padding}

## Knowledge Extractions

LEARNED: something
      `.trim()

      assert.equal(validateResult(result), true)
    })

    it('returns false for result with only 2 sections', () => {
      const result = `
## Session Summary

Summary here.

## Technical Context

Context here.
      `.trim()

      assert.equal(validateResult(result), false)
    })

    it('returns false for empty string', () => {
      assert.equal(validateResult(''), false)
    })

    it('returns false for null', () => {
      assert.equal(validateResult(null), false)
    })

    it('returns false for undefined', () => {
      assert.equal(validateResult(undefined), false)
    })

    it('returns false for short string under 500 chars', () => {
      const result = 'Too short'
      assert.equal(validateResult(result), false)
    })

    it('returns false for long string with no sections', () => {
      const result = 'a'.repeat(1000)
      assert.equal(validateResult(result), false)
    })

    it('matches section headings case-insensitively', () => {
      const padding = 'x'.repeat(200)
      const result = `
## session summary

Summary. ${padding}

## technical context

Context. ${padding}

## knowledge extractions

LEARNED: something
      `.trim()

      assert.equal(validateResult(result), true)
    })

    it('returns true for exactly 500 chars with 3 sections', () => {
      const header = `## Session Summary

Summary.

## Technical Context

Context.

## Knowledge Extractions

Knowledge.
`
      const padding = 'a'.repeat(500 - header.length)
      const result = header + padding

      assert.equal(result.length, 500)
      assert.equal(validateResult(result), true)
    })
  })
})
