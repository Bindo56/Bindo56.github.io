import { Color } from 'three'
import { PLANET_RADIUS, type VoxelCell } from './types.ts'

export const TERRAIN_CELL_SIZE = 1.25
export const SURFACE_CELL_SIZE = TERRAIN_CELL_SIZE / 2
/** Fine grid centers sit at the quarter points of each replaced coarse block. */
export const SURFACE_OFFSET: [number, number, number] = [-0.3125, -0.3125, -0.3125]

const SURFACE_DEPTH = 1.2

function grain(x: number, y: number, z: number): number {
  const value = Math.sin(x * 17.127 + y * 61.7 + z * 37.19) * 43758.5453
  return value - Math.floor(value)
}

function continent(x: number, y: number, z: number): number {
  return Math.sin(x * 0.17 + Math.sin(z * 0.13) * 1.8)
    + Math.cos(y * 0.21 - z * 0.11)
    + Math.sin(z * 0.16 + x * 0.06) * 0.65
}

function climate(x: number, y: number, z: number): number {
  return Math.sin(x * 0.13 - z * 0.17) + Math.cos(y * 0.18 + z * 0.09) * 0.55
}

/** Large exposed blocks form rocky outcrops amongst the smaller surface voxels. */
function keepCoarseSurface(x: number, y: number, z: number): boolean {
  const land = continent(x, y, z)
  const ridge = Math.sin(x * 0.37 + z * 0.21 + Math.sin(y * 0.2))
  return land > 0.35 && Math.abs(ridge) < 0.16 && grain(x, y, z) > 0.35
}

/** Continuous biome fields keep the geography readable at both orbital and street scales. */
function paintSurface(color: Color, x: number, y: number, z: number): boolean {
  const radius = Math.hypot(x, y, z)
  const latitude = Math.abs(y) / Math.max(radius, 1)
  const land = continent(x, y, z)
  const weather = climate(x, y, z)
  const fleck = (grain(x, y, z) - 0.5) * 0.065
  const strata = Math.sin(x * 0.65 + z * 0.46 + Math.sin(y * 0.31))
  const river = Math.sin(x * 0.23 + z * 0.11 + Math.sin(y * 0.27) * 1.4)
  const volcanic = Math.sin(x * 0.16 + y * 0.12) - Math.cos(z * 0.19)

  if (latitude > 0.79 + Math.sin(x * 0.23 + z * 0.19) * 0.035) {
    // Lilac glaciers have bright mint seams and visibly separate pale ice blocks.
    if (Math.abs(strata) < 0.12) color.setHSL(0.49, 0.7, 0.76 + fleck)
    else color.setHSL(0.73 + fleck * 0.22, 0.37, 0.75 + fleck)
    return false
  }

  if (land < -0.35) {
    // Violet seas deepen gradually, with cobalt bands tracing the shallows.
    const depth = Math.min(1, (-land - 0.35) / 1.6)
    color.setHSL(0.69 + depth * 0.055 + fleck * 0.18, 0.57, 0.43 - depth * 0.12 + fleck)
    return false
  }

  if (land < 0.17) {
    const shore = (land + 0.35) / 0.52
    color.setHSL(0.55 - shore * 0.075, 0.64, 0.49 + shore * 0.14 + fleck)
    return Math.abs(strata) < 0.07 && land > -0.05
  }

  if (volcanic > 1.15 && latitude < 0.68) {
    const fissure = Math.sin(x * 0.38 - z * 0.24 + Math.sin(y * 0.4) * 0.9)
    if (Math.abs(fissure) < 0.18) {
      color.setHSL(0.035 + grain(x, y, z) * 0.055, 0.95, 0.58 + fleck)
      return true
    }
    color.setHSL(0.72 + fleck, 0.24, 0.29 + fleck)
    return false
  }

  if (Math.abs(river) < 0.075 && land < 1.8) {
    color.setHSL(0.49, 0.79, 0.63 + fleck)
    return true
  }

  if (weather > 0.45 && latitude < 0.68) {
    // Coral dunes alternate with peach terraces instead of reading as grey sand.
    const terrace = strata > 0.34 ? 0.08 : strata < -0.4 ? -0.045 : 0
    color.setHSL(0.035 + terrace * 0.35 + fleck * 0.12, 0.67, 0.6 + terrace + fleck)
    return false
  }

  if (land > 1.6) {
    // Lavender highlands and occasional bright crystal faces sit above the forests.
    color.setHSL(0.76 + fleck * 0.4, 0.42, 0.57 + fleck + (strata > 0.65 ? 0.1 : 0))
    return strata > 0.95 && grain(x, y, z) > 0.65
  }

  const canopy = Math.sin(x * 0.6 + y * 0.3) * Math.cos(z * 0.55 - y * 0.25)
  color.setHSL(0.4 + canopy * 0.035 + fleck * 0.2, 0.52, 0.4 + canopy * 0.09 + fleck)
  return false
}

function buildTerrain(surface: boolean): VoxelCell[] {
  const cells: VoxelCell[] = []
  const extent = Math.ceil(PLANET_RADIUS / TERRAIN_CELL_SIZE)
  const color = new Color()
  for (let x = -extent; x <= extent; x++) for (let y = -extent; y <= extent; y++) for (let z = -extent; z <= extent; z++) {
    const wx = x * TERRAIN_CELL_SIZE, wy = y * TERRAIN_CELL_SIZE, wz = z * TERRAIN_CELL_SIZE
    const radius = Math.hypot(wx, wy, wz)
    if (radius > PLANET_RADIUS) continue
    const subdivide = radius >= PLANET_RADIUS - SURFACE_DEPTH && !keepCoarseSurface(wx, wy, wz)

    if (surface) {
      if (!subdivide) continue
      for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) for (let dz = 0; dz < 2; dz++) {
        const sx = x * 2 + dx, sy = y * 2 + dy, sz = z * 2 + dz
        const px = sx * SURFACE_CELL_SIZE + SURFACE_OFFSET[0]
        const py = sy * SURFACE_CELL_SIZE + SURFACE_OFFSET[1]
        const pz = sz * SURFACE_CELL_SIZE + SURFACE_OFFSET[2]
        // Trim only the corners of the outermost blocks for a finer planet silhouette.
        if (Math.hypot(px, py, pz) > PLANET_RADIUS + 0.15) continue
        const emissive = paintSurface(color, px, py, pz)
        cells.push({ x: sx, y: sy, z: sz, color: color.getHex(), emissive, anchored: true })
      }
      continue
    }

    if (subdivide) continue
    const fleck = (grain(wx, wy, wz) - 0.5) * 0.06
    let emissive = false
    if (radius < 7) {
      color.setHSL(0.065 + fleck * 0.3, 0.94, 0.55 + fleck)
      emissive = true
    } else if (radius < 16) {
      color.setHSL(0.025 + fleck * 0.2, 0.71, 0.25 + fleck)
    } else if (radius < PLANET_RADIUS - 2.15) {
      color.setHSL(0.75 + fleck * 0.25, 0.3, 0.23 + fleck)
    } else {
      emissive = paintSurface(color, wx, wy, wz)
    }
    cells.push({ x, y, z, color: color.getHex(), emissive, anchored: true })
  }
  return cells
}

/** Solid coarse interior and selected larger surface outcrops. */
export function buildPlanet(): VoxelCell[] {
  return buildTerrain(false)
}

/** Smaller destructible crust cells; mount with SURFACE_OFFSET relative to the planet. */
export function buildPlanetSurface(): VoxelCell[] {
  return buildTerrain(true)
}
