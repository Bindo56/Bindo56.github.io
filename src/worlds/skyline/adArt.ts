import * as THREE from 'three'
import type { AdSlot } from './kit'

// Made-up brands only: no real company names, logos or slogans.

/** Static ad atlas for billboards, kiosks, bus shelters and wall murals. */
export type AdAtlas = {
  texture: THREE.CanvasTexture
  slots: AdSlot[]
  /** Slot indices whose aspect (w/h) is at least 1.4 */
  landscape: number[]
  /** Slot indices whose aspect is at most 0.75 */
  portrait: number[]
}

/** Animated LED screen texture for Times Square; `update` redraws at most a few times a second. */
export type ScreenWall = {
  texture: THREE.CanvasTexture
  slots: AdSlot[]
  /** Redraws animated content when due; returns true when the texture changed. */
  update(now: number): boolean
}

let atlas: AdAtlas | null = null

/** Placeholder until the ad art lands: flat colour cards. The signature is the contract. */
export function createAdAtlas(): AdAtlas {
  if (atlas) return atlas
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const context = canvas.getContext('2d')!
  const colours = ['#e8423f', '#2f7de1', '#f2b632', '#3fbf72', '#8b5cf6', '#f97316', '#14b8a6', '#ec4899']
  const slots: AdSlot[] = []
  colours.forEach((colour, index) => {
    const x = (index % 4) * 128
    const y = Math.floor(index / 4) * 128
    context.fillStyle = colour
    context.fillRect(x + 2, y + 2, 124, 124)
    slots.push({ u: (x + 2) / 512, v: 1 - (y + 126) / 256, w: 124 / 512, h: 124 / 256, aspect: 1 })
  })
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  atlas = { texture, slots, landscape: slots.map((_, index) => index), portrait: slots.map((_, index) => index) }
  return atlas
}

/** Placeholder: the static atlas, never animated. */
export function createScreenWall(): ScreenWall {
  const { texture, slots } = createAdAtlas()
  return { texture, slots, update: () => false }
}
