import { describe, expect, it, vi } from 'vitest'
import { findRelease } from './publish-release'

describe('draft release lookup', () => {
  it('finds a draft on a later API page without using the public tag endpoint', () => {
    const draft = { id: 123, tag_name: 'v3.0.0', draft: true }
    const gh = vi.fn(() =>
      [JSON.stringify({ tag_name: 'v2.9.0' }), JSON.stringify(draft), ''].join('\n')
    )
    expect(findRelease(gh, '', 'v3.0.0')).toEqual(draft)
    expect(gh).toHaveBeenCalledExactlyOnceWith(
      'api',
      '--paginate',
      'repos//releases?per_page=100',
      '--jq',
      '.[] | {id, tag_name, draft} | @json'
    )
  })

  it.each([{ releases: [] }, { releases: [{ tag_name: 'v3.0.0' }, { tag_name: 'v3.0.0' }] }])(
    'rejects missing or ambiguous releases',
    ({ releases }) => {
      expect(() =>
        findRelease(
          () => releases.map((release) => JSON.stringify(release)).join('\n'),
          'owner/repo',
          'v3.0.0'
        )
      ).toThrow('Expected exactly one release')
    }
  )

  it('propagates API failures instead of treating them as a missing draft', () => {
    expect(() =>
      findRelease(
        () => {
          throw new Error('API unavailable')
        },
        'owner/repo',
        'v3.0.0'
      )
    ).toThrow('API unavailable')
  })
})
