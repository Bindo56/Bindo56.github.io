/** A point in endless space, split to keep the renderer close to its origin. */
export interface SpacePosition {
  sector: [number, number, number]
  local: [number, number, number]
}

export const SECTOR_SIZE = 4096
export const HALF_SECTOR_SIZE = SECTOR_SIZE / 2

/** Keep each local coordinate in [-2048, 2048), carrying overflow into its sector. */
export function normalizeSpacePosition(position: SpacePosition): SpacePosition {
  const sector = [...position.sector] as SpacePosition['sector']
  const local = [...position.local] as SpacePosition['local']

  for (let axis = 0; axis < 3; axis++) {
    const carry = Math.floor((local[axis] + HALF_SECTOR_SIZE) / SECTOR_SIZE)
    sector[axis] += carry
    local[axis] -= carry * SECTOR_SIZE
  }

  return { sector, local }
}

export function offsetSpacePosition(
  position: SpacePosition,
  offset: readonly [number, number, number],
): SpacePosition {
  return normalizeSpacePosition({
    sector: [...position.sector],
    local: [
      position.local[0] + offset[0],
      position.local[1] + offset[1],
      position.local[2] + offset[2],
    ],
  })
}

/** B - A, in rendering units. */
export function differenceSpacePosition(
  a: SpacePosition,
  b: SpacePosition,
): [number, number, number] {
  return [0, 1, 2].map(
    axis => (b.sector[axis] - a.sector[axis]) * SECTOR_SIZE + b.local[axis] - a.local[axis],
  ) as [number, number, number]
}

export function distanceBetweenSpacePositions(a: SpacePosition, b: SpacePosition): number {
  return Math.hypot(...differenceSpacePosition(a, b))
}
