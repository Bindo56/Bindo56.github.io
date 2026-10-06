import { describe, expect, it } from 'vitest'
import {
  differenceSpacePosition,
  distanceBetweenSpacePositions,
  normalizeSpacePosition,
  offsetSpacePosition,
  SECTOR_SIZE,
} from '../../src/space/SpacePosition'

describe('endless-space coordinates', () => {
  it('carries positive and negative overflow into sectors, including boundaries', () => {
    const original = { sector: [0, 0, 0], local: [SECTOR_SIZE * 3 + 2048, -2048, -SECTOR_SIZE * 2 - 2049] } as const
    const normalized = normalizeSpacePosition({
      sector: [...original.sector],
      local: [...original.local],
    })

    expect(normalized).toEqual({ sector: [4, 0, -3], local: [-2048, -2048, 2047] })
    expect(original.sector).toEqual([0, 0, 0])
  })

  it('preserves physical distance across a sector boundary', () => {
    const left = normalizeSpacePosition({ sector: [0, 0, 0], local: [2047, 0, 0] })
    const right = offsetSpacePosition(left, [2, 0, 0])

    expect(right).toEqual({ sector: [1, 0, 0], local: [-2047, 0, 0] })
    expect(differenceSpacePosition(left, right)).toEqual([2, 0, 0])
    expect(distanceBetweenSpacePositions(left, right)).toBe(2)
  })

  it('can normalize long travel without drifting outside the local range', () => {
    let point = { sector: [0, 0, 0], local: [0, 0, 0] } as {
      sector: [number, number, number]
      local: [number, number, number]
    }
    for (let i = 0; i < 1000; i++) point = offsetSpacePosition(point, [200, -300, 500])

    expect(point.local.every(value => value >= -2048 && value < 2048)).toBe(true)
    expect(differenceSpacePosition({ sector: [0, 0, 0], local: [0, 0, 0] }, point)).toEqual([
      200_000,
      -300_000,
      500_000,
    ])
  })
})
