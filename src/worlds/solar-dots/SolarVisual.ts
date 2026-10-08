import * as THREE from 'three'

const DISK_RADIUS = 34
const CORE_RADIUS = 2.45
const BASE_DISTANCE = 86

/** Procedural solar scene. AppShell owns the renderer, resize, and frame loop. */
export class SolarVisual {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 700)

  private readonly capacity: number
  private readonly dustPositions: Float32Array
  private readonly dustColors: Float32Array
  private readonly emberPositions: Float32Array
  private readonly emberColors: Float32Array
  private readonly dustGeometry = new THREE.BufferGeometry()
  private readonly emberGeometry = new THREE.BufferGeometry()
  private readonly core: THREE.Mesh
  private readonly nebula: THREE.Sprite
  private readonly violetGlow: THREE.Sprite
  private readonly outerGlow: THREE.Sprite
  private readonly innerGlow: THREE.Sprite
  private readonly corona: THREE.Points
  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly materials: THREE.Material[] = []
  private readonly textures: THREE.Texture[] = []
  private targetAzimuth = 0
  private azimuth = 0
  private targetElevation = 0.53
  private elevation = 0.53
  private targetDistance = BASE_DISTANCE
  private distance = BASE_DISTANCE
  private userZoomed = false
  private elapsed = 0
  private disposed = false

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(Number.isFinite(capacity) ? capacity : 1))
    this.scene.background = new THREE.Color(0x100820)

    const particleTexture = this.trackTexture(makeRadialTexture(64, 5.4))
    const glowTexture = this.trackTexture(makeRadialTexture(128, 3.1))
    const nebulaTexture = this.trackTexture(makeNebulaTexture(256))

    this.dustPositions = new Float32Array(this.capacity * 3)
    this.dustColors = new Float32Array(this.capacity * 3)
    this.emberPositions = new Float32Array(this.capacity * 3)
    this.emberColors = new Float32Array(this.capacity * 3)
    configureParticleGeometry(this.dustGeometry, this.dustPositions, this.dustColors)
    configureParticleGeometry(this.emberGeometry, this.emberPositions, this.emberColors)
    this.trackGeometry(this.dustGeometry)
    this.trackGeometry(this.emberGeometry)

    const dustMaterial = this.trackMaterial(new THREE.PointsMaterial({
      size: 0.62,
      map: particleTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      alphaTest: 0.015,
      sizeAttenuation: true,
    }))
    const emberMaterial = this.trackMaterial(new THREE.PointsMaterial({
      size: 0.88,
      map: particleTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    }))
    const dust = new THREE.Points(this.dustGeometry, dustMaterial)
    const embers = new THREE.Points(this.emberGeometry, emberMaterial)
    dust.frustumCulled = false
    embers.frustumCulled = false
    dust.renderOrder = 2
    embers.renderOrder = 3
    this.scene.add(dust, embers)

    this.addStarfield()
    this.addOrbitalGuides()

    this.nebula = new THREE.Sprite(this.trackMaterial(new THREE.SpriteMaterial({
      map: nebulaTexture,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    })))
    this.nebula.scale.set(142, 142, 1)
    this.nebula.renderOrder = -1
    this.scene.add(this.nebula)

    this.violetGlow = new THREE.Sprite(this.trackMaterial(new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0x8e32c1,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    })))
    this.violetGlow.scale.set(72, 72, 1)
    this.violetGlow.renderOrder = 3
    this.scene.add(this.violetGlow)

    this.outerGlow = new THREE.Sprite(this.trackMaterial(new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xffa132,
      transparent: true,
      opacity: 0.61,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    })))
    this.outerGlow.scale.set(36, 36, 1)
    this.outerGlow.renderOrder = 4
    this.scene.add(this.outerGlow)

    this.core = new THREE.Mesh(
      this.trackGeometry(new THREE.SphereGeometry(CORE_RADIUS, 32, 20)),
      this.trackMaterial(new THREE.MeshBasicMaterial({ color: 0xffbc50 })),
    )
    this.core.renderOrder = 5
    this.scene.add(this.core)

    this.innerGlow = new THREE.Sprite(this.trackMaterial(new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xffd88a,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    })))
    this.innerGlow.scale.set(8, 8, 1)
    this.innerGlow.renderOrder = 6
    this.scene.add(this.innerGlow)

    this.corona = this.makeCorona(particleTexture)
    this.scene.add(this.corona)
    this.update(0)
  }

  /** Copies orbiting bodies into two dynamic point batches. Faster bodies burn warmer. */
  setParticles(positions: Float32Array, states: Uint8Array, count: number, velocities?: Float32Array): void {
    if (this.disposed) return
    const length = Math.min(this.capacity, Math.max(0, Math.floor(count)), states.length, Math.floor(positions.length / 3))
    let dustCount = 0
    let emberCount = 0

    for (let index = 0; index < length; index++) {
      const state = states[index]
      if (state !== 1) continue
      const source = index * 3
      const x = positions[source]
      const y = positions[source + 1]
      const z = positions[source + 2]
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue

      const radius = Math.hypot(x, z)
      const innerHeat = THREE.MathUtils.clamp(1 - (radius - 8) / 27, 0, 1)
      const speedHeat = velocities && velocities.length >= source + 3
        ? THREE.MathUtils.clamp(Math.hypot(velocities[source], velocities[source + 1], velocities[source + 2]) / 11, 0, 1)
        : innerHeat
      const visualHeat = innerHeat * 0.35 + speedHeat * 0.65
      const bright = hash01(index) > 0.7 - visualHeat * 0.1 || (innerHeat > 0.82 && hash01(index + 17) > 0.58)
      if (bright) {
        const target = emberCount * 3
        this.emberPositions[target] = x
        this.emberPositions[target + 1] = y
        this.emberPositions[target + 2] = z
        const heat = 0.57 + 0.43 * visualHeat
        if (hash01(index + 117) < 0.22 * (1 - visualHeat) + 0.04) {
          this.emberColors[target] = heat * 0.67
          this.emberColors[target + 1] = heat * 0.25
          this.emberColors[target + 2] = heat * 0.88
        } else {
          this.emberColors[target] = heat
          this.emberColors[target + 1] = heat * (0.32 + visualHeat * 0.35 + hash01(index + 31) * 0.12)
          this.emberColors[target + 2] = heat * 0.08
        }
        emberCount++
      } else {
        const target = dustCount * 3
        this.dustPositions[target] = x
        this.dustPositions[target + 1] = y
        this.dustPositions[target + 2] = z
        const shade = 0.66 + hash01(index + 83) * 0.29 + innerHeat * 0.1
        this.dustColors[target] = shade * (0.35 + visualHeat * 0.13)
        this.dustColors[target + 1] = shade * 0.24
        this.dustColors[target + 2] = shade * (0.72 - visualHeat * 0.19)
        dustCount++
      }
    }

    this.dustGeometry.setDrawRange(0, dustCount)
    this.emberGeometry.setDrawRange(0, emberCount)
    markUpdated(this.dustGeometry, dustCount)
    markUpdated(this.emberGeometry, emberCount)
  }

  update(dt: number): void {
    if (this.disposed) return
    const frame = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, 0.1) : 0
    this.elapsed += frame
    const catchUp = frame === 0 ? 1 : 1 - Math.exp(-7 * frame)
    this.azimuth = THREE.MathUtils.lerp(this.azimuth, this.targetAzimuth, catchUp)
    this.elevation = THREE.MathUtils.lerp(this.elevation, this.targetElevation, catchUp)

    // Fit the first view to the viewport, then let explicit zoom crop the disk.
    const aspect = THREE.MathUtils.clamp(this.camera.aspect || 1, 0.36, 3)
    const mobileCrop = THREE.MathUtils.clamp((0.82 - aspect) / 0.38, 0, 1)
    const wantedDistance = this.userZoomed ? this.targetDistance : Math.max(this.targetDistance, this.fitDistance())
    this.distance = THREE.MathUtils.lerp(this.distance, wantedDistance, catchUp)

    const flat = this.distance * Math.cos(this.elevation)
    this.camera.position.set(
      Math.sin(this.azimuth) * flat,
      Math.sin(this.elevation) * this.distance,
      Math.cos(this.azimuth) * flat,
    )
    this.camera.lookAt(0, -15 * mobileCrop, 0)

    const breathe = Math.sin(this.elapsed * 2.1) * 0.035
    this.outerGlow.scale.setScalar(36 * (1 + breathe))
    this.violetGlow.scale.setScalar(72 * (1 - breathe * 0.6))
    this.innerGlow.scale.setScalar(8 * (1 + breathe * 0.6))
    this.core.scale.setScalar(1 + breathe * 0.25)
    this.corona.rotation.y += frame * 0.12
  }

  /** Pointer-style pixel deltas: drag to rotate around the attractor. */
  orbit(dx: number, dy: number): void {
    if (this.disposed) return
    if (Number.isFinite(dx)) this.targetAzimuth -= dx * 0.006
    if (Number.isFinite(dy)) {
      this.targetElevation = THREE.MathUtils.clamp(this.targetElevation - dy * 0.005, 0.12, 1.42)
    }
  }

  /** Wheel-style delta: positive moves away, negative moves closer. */
  zoom(delta: number): void {
    if (this.disposed || !Number.isFinite(delta)) return
    const startingDistance = this.userZoomed ? this.targetDistance : Math.max(this.distance, this.fitDistance())
    this.userZoomed = true
    const minimum = this.camera.aspect < 0.7 ? 60 : 40
    this.targetDistance = THREE.MathUtils.clamp(startingDistance * Math.exp(delta * 0.001), minimum, 220)
  }

  private fitDistance(): number {
    const aspect = THREE.MathUtils.clamp(this.camera.aspect || 1, 0.36, 3)
    const verticalHalfAngle = THREE.MathUtils.degToRad(this.camera.fov / 2)
    const mobileCrop = THREE.MathUtils.clamp((0.82 - aspect) / 0.38, 0, 1)
    return (DISK_RADIUS * (1.16 - mobileCrop * 0.4)) / (Math.tan(verticalHalfAngle) * Math.min(1, aspect))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.scene.clear()
    this.geometries.forEach(geometry => geometry.dispose())
    this.materials.forEach(material => material.dispose())
    this.textures.forEach(texture => texture.dispose())
  }

  private addStarfield(): void {
    const count = 1500
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    for (let index = 0; index < count; index++) {
      const z = hash01(index * 3 + 8) * 2 - 1
      const angle = hash01(index * 3 + 9) * Math.PI * 2
      const radial = Math.sqrt(1 - z * z) * 270
      const offset = index * 3
      positions[offset] = Math.cos(angle) * radial
      positions[offset + 1] = z * 270
      positions[offset + 2] = Math.sin(angle) * radial
      const shade = 0.32 + hash01(index * 3 + 10) * 0.54
      colors[offset] = shade * 0.76
      colors[offset + 1] = shade * 0.57
      colors[offset + 2] = shade
    }
    const geometry = this.trackGeometry(new THREE.BufferGeometry())
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const material = this.trackMaterial(new THREE.PointsMaterial({
      size: 1.55,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }))
    this.scene.add(new THREE.Points(geometry, material))
  }

  private addOrbitalGuides(): void {
    for (const [radius, opacity] of [[8, 0.13], [21, 0.09], [34, 0.17]] as const) {
      const count = 192
      const positions = new Float32Array(count * 3)
      for (let index = 0; index < count; index++) {
        const angle = index / count * Math.PI * 2
        positions[index * 3] = Math.cos(angle) * radius
        positions[index * 3 + 1] = -0.35
        positions[index * 3 + 2] = Math.sin(angle) * radius
      }
      const geometry = this.trackGeometry(new THREE.BufferGeometry())
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const material = this.trackMaterial(new THREE.LineBasicMaterial({
        color: radius === 34 ? 0x905e7f : 0xa56c59,
        transparent: true,
        opacity,
        depthWrite: false,
      }))
      this.scene.add(new THREE.LineLoop(geometry, material))
    }
  }

  private makeCorona(texture: THREE.Texture): THREE.Points {
    const count = 520
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    for (let index = 0; index < count; index++) {
      const radius = 2.8 + hash01(index * 7 + 2) * 5.2
      const arm = index % 3
      const angle = radius * 1.42 + arm * Math.PI * 2 / 3 + (hash01(index * 7 + 3) - 0.5) * 0.7
      const offset = index * 3
      positions[offset] = Math.cos(angle) * radius
      positions[offset + 1] = (hash01(index * 7 + 4) - 0.5) * 0.36
      positions[offset + 2] = Math.sin(angle) * radius
      const falloff = 1 - (radius - 2.8) / 9
      colors[offset] = 0.88 * falloff
      colors[offset + 1] = 0.46 * falloff
      colors[offset + 2] = 0.12 * falloff
    }
    const geometry = this.trackGeometry(new THREE.BufferGeometry())
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const material = this.trackMaterial(new THREE.PointsMaterial({
      size: 0.56,
      map: texture,
      vertexColors: true,
      transparent: true,
      opacity: 0.74,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }))
    const corona = new THREE.Points(geometry, material)
    corona.renderOrder = 4
    return corona
  }

  private trackGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry)
    return geometry
  }

  private trackMaterial<T extends THREE.Material>(material: T): T {
    this.materials.push(material)
    return material
  }

  private trackTexture<T extends THREE.Texture>(texture: T): T {
    this.textures.push(texture)
    return texture
  }
}

function configureParticleGeometry(geometry: THREE.BufferGeometry, positions: Float32Array, colors: Float32Array): void {
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setDrawRange(0, 0)
}

function markUpdated(geometry: THREE.BufferGeometry, count: number): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const color = geometry.getAttribute('color') as THREE.BufferAttribute
  if (count > 0) {
    position.addUpdateRange(0, count * 3)
    color.addUpdateRange(0, count * 3)
  }
  position.needsUpdate = true
  color.needsUpdate = true
}

function makeRadialTexture(size: number, falloff: number): THREE.DataTexture {
  const pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size - 0.5) * 2
      const dy = ((y + 0.5) / size - 0.5) * 2
      const radiusSquared = dx * dx + dy * dy
      const offset = (y * size + x) * 4
      pixels[offset] = 255
      pixels[offset + 1] = 255
      pixels[offset + 2] = 255
      pixels[offset + 3] = Math.round(Math.exp(-radiusSquared * falloff) * 255 * THREE.MathUtils.clamp(1 - radiusSquared, 0, 1))
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

function makeNebulaTexture(size: number): THREE.DataTexture {
  const pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size - 0.5) * 2
      const v = ((y + 0.5) / size - 0.5) * 2
      const radius = Math.hypot(u, v)
      const angle = Math.atan2(v, u)
      const billow = Math.sin(u * 10 + v * 4 + Math.sin(v * 7) * 1.8)
      const fold = Math.cos(v * 13 - u * 6 + Math.sin(u * 5) * 1.5)
      const spiral = Math.sin(angle * 7 + radius * 16)
      const density = Math.pow(Math.max(0, 1 - radius * radius), 1.55)
        * THREE.MathUtils.smoothstep(radius, 0.08, 0.38)
        * (0.53 + 0.16 * billow + 0.15 * fold + 0.12 * spiral)
      const offset = (y * size + x) * 4
      pixels[offset] = Math.round(126 + 31 * spiral)
      pixels[offset + 1] = Math.round(31 + 14 * billow)
      pixels[offset + 2] = Math.round(179 + 35 * fold)
      pixels[offset + 3] = Math.round(170 * THREE.MathUtils.clamp(density, 0, 1))
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

function hash01(value: number): number {
  let hash = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  hash ^= hash >>> 16
  return (hash >>> 0) / 0xffffffff
}
