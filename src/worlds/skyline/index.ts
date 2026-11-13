import * as THREE from 'three'
import { buildInstances, SkylineBuilder, type Rect, type TowerDef } from './kit'
import { TOWERS } from './towers'

export { TOWERS }
export type { Rect, TowerDef }

export type SkylineScene = { far: THREE.Group; near: THREE.Group; towers: TowerDef[]; cutouts: Rect[] }

/** Builds every modelled tower into two LOD groups: city-wide massing and close-up detail. */
export function buildSkyline(): SkylineScene {
  const far = new SkylineBuilder()
  const near = new SkylineBuilder()
  const built: TowerDef[] = []
  for (const tower of TOWERS) {
    const farCount = far.count
    const nearCount = near.count
    try {
      tower.build(far, near)
      built.push(tower)
    } catch {
      // A broken model must not take the city down; drop whatever it added.
      far.instances.length = farCount
      near.instances.length = nearCount
    }
  }
  return {
    far: buildInstances(far, 'Iconic towers (massing)'),
    near: buildInstances(near, 'Iconic towers (detail)'),
    towers: built,
    cutouts: built.flatMap((tower) => tower.cutouts),
  }
}

/**
 * Flattens raised raster blocks inside the cut-out rectangles to plaza ground, so a hand-built
 * model replaces the blocky tile building. Mutates the tile's RGBA data (alpha holds the height
 * byte) and is idempotent, so it is safe on cached tile data.
 */
export function flattenCutouts(data: Uint8ClampedArray, width: number, step: number,
  originX: number, originZ: number, groundByte: number, cutouts: Rect[]) {
  const right = originX + width * step
  const bottom = originZ + width * step
  for (const [minX, minZ, maxX, maxZ] of cutouts) {
    if (maxX <= originX || minX >= right || maxZ <= originZ || minZ >= bottom) continue
    const x0 = Math.max(0, Math.ceil((minX - originX) / step - .5))
    const x1 = Math.min(width - 1, Math.floor((maxX - originX) / step - .5))
    const z0 = Math.max(0, Math.ceil((minZ - originZ) / step - .5))
    const z1 = Math.min(width - 1, Math.floor((maxZ - originZ) / step - .5))
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const j = (z * width + x) * 4
      if (data[j + 3] <= groundByte) continue
      data[j] = 150
      data[j + 1] = 150
      data[j + 2] = 150
      data[j + 3] = groundByte
    }
  }
}
