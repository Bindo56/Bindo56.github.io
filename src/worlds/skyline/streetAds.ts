import * as THREE from 'three'
import type { AdAtlas } from './adArt'

/** Road fields used for placement (a subset of road-network.json roads). */
export type AdRoad = { name: string; points: [number, number][]; width: number; sidewalk?: boolean; bridge?: boolean }

/** One loaded city tile, as nju-jork.ts holds it after decoding (alpha channel = height byte). */
export type AdTile = {
  data: Uint8ClampedArray
  /** pixels per side (256 standard, 512 detail) */
  width: number
  /** blocks per pixel (2 standard, 1 detail) */
  step: number
  originX: number
  originZ: number
  /** height byte of street level (manifest.baseY + 1) */
  groundByte: number
  lod: 'standard' | 'detail'
  /** detail tiles only cover a square around the camera */
  crop?: { x: number; z: number; radius: number }
}

/** Tree positions in the tile, [x, z, kind, size] as in trees.<rx>.<rz>.json */
export type AdTree = [number, number, number, number]

/** Placeholder until the street furniture lands. The signature is the contract. */
export function buildStreetAds(_roads: AdRoad[], _tile: AdTile, _trees: AdTree[], _atlas: AdAtlas): THREE.Group {
  const group = new THREE.Group()
  group.name = 'Street ads'
  return group
}

export function disposeStreetAds(group: THREE.Group) {
  group.traverse((item) => { if (item instanceof THREE.InstancedMesh) { item.geometry.dispose(); item.dispose() } })
}
