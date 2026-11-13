import { afterEach, describe, expect, it, vi } from 'vitest'
import { PublicProofScenario, publicProofState } from '../../src/worlds/npcProofPublic'

afterEach(() => vi.restoreAllMocks())

describe('public Earth Sim (New York) NPC preview', () => {
  it('keeps the worker and customers aligned with the resized cart', () => {
    const state = publicProofState(480_000, 24, false)
    expect(state.worker.phase).toBe('serve')
    expect(state.cart.open).toBe(true)
    expect(state.customers).toHaveLength(1)
    expect(Math.hypot(state.worker.x - state.cart.x, state.worker.z - state.cart.z)).toBeLessThan(1)
    expect(Math.hypot(state.customers![0].x - state.cart.x, state.customers![0].z - state.cart.z)).toBeLessThan(2)
    expect(publicProofState(1_140_000, 24, false).worker.phase).toBe('commute_home')
  })

  it('advances, pauses, and resets without the development API', () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const scenario = new PublicProofScenario()
    expect(scenario.state().shiftElapsedMs).toBe(360_000)
    now += 1_000
    expect(scenario.state().shiftElapsedMs).toBe(384_000)
    scenario.control('pause')
    now += 5_000
    expect(scenario.state().shiftElapsedMs).toBe(384_000)
    scenario.control('reset')
    expect(scenario.state().shift).toBe(2)
    expect(scenario.state().shiftElapsedMs).toBe(0)
    scenario.control('resume')
    now += 1_000
    expect(scenario.state().shiftElapsedMs).toBe(24_000)
  })
})
