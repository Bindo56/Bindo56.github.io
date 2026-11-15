import { describe, expect, it } from 'vitest'
import { nextNewYorkMondayMorning } from '../../src/worlds/TimeManager'

describe('New York commute preview clock', () => {
  it('starts the next Monday at 8:45 AM after standard time begins', () => {
    expect(new Date(nextNewYorkMondayMorning(Date.parse('2026-11-15T18:00:00Z'))).toISOString())
      .toBe('2026-11-16T13:45:00.000Z')
  })

  it('uses daylight saving time for a spring Monday', () => {
    expect(new Date(nextNewYorkMondayMorning(Date.parse('2026-03-08T18:00:00Z'))).toISOString())
      .toBe('2026-03-09T12:45:00.000Z')
  })
})
