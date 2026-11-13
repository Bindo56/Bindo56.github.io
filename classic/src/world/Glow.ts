import * as THREE from 'three'

/** A soft white dot fading to nothing - tint it with the material's colour, and draw it additively. */
export function createGlowTexture(): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas is not available.')

  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(0.25, 'rgba(255, 255, 255, 0.55)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** An additive halo sprite in `color`, using `texture` from createGlowTexture. */
export function createGlowSprite(texture: THREE.Texture, color: number, opacity: number, fog = true): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog,
  })
  return new THREE.Sprite(material)
}
