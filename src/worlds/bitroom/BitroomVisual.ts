import * as THREE from 'three'

const GRID_SIZE = 8
const TILE_PITCH = 1.34
const TILE_SIZE = 1.14
const LAST_BIT = 63
const FULL_MASK = (1n << 64n) - 1n
const COLOR = {
  backdrop: 0x030b11,
  inactive: 0x111a20,
  off: 0x1a3034,
  on: 0x3eb77c,
  previewOn: 0x2a9fc1,
  previewOff: 0x743657,
  lime: 0xa6ffc1,
  cyan: 0x55e8fa,
  magenta: 0xff82bd,
  gold: 0xffd37c,
  white: 0xf4fffd,
} as const

export type BitroomVisualState = {
  value: bigint
  target: bigint
  width: 4 | 8 | 64
  preview?: bigint | null
  selectedBit?: number | null
  activeMask?: bigint
}

interface BitTile {
  bit: number
  slab: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>
  glyph: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  border: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>
  targetPin: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>
  elevation: number
}

function hasBit(value: bigint, bit: number): boolean {
  return ((value >> BigInt(bit)) & 1n) === 1n
}

function gridPosition(bit: number): THREE.Vector3 {
  const slot = LAST_BIT - bit
  const row = Math.floor(slot / GRID_SIZE)
  const column = slot % GRID_SIZE
  return new THREE.Vector3(
    (column - (GRID_SIZE - 1) / 2) * TILE_PITCH,
    0,
    (row - (GRID_SIZE - 1) / 2) * TILE_PITCH,
  )
}

function digitTexture(digit: '0' | '1'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 160
  const context = canvas.getContext('2d')
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#fff'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.font = '700 108px ui-monospace, SFMono-Regular, Consolas, monospace'
    context.fillText(digit, 64, 84)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** A procedural 64-bit machine floor. The hosting planet owns the renderer and frame loop. */
export class BitroomVisual {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 110)

  private readonly geometries = new Set<THREE.BufferGeometry>()
  private readonly materials = new Set<THREE.Material>()
  private readonly textures = new Set<THREE.Texture>()
  private readonly tiles: BitTile[] = []
  private readonly pickable: THREE.Object3D[] = []
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private readonly focus = new THREE.Vector3()
  private readonly cameraGoal = new THREE.Vector3()
  private readonly focusGoal = new THREE.Vector3()
  private readonly offColor = new THREE.Color(COLOR.off)
  private readonly onColor = new THREE.Color(COLOR.on)
  private readonly inactiveColor = new THREE.Color(COLOR.inactive)
  private readonly previewOnColor = new THREE.Color(COLOR.previewOn)
  private readonly previewOffColor = new THREE.Color(COLOR.previewOff)
  private readonly zeroTexture: THREE.CanvasTexture
  private readonly oneTexture: THREE.CanvasTexture
  private readonly pulse: THREE.Group
  private readonly pulseCore: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  private readonly pulseGlow: THREE.Sprite
  private readonly pulseLight: THREE.PointLight
  private readonly reducedMotion: boolean

  private state: BitroomVisualState = { value: 0n, target: 0n, width: 8 }
  private pulsePath: THREE.Vector3[] = []
  private pulseTime = 0
  private pulseDuration = 0
  private elapsed = 0
  private disposed = false

  constructor() {
    this.reducedMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.scene.background = new THREE.Color(COLOR.backdrop)
    this.scene.fog = new THREE.FogExp2(COLOR.backdrop, 0.027)

    this.zeroTexture = this.trackTexture(digitTexture('0'))
    this.oneTexture = this.trackTexture(digitTexture('1'))

    this.scene.add(new THREE.HemisphereLight(0xb8eee4, 0x0c1420, 1.0))
    const key = new THREE.DirectionalLight(0xc4ffed, 2.0)
    key.position.set(-5, 12, 9)
    this.scene.add(key)
    const magentaFill = new THREE.DirectionalLight(0xb46ca9, 0.7)
    magentaFill.position.set(9, 5, -7)
    this.scene.add(magentaFill)

    this.addMachineBase()
    this.addTiles()
    this.addAmbientDust()

    this.pulse = new THREE.Group()
    this.pulseCore = new THREE.Mesh(
      this.trackGeometry(new THREE.SphereGeometry(0.2, 16, 12)),
      this.trackMaterial(new THREE.MeshBasicMaterial({ color: 0xeafff2 })),
    )
    this.pulseGlow = new THREE.Sprite(this.trackMaterial(new THREE.SpriteMaterial({
      map: this.trackTexture(this.makeGlowTexture()),
      color: COLOR.cyan,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })))
    this.pulseGlow.scale.set(1.5, 1.5, 1)
    this.pulseLight = new THREE.PointLight(COLOR.cyan, 1.6, 3.6, 2)
    this.pulse.add(this.pulseCore, this.pulseGlow, this.pulseLight)
    this.pulse.visible = false
    this.scene.add(this.pulse)

    this.positionCamera(true)
    this.setState(this.state)
    this.paintTiles(1)
  }

  setState(state: BitroomVisualState): void {
    if (this.disposed) return
    const selectedBit = state.selectedBit != null && Number.isInteger(state.selectedBit)
      && state.selectedBit >= 0 && state.selectedBit < state.width
      ? state.selectedBit
      : null
    this.state = {
      width: state.width,
      value: state.value & FULL_MASK,
      target: state.target & FULL_MASK,
      preview: state.preview == null ? null : state.preview & FULL_MASK,
      activeMask: (state.activeMask ?? 0n) & FULL_MASK,
      selectedBit,
    }
    this.positionCamera(false)
    if (this.reducedMotion) this.paintTiles(1)
  }

  /** The visible top faces are the only picking targets; column 7, row 7 is bit 0. */
  pickBit(clientX: number, clientY: number, rect: DOMRect): number | null {
    if (this.disposed || rect.width <= 0 || rect.height <= 0) return null
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.pickable, false)
    for (const hit of hits) {
      const bit = hit.object.userData.bit
      if (typeof bit === 'number' && bit < this.state.width) return bit
    }
    return null
  }

  /** A visible signal hops through the currently lit bits after a solved operation. */
  celebrate(): void {
    if (this.disposed) return
    const lit: THREE.Vector3[] = []
    for (let bit = this.state.width - 1; bit >= 0; bit--) {
      if (hasBit(this.state.value, bit)) lit.push(gridPosition(bit))
    }
    if (lit.length === 0) lit.push(gridPosition(this.state.selectedBit ?? 0))
    const stride = Math.max(1, Math.ceil(lit.length / 14))
    this.pulsePath = lit.filter((_, index) => index % stride === 0 || index === lit.length - 1)
    this.pulseTime = 0
    this.pulseDuration = this.reducedMotion ? 0.36 : Math.min(1.7, 0.65 + this.pulsePath.length * 0.09)
    this.pulse.visible = true
    this.placePulse(0)
  }

  update(dt: number): void {
    if (this.disposed) return
    const frame = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, 0.08) : 0
    this.elapsed += frame
    this.positionCamera(false)
    const tileEase = this.reducedMotion ? 1 : 1 - Math.exp(-11 * frame)
    const cameraEase = this.reducedMotion ? 1 : 1 - Math.exp(-5.5 * frame)
    this.paintTiles(tileEase)
    this.camera.position.lerp(this.cameraGoal, cameraEase)
    this.focus.lerp(this.focusGoal, cameraEase)
    this.camera.lookAt(this.focus)

    if (this.pulse.visible) {
      this.pulseTime += frame
      const progress = Math.min(1, this.pulseTime / this.pulseDuration)
      this.placePulse(this.reducedMotion ? 1 : progress)
      const fade = Math.min(1, (1 - progress) * 5)
      this.pulseGlow.material.opacity = fade
      this.pulseLight.intensity = 1.6 * fade
      if (progress >= 1) this.pulse.visible = false
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.scene.clear()
    for (const geometry of this.geometries) geometry.dispose()
    for (const material of this.materials) material.dispose()
    for (const texture of this.textures) texture.dispose()
    this.geometries.clear()
    this.materials.clear()
    this.textures.clear()
    this.tiles.length = 0
    this.pickable.length = 0
    this.pulsePath.length = 0
  }

  private addMachineBase(): void {
    const baseMaterial = this.trackMaterial(new THREE.MeshStandardMaterial({
      color: 0x101d24,
      metalness: 0.76,
      roughness: 0.38,
    }))
    const base = new THREE.Mesh(this.trackGeometry(new THREE.BoxGeometry(11.65, 0.55, 11.65)), baseMaterial)
    base.position.y = -0.48
    this.scene.add(base)

    const underside = new THREE.Mesh(
      this.trackGeometry(new THREE.BoxGeometry(12.2, 0.16, 12.2)),
      this.trackMaterial(new THREE.MeshStandardMaterial({
        color: 0x081118,
        metalness: 0.6,
        roughness: 0.33,
        emissive: 0x153e47,
        emissiveIntensity: 0.22,
      })),
    )
    underside.position.y = -0.82
    this.scene.add(underside)

    const railMaterial = this.trackMaterial(new THREE.MeshBasicMaterial({ color: 0x24717d }))
    const railGeometry = this.trackGeometry(new THREE.BoxGeometry(11.95, 0.045, 0.045))
    for (const z of [-5.87, 5.87]) {
      const rail = new THREE.Mesh(railGeometry, railMaterial)
      rail.position.set(0, -0.17, z)
      this.scene.add(rail)
    }
    for (const x of [-5.87, 5.87]) {
      const rail = new THREE.Mesh(railGeometry, railMaterial)
      rail.rotation.y = Math.PI / 2
      rail.position.set(x, -0.17, 0)
      this.scene.add(rail)
    }

    const socketGeometry = this.trackGeometry(new THREE.CylinderGeometry(0.17, 0.19, 0.11, 12))
    const socketMaterial = this.trackMaterial(new THREE.MeshStandardMaterial({
      color: COLOR.gold,
      emissive: 0x7e4e15,
      emissiveIntensity: 0.4,
      metalness: 0.58,
      roughness: 0.3,
    }))
    for (const x of [-5.55, 5.55]) {
      for (const z of [-5.55, 5.55]) {
        const socket = new THREE.Mesh(socketGeometry, socketMaterial)
        socket.position.set(x, -0.16, z)
        this.scene.add(socket)
      }
    }
  }

  private addTiles(): void {
    const recessGeometry = this.trackGeometry(new THREE.BoxGeometry(TILE_SIZE + 0.12, 0.1, TILE_SIZE + 0.12))
    const recessMaterial = this.trackMaterial(new THREE.MeshStandardMaterial({
      color: 0x07131a,
      metalness: 0.55,
      roughness: 0.46,
    }))
    const slabGeometry = this.trackGeometry(new THREE.BoxGeometry(TILE_SIZE, 1, TILE_SIZE))
    const glyphGeometry = this.trackGeometry(new THREE.PlaneGeometry(0.61, 0.76))
    const borderBox = this.trackGeometry(new THREE.BoxGeometry(TILE_SIZE + 0.015, 0.016, TILE_SIZE + 0.015))
    const borderGeometry = this.trackGeometry(new THREE.EdgesGeometry(borderBox))
    const pinGeometry = this.trackGeometry(new THREE.BoxGeometry(0.14, 0.04, 0.14))
    const pinMaterial = this.trackMaterial(new THREE.MeshBasicMaterial({ color: COLOR.gold }))

    for (let bit = LAST_BIT; bit >= 0; bit--) {
      const { x, z } = gridPosition(bit)
      const recess = new THREE.Mesh(recessGeometry, recessMaterial)
      recess.position.set(x, -0.1, z)
      this.scene.add(recess)

      const slab = new THREE.Mesh(slabGeometry, this.trackMaterial(new THREE.MeshStandardMaterial({
        color: COLOR.off,
        emissive: 0x071719,
        emissiveIntensity: 0.28,
        metalness: 0.37,
        roughness: 0.38,
      })))
      slab.position.set(x, 0.05, z)
      slab.userData.bit = bit
      this.scene.add(slab)
      this.pickable.push(slab)

      const glyph = new THREE.Mesh(glyphGeometry, this.trackMaterial(new THREE.MeshBasicMaterial({
        color: COLOR.lime,
        map: this.zeroTexture,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      })))
      glyph.rotation.x = -Math.PI / 2
      glyph.position.set(x, 0.15, z)
      this.scene.add(glyph)

      const border = new THREE.LineSegments(borderGeometry, this.trackMaterial(new THREE.LineBasicMaterial({
        color: COLOR.gold,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })))
      border.position.set(x, 0.15, z)
      this.scene.add(border)

      const targetPin = new THREE.Mesh(pinGeometry, pinMaterial)
      targetPin.position.set(x - 0.42, 0.16, z - 0.42)
      targetPin.visible = false
      this.scene.add(targetPin)

      this.tiles.push({ bit, slab, glyph, border, targetPin, elevation: 0 })
    }
  }

  private addAmbientDust(): void {
    const positions = new Float32Array(115 * 3)
    const colors = new Float32Array(115 * 3)
    for (let index = 0; index < 115; index++) {
      const seed = index * 12.9898
      const angle = index * 2.399963
      const radius = 7.5 + ((Math.sin(seed) * 43758.5453) % 1 + 1) % 1 * 14
      const at = index * 3
      positions[at] = Math.cos(angle) * radius
      positions[at + 1] = Math.sin(index * 27.17) * 3.7 + 0.4
      positions[at + 2] = Math.sin(angle) * radius
      const tint = index % 7 === 0 ? [0.82, 0.37, 0.64] : [0.23, 0.64, 0.68]
      colors.set(tint, at)
    }
    const geometry = this.trackGeometry(new THREE.BufferGeometry())
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const dust = new THREE.Points(geometry, this.trackMaterial(new THREE.PointsMaterial({
      size: 0.095,
      vertexColors: true,
      transparent: true,
      opacity: 0.57,
      depthWrite: false,
    })))
    this.scene.add(dust)
  }

  private paintTiles(alpha: number): void {
    const { width, value, target, preview, selectedBit, activeMask } = this.state
    for (const tile of this.tiles) {
      const active = tile.bit < width
      const isOn = active && hasBit(value, tile.bit)
      const previewOn = active && preview != null && hasBit(preview, tile.bit)
      const changed = active && preview != null && previewOn !== isOn
      const masked = active && hasBit(activeMask ?? 0n, tile.bit)
      const isTarget = active && hasBit(target, tile.bit)
      const displayedOn = changed ? previewOn : isOn
      const elevationGoal = active ? (displayedOn ? 0.3 : 0) : -0.055
      tile.elevation += (elevationGoal - tile.elevation) * alpha
      const height = Math.max(0.11, 0.18 + tile.elevation)
      const top = -0.04 + height
      tile.slab.scale.y = height
      tile.slab.position.y = -0.04 + height / 2
      tile.glyph.position.y = top + 0.012
      tile.border.position.y = top + 0.01
      tile.targetPin.position.y = top + 0.035

      const color = !active
        ? this.inactiveColor
        : changed
          ? (previewOn ? this.previewOnColor : this.previewOffColor)
          : (isOn ? this.onColor : this.offColor)
      tile.slab.material.color.lerp(color, alpha)
      tile.slab.material.emissive.copy(tile.slab.material.color).multiplyScalar(active ? 0.25 : 0.06)
      tile.glyph.material.map = displayedOn ? this.oneTexture : this.zeroTexture
      tile.glyph.material.color.setHex(!active ? 0x3a5056 : changed ? (previewOn ? COLOR.cyan : COLOR.magenta) : displayedOn ? COLOR.lime : 0x6c9395)
      tile.glyph.material.opacity = active ? 1 : 0.28
      tile.targetPin.visible = isTarget
      tile.border.visible = active && (selectedBit === tile.bit || changed || masked || isTarget)
      tile.border.material.color.setHex(selectedBit === tile.bit
        ? COLOR.white
        : changed
          ? (previewOn ? COLOR.cyan : COLOR.magenta)
          : masked
            ? COLOR.cyan
            : COLOR.gold)
      tile.border.material.opacity = selectedBit === tile.bit ? 1 : changed ? 0.95 : masked ? 0.72 : 0.58
    }
  }

  private positionCamera(snap: boolean): void {
    const width = this.state.width
    if (width === 4) {
      this.focusGoal.set(2.68, 0, 4.69)
      this.cameraGoal.set(2.68 + 5.3, 7.0, 4.69 + 7.8)
    } else if (width === 8) {
      this.focusGoal.set(0, 0, 4.69)
      this.cameraGoal.set(8.8, 10.2, 16.9)
    } else {
      this.focusGoal.set(0, 0, 0)
      this.cameraGoal.set(13.7, 17.2, 19.4)
    }
    // On narrow screens the lesson is a bottom sheet; aim below the board so
    // the playable tiles stay in the open space above it.
    if (typeof window !== 'undefined' && window.innerWidth <= 700) {
      this.focusGoal.y = width === 4 ? -3 : width === 8 ? -4 : -5
    }
    const portraitScale = THREE.MathUtils.clamp(1 / Math.max(this.camera.aspect, 0.48), 1, 1.9)
    this.cameraGoal.sub(this.focusGoal).multiplyScalar(portraitScale).add(this.focusGoal)
    if (snap) {
      this.camera.position.copy(this.cameraGoal)
      this.focus.copy(this.focusGoal)
      this.camera.lookAt(this.focus)
    }
  }

  private placePulse(progress: number): void {
    if (this.pulsePath.length === 0) return
    const segment = progress * Math.max(0, this.pulsePath.length - 1)
    const index = Math.min(Math.floor(segment), this.pulsePath.length - 1)
    const next = Math.min(index + 1, this.pulsePath.length - 1)
    this.pulse.position.copy(this.pulsePath[index]).lerp(this.pulsePath[next], segment - index)
    this.pulse.position.y = this.reducedMotion ? 0.58 : 0.58 + Math.sin(this.elapsed * 16) * 0.055
  }

  private makeGlowTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const context = canvas.getContext('2d')
    if (context) {
      const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 31)
      gradient.addColorStop(0, 'rgba(255,255,255,1)')
      gradient.addColorStop(0.25, 'rgba(194,255,255,0.7)')
      gradient.addColorStop(1, 'rgba(60,238,255,0)')
      context.fillStyle = gradient
      context.fillRect(0, 0, 64, 64)
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  private trackGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.add(geometry)
    return geometry
  }

  private trackMaterial<T extends THREE.Material>(material: T): T {
    this.materials.add(material)
    return material
  }

  private trackTexture<T extends THREE.Texture>(texture: T): T {
    this.textures.add(texture)
    return texture
  }
}
