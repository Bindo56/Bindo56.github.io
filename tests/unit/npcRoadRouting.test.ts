import { describe, expect, it } from 'vitest'
import { NpcRoadRouter, sampleRoute } from '../../src/worlds/npcRoadRouting'

describe('NPC road routing', () => {
  const nodes = [
    { id: 'A', x: 0, z: 0 }, { id: 'B', x: 0, z: 10 },
    { id: 'C', x: 10, z: 10 }, { id: 'D', x: 10, z: 0 },
  ]
  const roads = [
    { from: 'A', to: 'B', points: [[0, 0], [0, 10]] as [number, number][], length: 10 },
    { from: 'B', to: 'C', points: [[0, 10], [10, 10]] as [number, number][], length: 10 },
    { from: 'A', to: 'D', points: [[0, 0], [10, 0]] as [number, number][], length: 10 },
    { from: 'D', to: 'C', points: [[10, 0], [10, 10]] as [number, number][], length: 10 },
  ]

  it('travels along connected road points and reaches its destination', () => {
    const router = new NpcRoadRouter(nodes, roads)
    const route = router.route({ x: 0, z: 0 }, { x: 10, z: 10 })!
    expect(route.totalLength).toBe(20)
    expect(sampleRoute(route, 0)).toMatchObject({ x: 0, z: 0 })
    expect(sampleRoute(route, .5)).toMatchObject({ x: 0, z: 10 })
    expect(sampleRoute(route, 1)).toMatchObject({ x: 10, z: 10 })
  })

  it('avoids a blocked node and uses the other street', () => {
    const router = new NpcRoadRouter(nodes, roads, (point) => !(point.x === 0 && point.z === 10))
    const route = router.route({ x: 0, z: 0 }, { x: 10, z: 10 })!
    expect(route.points).toEqual([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }])
  })
})
