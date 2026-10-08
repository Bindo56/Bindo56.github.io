import { describe, expect, it } from 'vitest'
import { SolarSimulation, type SolarPreset } from '../../src/worlds/solar-dots/SolarSimulation'

function advance(simulation: SolarSimulation, seconds: number, dt = 1 / 60): void {
  const frames = Math.round(seconds / dt)
  for (let frame = 0; frame < frames; frame++) simulation.update(dt)
}

describe('Solar DOTS central-attractor simulation', () => {
  it('replays the same seeded launch and reset exactly', () => {
    const first = new SolarSimulation(96, 12345)
    const second = new SolarSimulation(96, 12345)
    first.launch('orbit', 175, 1.08)
    second.launch('orbit', 175, 1.08)
    expect(first.positions).toEqual(second.positions)
    expect(first.velocities).toEqual(second.velocities)

    advance(first, 6)
    advance(second, 6)
    expect(first.positions).toEqual(second.positions)
    expect(first.states).toEqual(second.states)

    first.reset()
    const replay = new SolarSimulation(96, 12345)
    replay.launch('orbit', 175, 1.08)
    expect(first.positions).toEqual(replay.positions)
    expect(first.velocities).toEqual(replay.velocities)
    expect(first.elapsed).toBe(0)
    expect(first.orbiting).toBe(96)
  })

  it('makes orbit, plunge, and escape visibly different with one gravity rule', () => {
    const run = (preset: SolarPreset) => {
      const simulation = new SolarSimulation(256, 88)
      simulation.launch(preset)
      advance(simulation, 18)
      return simulation
    }
    const orbit = run('orbit')
    const plunge = run('plunge')
    const escape = run('escape')

    expect(orbit.orbiting).toBeGreaterThan(230)
    expect(plunge.captured).toBeGreaterThan(150)
    expect(escape.escaped).toBeGreaterThan(100)
    expect(plunge.captured).toBeGreaterThan(orbit.captured)
    expect(escape.escaped).toBeGreaterThan(orbit.escaped)
    for (const simulation of [orbit, plunge, escape]) {
      expect(simulation.orbiting + simulation.captured + simulation.escaped).toBe(256)
    }
  })

  it('advances by fixed steps across common frame rates', () => {
    const sixtyHz = new SolarSimulation(48, 7)
    const thirtyHz = new SolarSimulation(48, 7)
    sixtyHz.launch('orbit')
    thirtyHz.launch('orbit')
    advance(sixtyHz, 10, 1 / 60)
    advance(thirtyHz, 10, 1 / 30)

    expect(thirtyHz.elapsed).toBeCloseTo(sixtyHz.elapsed, 6)
    expect(thirtyHz.states).toEqual(sixtyHz.states)
    for (let index = 0; index < sixtyHz.positions.length; index++) {
      expect(thirtyHz.positions[index]).toBeCloseTo(sixtyHz.positions[index], 5)
    }
  })

  it('clamps invalid inputs and limits giant catch-up frames', () => {
    const simulation = new SolarSimulation(40, 2)
    simulation.launch('escape', Number.POSITIVE_INFINITY, Number.NaN, 1_000)
    expect(simulation.count).toBe(40)
    expect(simulation.gravity).toBe(650)
    expect(simulation.speed).toBe(1)
    simulation.update(10_000)
    expect(simulation.elapsed).toBeLessThanOrEqual(8 / 120 + 1e-8)
    simulation.update(Number.NaN)
    expect(simulation.elapsed).toBeLessThanOrEqual(8 / 120 + 1e-8)

    simulation.launch('plunge', -1_000, 500, 4)
    expect(simulation.count).toBe(4)
    expect(simulation.gravity).toBe(100)
    expect(simulation.speed).toBe(2.5)
    advance(simulation, 20)
    expect([...simulation.positions].every(Number.isFinite)).toBe(true)
    expect([...simulation.velocities].every(Number.isFinite)).toBe(true)
  })
})
