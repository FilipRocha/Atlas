import { describe, expect, it } from 'vitest'
import qaRunner from './qa-runner.cjs'

describe('Atlas QA runner', () => {
  it('parses selected checks and report destinations', () => {
    const parsed = qaRunner.parseArgs(['--only', 'typecheck,unit-tests', '--report-dir', 'reports'])
    expect(parsed.only).toEqual(['typecheck', 'unit-tests'])
    expect(parsed.reportDir).toMatch(/reports$/)
  })

  it('summarizes each outcome in a readable report', () => {
    const markdown = qaRunner.markdownReport({
      startedAt: '2026-10-10T00:00:00.000Z',
      finishedAt: '2026-10-10T00:00:03.000Z',
      results: [
        { label: 'Typecheck', status: 'PASS', durationMs: 1000, details: 'Completed.' },
        { label: 'Unit tests', status: 'HANG', durationMs: 2000, details: 'Exceeded 2 ms.' }
      ]
    })
    expect(markdown).toContain('Total: 2 | PASS: 1 | FAIL: 0 | HANG: 1 | CRASH: 0')
    expect(markdown).toContain('| Unit tests | HANG | 2.0 s | Exceeded 2 ms. |')
  })
})
