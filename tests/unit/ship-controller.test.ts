import { describe, expect, it } from 'vitest'
import { IDLE_SHIP_ACTIONS, ShipController } from '../../src/space/ShipController'

describe('spaceship flight', () => {
  it('clamps speed and keeps local coordinates bounded during long boosted travel', () => {
    const ship = new ShipController()
    const actions = { ...IDLE_SHIP_ACTIONS, thrust: 1, boost: true }
    for (let i = 0; i < 5000; i++) ship.update(1 / 60, actions)

    expect(ship.velocity.length()).toBeLessThanOrEqual(195)
    expect(ship.position.local.every(value => value >= -2048 && value < 2048)).toBe(true)
    expect(ship.position.sector[2]).toBeLessThan(-1)
  })

  it('brakes after thrust and ignores invalid analog input', () => {
    const ship = new ShipController()
    for (let i = 0; i < 120; i++) ship.update(1 / 60, { ...IDLE_SHIP_ACTIONS, thrust: 1 })
    const cruising = ship.velocity.length()
    for (let i = 0; i < 60; i++) ship.update(1 / 60, { ...IDLE_SHIP_ACTIONS, brake: true, yaw: Number.NaN })

    expect(ship.velocity.length()).toBeLessThan(cruising / 100)
    expect(Number.isFinite(ship.orientation.x)).toBe(true)
  })

  it('places the ship in a safe orbit without retaining previous velocity', () => {
    const ship = new ShipController()
    ship.update(1, { ...IDLE_SHIP_ACTIONS, thrust: 1 })
    ship.place({ sector: [0, 0, 0], local: [5000, 0, 0] })

    expect(ship.position).toEqual({ sector: [1, 0, 0], local: [904, 0, 0] })
    expect(ship.velocity.length()).toBe(0)
  })
})
