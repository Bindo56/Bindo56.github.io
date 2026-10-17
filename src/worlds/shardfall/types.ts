export type CityId = 'neon-rift' | 'dune-halo' | 'tideglass' | 'cloudstack' | 'bloom-circuit' | 'ember-forge'
export type WeaponId = 'impact' | 'cluster' | 'drill' | 'laser' | 'pulse'
export type ViewLevel = 'orbit' | 'city' | 'street'

export interface CityDefinition {
  id: CityId
  name: string
  subtitle: string
  description: string
  inspiration: string
  color: string
  palette: { ground: number; building: number; secondary: number; glow: number; dark: number }
  /** Unit direction from the planet center; city local Y points outward. */
  normal: [number, number, number]
}

/** Integer local grid coordinates. Every cell is individually destructible. */
export interface VoxelCell {
  x: number
  y: number
  z: number
  color: number
  /** Anchored cells seed the structural support search. */
  anchored?: boolean
  emissive?: boolean
  reactor?: boolean
  /** Coarse city-grid cell supporting a finer detail voxel. */
  parent?: [number, number, number]
}

export interface CityBlueprint {
  cells: VoxelCell[]
  /** Fine detail layers share the city's transform and follow their supporting city blocks. */
  details?: { cellSize: number; cells: VoxelCell[] }[]
  /** Coordinates in local world units, for moving decorative traffic. */
  traffic: { from: [number, number, number]; to: [number, number, number]; color: number }[]
}

export interface ShardfallState {
  city: CityId
  weapon: WeaponId
  view: ViewLevel
  zoom: number
  integrity: number
  cityIntegrity: number
  destroyed: number
  shots: number
  heat: number
  paused: boolean
  sound: boolean
  message: string
}

export interface ShardfallActions {
  selectCity(id: CityId): void
  selectWeapon(id: WeaponId): void
  setView(view: ViewLevel): void
  setZoom(value: number): void
  resetCity(): void
  resetPlanet(): void
  togglePause(): void
  toggleSound(): void
  fire(): void
  exit(): void
}

export const CITY_CELL_SIZE = 0.4
export const CITY_DETAIL_CELL_SIZE = 0.1
export const CITY_TRIM_CELL_SIZE = 0.2
export const PLANET_RADIUS = 25

export const WEAPONS: { id: WeaponId; name: string; label: string; description: string; color: string; key: string }[] = [
  { id: 'impact', name: 'Impact', label: 'Guided missile', description: 'A precise strike. Deep craters and flying fragments.', color: '#ffb56b', key: '1' },
  { id: 'cluster', name: 'Cluster', label: 'Scatter launcher', description: 'Splits into seven missiles to sweep an entire block.', color: '#f0b1ff', key: '2' },
  { id: 'drill', name: 'Drill', label: 'Burrowing charge', description: 'Pierces the surface, then detonates beneath it.', color: '#ffd95c', key: '3' },
  { id: 'laser', name: 'Laser', label: 'Continuous beam', description: 'Hold and drag to carve through floors and supports.', color: '#7bf5ef', key: '4' },
  { id: 'pulse', name: 'Pulse', label: 'Shockwave cannon', description: 'An expanding blast that fractures a wide area.', color: '#98b1ff', key: '5' },
]
