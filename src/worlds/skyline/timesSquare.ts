import * as THREE from 'three'
import type { Rect } from './kit'

/** Where the Times Square marker and camera jump point to. */
export const TIMES_SQUARE = { id: 'times-square-plaza', name: 'Times Square', x: -536, z: -77, height: 60 }

export type TimesSquareScene = {
  group: THREE.Group
  /** Raster footprints replaced by models built here */
  cutouts: Rect[]
  /** Animates the screens when the camera is close; returns true when anything changed. */
  update(now: number, viewHeight: number, focus: THREE.Vector3): boolean
}

/** Placeholder until the Times Square model lands. The signature is the contract. */
export function buildTimesSquare(): TimesSquareScene {
  const group = new THREE.Group()
  group.name = 'Times Square'
  return { group, cutouts: [], update: () => false }
}
