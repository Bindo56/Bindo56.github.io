import { describe, expect, it } from 'vitest'
import { localClockAsNewYorkEpoch } from '../../src/worlds/npcClock'

const india = 'Asia/Kolkata'

describe('NPC schedule follows viewer local clock', () => {
  it('shows Monday morning in India as Monday morning in the city during winter', () => {
    const indiaMorning = Date.parse('2026-11-16T03:45:00Z') // 9:15 AM IST; New York is still Sunday night.
    expect(new Date(localClockAsNewYorkEpoch(indiaMorning, india)).toISOString())
      .toBe('2026-11-16T14:15:00.000Z') // 9:15 AM EST.
  })

  it('uses the summer New York offset', () => {
    const indiaMorning = Date.parse('2026-07-16T03:45:00Z')
    expect(new Date(localClockAsNewYorkEpoch(indiaMorning, india)).toISOString())
      .toBe('2026-07-16T13:15:00.000Z') // 9:15 AM EDT.
  })

  it('uses the viewer clock in a different time zone too', () => {
    const californiaMorning = Date.parse('2026-11-16T16:00:00Z') // 8 AM PST.
    expect(new Date(localClockAsNewYorkEpoch(californiaMorning, 'America/Los_Angeles')).toISOString())
      .toBe('2026-11-16T13:00:00.000Z') // 8 AM EST.
  })

  it('keeps the viewer calendar date across midnight', () => {
    const indiaMidnight = Date.parse('2026-11-15T18:40:00Z') // Nov 16, 12:10 AM IST.
    expect(new Date(localClockAsNewYorkEpoch(indiaMidnight, india)).toISOString())
      .toBe('2026-11-16T05:10:00.000Z')
  })

  it('chooses the first occurrence of the fall repeated hour', () => {
    const indiaAtOneThirty = Date.parse('2026-10-31T20:00:00Z') // Nov 1, 1:30 AM IST.
    expect(new Date(localClockAsNewYorkEpoch(indiaAtOneThirty, india)).toISOString())
      .toBe('2026-11-01T05:30:00.000Z') // First 1:30 AM in New York (EDT).
  })

  it('advances a missing spring hour to the corresponding time after the gap', () => {
    const indiaAtTwoThirty = Date.parse('2026-03-07T21:00:00Z') // Mar 8, 2:30 AM IST.
    expect(new Date(localClockAsNewYorkEpoch(indiaAtTwoThirty, india)).toISOString())
      .toBe('2026-03-08T07:30:00.000Z') // 3:30 AM EDT.
  })

  it('returns whole milliseconds, including the viewer milliseconds', () => {
    const epoch = Date.parse('2026-11-16T03:45:00Z') + 123
    const mapped = localClockAsNewYorkEpoch(epoch, india)
    expect(Number.isSafeInteger(mapped)).toBe(true)
    expect(mapped).toBe(Date.parse('2026-11-16T14:15:00Z') + 123)
  })
})
