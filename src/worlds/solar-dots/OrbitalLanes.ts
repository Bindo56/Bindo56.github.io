export type StoneKind = 'ember' | 'amethyst' | 'ice' | 'iron' | 'gold'

/** Free-ranging points use the same gravity simulation without a stone mesh. */
export const FREE_STAR_LANE = 255

export interface OrbitalLane {
  /** This is also the index stored in SolarSimulation.lanes. */
  readonly id: number
  readonly name: string
  readonly radius: number
  /** Maximum radial variation to either side of radius. */
  readonly width: number
  /** Orbital-plane tilt and ascending-node angle, in radians. */
  readonly inclination: number
  readonly node: number
  readonly color: number
  readonly stone: StoneKind
  readonly stoneLabel: string
}

export const ORBITAL_LANES = [
  {
    id: 0, name: 'Ember Ring', radius: 9.2, width: 0.55,
    inclination: 0.22, node: 0.15, color: 0xffa65f,
    stone: 'ember', stoneLabel: 'Molten fragments',
  },
  {
    id: 1, name: 'Amethyst Arc', radius: 14.8, width: 0.72,
    inclination: 0.58, node: 1.25, color: 0xb28cff,
    stone: 'amethyst', stoneLabel: 'Amethyst crystals',
  },
  {
    id: 2, name: 'Frost Belt', radius: 20.7, width: 0.88,
    inclination: 1.04, node: 2.3, color: 0x7ddbf3,
    stone: 'ice', stoneLabel: 'Ice shards',
  },
  {
    id: 3, name: 'Iron Orbit', radius: 26.3, width: 1.02,
    inclination: 0.76, node: 3.55, color: 0xb1bdc9,
    stone: 'iron', stoneLabel: 'Iron stones',
  },
  {
    id: 4, name: 'Gold Frontier', radius: 32.6, width: 1.15,
    inclination: 1.29, node: 4.7, color: 0xf1c471,
    stone: 'gold', stoneLabel: 'Golden asteroids',
  },
] as const satisfies readonly OrbitalLane[]
