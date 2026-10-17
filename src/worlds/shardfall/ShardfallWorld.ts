import * as THREE from 'three'
import type { PlanetHost } from '../../app/PlanetContracts.ts'
import { ShardfallAudio } from './Audio.ts'
import { CameraFeedback, type ImpactFeedback } from './CameraFeedback.ts'
import { buildCity, CITIES } from './cities.ts'
import { ShardfallEffects } from './Effects.ts'
import { ShardfallHud } from './Hud.ts'
import { buildPlanet, buildPlanetSurface, SURFACE_CELL_SIZE, SURFACE_OFFSET, TERRAIN_CELL_SIZE } from './planet.ts'
import { VoxelField, type VoxelHit } from './VoxelField.ts'
import { CITY_CELL_SIZE, PLANET_RADIUS, WEAPONS, type CityId, type ShardfallActions, type ShardfallState, type ViewLevel, type WeaponId } from './types.ts'

interface CityRuntime {
  field: VoxelField
  fields: VoxelField[]
  normal: THREE.Vector3
  rotation: THREE.Quaternion
  beacon: THREE.Group
  traffic: { mesh: THREE.Group; from: THREE.Vector3; to: THREE.Vector3; phase: number }[]
}
interface DelayedBlast { delay: number; point: THREE.Vector3; radius: number; color: number; feedback: ImpactFeedback; chain: boolean }

const UP = new THREE.Vector3(0, 1, 0)
const BASE_ZOOM: Record<ViewLevel, number> = { orbit: 0, city: 0.72, street: 1 }

export class ShardfallWorld {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(44, 1, 0.05, 1800)
  private readonly cube = new THREE.BoxGeometry(1, 1, 1)
  private readonly gradient: THREE.DataTexture
  private readonly solidMaterial: THREE.MeshToonMaterial
  private readonly glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
  private readonly terrain: VoxelField
  private readonly surface: VoxelField
  private readonly fields: VoxelField[] = []
  private readonly cities = new Map<CityId, CityRuntime>()
  private readonly effects: ShardfallEffects
  private readonly audio = new ShardfallAudio()
  private readonly raycaster = new THREE.Raycaster()
  private readonly aimCamera = new THREE.PerspectiveCamera()
  private readonly feedback = new CameraFeedback()
  private readonly pointer = new THREE.Vector2()
  private readonly cameraRotation = new THREE.Quaternion()
  private readonly wantedRotation = new THREE.Quaternion()
  private readonly sun = new THREE.DirectionalLight(0xffe5c5, 2.7)
  private readonly rim = new THREE.DirectionalLight(0x83cfff, 1.7)
  private readonly focus = new THREE.Vector3()
  private readonly viewPosition = new THREE.Vector3()
  private readonly pending: DelayedBlast[] = []
  private readonly ownedGeometry: THREE.BufferGeometry[] = []
  private readonly ownedMaterial: THREE.Material[] = []
  private readonly marker: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  private atmosphere: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null = null
  private readonly motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  private readonly state: ShardfallState = {
    city: 'neon-rift', weapon: 'impact', view: 'orbit', zoom: 0,
    integrity: 100, cityIntegrity: 100, destroyed: 0, shots: 0, heat: 0,
    paused: false, sound: false, message: 'Choose a city. Find something worth breaking.',
  }
  private host: PlanetHost | null = null
  private hud: ShardfallHud | null = null
  private readonly labels = new Map<CityId, HTMLButtonElement>()
  private labelLayer: HTMLDivElement | null = null
  private currentZoom = 0
  private yaw = 0.28
  private pitch = 0
  private dragPointer: number | null = null
  private dragX = 0
  private dragY = 0
  private dragMoved = false
  private orbitGesture = false
  private laserHeld = false
  private centerLaserTime = 0
  private keyboardLaserHeld = false
  private orbitMoved = false
  private pointerInside = false
  private laserTick = 0
  private laserCooling = false
  private cooldown = 0
  private elapsed = 0
  private hudTimer = 0
  private markerTimer = 0
  private disposed = false

  constructor() {
    this.scene.background = new THREE.Color(0x080e24)
    const bands = new Uint8Array([88, 155, 211, 255])
    this.gradient = new THREE.DataTexture(bands, 4, 1, THREE.RedFormat)
    this.gradient.minFilter = this.gradient.magFilter = THREE.NearestFilter
    this.gradient.needsUpdate = true
    this.solidMaterial = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: this.gradient })
    this.scene.add(new THREE.HemisphereLight(0xc2d6ff, 0x493567, 1.8), this.sun, this.rim, this.camera)
    this.terrain = new VoxelField('planet', buildPlanet(), TERRAIN_CELL_SIZE, this.cube, this.solidMaterial, this.glowMaterial, false)
    this.surface = new VoxelField('planet-surface', buildPlanetSurface(), SURFACE_CELL_SIZE, this.cube, this.solidMaterial, this.glowMaterial, false)
    this.surface.group.position.fromArray(SURFACE_OFFSET)
    this.fields.push(this.terrain, this.surface)
    this.scene.add(this.terrain.group, this.surface.group)
    this.createCities()
    this.createSpace()
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffd2a1, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
    const markerGeometry = new THREE.RingGeometry(0.75, 1, 32)
    this.marker = new THREE.Mesh(markerGeometry, markerMaterial)
    this.marker.visible = false
    this.scene.add(this.marker)
    this.ownedMaterial.push(markerMaterial)
    this.ownedGeometry.push(markerGeometry)
    this.effects = new ShardfallEffects(this.scene, this.camera, this.cube, this.solidMaterial, this.motionPreference.matches)
    this.cameraRotation.copy(this.cities.get(this.state.city)!.rotation)
    this.wantedRotation.copy(this.cameraRotation)
    this.resize()
    this.updateCamera(1)
  }

  mount(host: PlanetHost): void {
    this.host = host
    const run = (action: () => void) => { if (host.isInteractive()) action() }
    const actions: ShardfallActions = {
      selectCity: id => run(() => this.selectCity(id)),
      selectWeapon: id => run(() => this.selectWeapon(id)),
      setView: view => run(() => this.setZoom(BASE_ZOOM[view])),
      setZoom: value => run(() => this.setZoom(value)),
      resetCity: () => run(() => this.resetCity()),
      resetPlanet: () => run(() => this.resetPlanet()),
      togglePause: () => run(() => this.togglePause()),
      toggleSound: () => run(() => {
        try { this.state.sound = this.audio.toggle() }
        catch { this.state.sound = false; this.state.message = 'Audio is unavailable in this browser.' }
        this.refreshHud()
      }),
      fire: () => run(() => {
        if (this.state.weapon === 'laser' && !this.state.paused) {
          this.centerLaserTime = 0.55
          this.state.shots++
        }
        else this.fire(true)
      }),
      exit: () => host.onExit(),
    }
    this.hud = new ShardfallHud(CITIES, actions)
    host.uiRoot.replaceChildren(this.hud.element)
    this.createLabels()
    this.hud.update(this.state)
    host.canvas.addEventListener('pointerdown', this.onPointerDown)
    host.canvas.addEventListener('pointermove', this.onPointerMove)
    host.canvas.addEventListener('pointerup', this.onPointerUp)
    host.canvas.addEventListener('pointercancel', this.cancelPointer)
    host.canvas.addEventListener('lostpointercapture', this.cancelPointer)
    host.canvas.addEventListener('pointerleave', this.onPointerLeave)
    host.canvas.addEventListener('wheel', this.onWheel, { passive: false })
    host.canvas.addEventListener('contextmenu', this.onContextMenu)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.cancelPointer)
    window.addEventListener('resize', this.resize)
    document.addEventListener('visibilitychange', this.onVisibility)
    host.canvas.style.cursor = 'crosshair'
  }

  update(delta: number): void {
    if (this.disposed) return
    const dt = Math.min(0.05, Math.max(0, delta))
    const interactive = !!this.host?.isInteractive() && !document.hidden
    if (!interactive) { this.cancelPointer(); this.marker.visible = false }
    this.updateCamera(dt)
    const paused = this.state.paused || !interactive
    this.effects.update(dt, paused)
    if (!paused) {
      this.elapsed += dt
      this.cooldown = Math.max(0, this.cooldown - dt)
      this.updateLaser(dt)
      for (let i = this.pending.length - 1; i >= 0; i--) {
        const event = this.pending[i]
        event.delay -= dt
        if (event.delay <= 0) {
          this.pending.splice(i, 1)
          this.blast(event.point, event.radius, event.color, event.feedback, event.chain)
        }
      }
      for (const city of this.cities.values()) {
        const fraction = city.field.aliveCount / city.field.total
        city.beacon.visible = this.currentZoom < 0.47 && fraction > 0.05
        for (const traffic of city.traffic) {
          traffic.mesh.visible = fraction > 0.75 && this.currentZoom > 0.4
          const progress = (this.elapsed * 0.1 + traffic.phase) % 1
          traffic.mesh.position.lerpVectors(traffic.from, traffic.to, progress)
        }
      }
      this.markerTimer -= dt
      if (this.markerTimer <= 0 && this.pointerInside && !this.orbitGesture && !this.laserHeld) {
        this.markerTimer = 0.09
        const hit = this.pick(false)
        this.marker.visible = !!hit
        if (hit) {
          this.marker.position.copy(hit.point).addScaledVector(hit.point.clone().normalize(), 0.05)
          this.marker.quaternion.copy(this.camera.quaternion)
          this.marker.scale.setScalar(this.currentZoom < 0.4 ? 1.2 : 0.28)
        }
      }
    } else this.effects.laser(null)
    // Apply after weapon updates so the kick begins on the impact frame.
    this.feedback.apply(this.camera, this.camera.position.distanceTo(this.focus), dt,
      !this.motionPreference.matches && !paused)
    this.camera.updateMatrixWorld(true)
    this.effects.syncLaser()
    this.updateLabels()
    this.hudTimer -= dt
    if (this.hudTimer <= 0) { this.hudTimer = 0.12; this.refreshHud() }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const canvas = this.host?.canvas
    if (canvas) {
      canvas.removeEventListener('pointerdown', this.onPointerDown)
      canvas.removeEventListener('pointermove', this.onPointerMove)
      canvas.removeEventListener('pointerup', this.onPointerUp)
      canvas.removeEventListener('pointercancel', this.cancelPointer)
      canvas.removeEventListener('lostpointercapture', this.cancelPointer)
      canvas.removeEventListener('pointerleave', this.onPointerLeave)
      canvas.removeEventListener('wheel', this.onWheel)
      canvas.removeEventListener('contextmenu', this.onContextMenu)
      canvas.style.cursor = ''
    }
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.cancelPointer)
    window.removeEventListener('resize', this.resize)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.cancelPointer()
    this.hud?.dispose()
    this.labelLayer?.remove()
    this.labels.clear()
    this.effects.dispose()
    this.audio.dispose()
    for (const field of this.fields) field.dispose()
    for (const geometry of this.ownedGeometry) geometry.dispose()
    for (const material of this.ownedMaterial) material.dispose()
    this.cube.dispose()
    this.solidMaterial.dispose()
    this.glowMaterial.dispose()
    this.gradient.dispose()
    this.scene.clear()
    this.pending.length = 0
    this.host = null
  }

  private createCities(): void {
    const beaconGeometry = new THREE.CylinderGeometry(0.035, 0.035, 3.2, 5)
    const beaconTip = new THREE.OctahedronGeometry(0.23)
    this.ownedGeometry.push(beaconGeometry, beaconTip)
    for (const definition of CITIES) {
      const blueprint = buildCity(definition)
      const normal = new THREE.Vector3(...definition.normal).normalize()
      const rotation = new THREE.Quaternion().setFromUnitVectors(UP, normal)
      const field = new VoxelField(definition.id, blueprint.cells, CITY_CELL_SIZE, this.cube, this.solidMaterial, this.glowMaterial, true)
      field.group.position.copy(normal).multiplyScalar(PLANET_RADIUS + 0.1)
      field.group.quaternion.copy(rotation)
      const supportPoint = new THREE.Vector3()
      field.anchorSupport = point => {
        // Foundations connect to surviving crust, including the stepped underside of the island.
        if (this.terrain.hasVoxel(point) || this.surface.hasVoxel(point)) return true
        for (const depth of [0.65, 1.3, 1.95]) {
          supportPoint.copy(point).addScaledVector(normal, -depth)
          if (this.terrain.hasVoxel(supportPoint) || this.surface.hasVoxel(supportPoint)) return true
        }
        return false
      }
      this.fields.push(field)
      this.scene.add(field.group)
      const cityFields = [field]
      for (const layer of blueprint.details ?? []) {
        if (!layer.cells.length) continue
        const detail = new VoxelField(definition.id + '-detail-' + layer.cellSize, layer.cells, layer.cellSize, this.cube, this.solidMaterial, this.glowMaterial, true)
        detail.group.position.copy(field.group.position)
        detail.group.quaternion.copy(rotation)
        detail.anchorSupport = (point, cell) => cell.parent
          ? field.hasCell(...cell.parent)
          : field.hasVoxel(point)
        cityFields.push(detail)
        this.fields.push(detail)
        this.scene.add(detail.group)
      }
      const beacon = new THREE.Group()
      const material = new THREE.MeshBasicMaterial({ color: definition.color, transparent: true, opacity: 0.7 })
      this.ownedMaterial.push(material)
      const stem = new THREE.Mesh(beaconGeometry, material)
      stem.position.y = 8.5
      const tip = new THREE.Mesh(beaconTip, material)
      tip.position.y = 10.2
      beacon.add(stem, tip)
      field.group.add(beacon)
      const bodyMaterial = new THREE.MeshToonMaterial({ color: definition.palette.secondary, gradientMap: this.gradient })
      const canopyMaterial = new THREE.MeshToonMaterial({ color: 0x173646, gradientMap: this.gradient })
      this.ownedMaterial.push(bodyMaterial, canopyMaterial)
      const traffic = blueprint.traffic.map((route, index) => {
        const material = new THREE.MeshBasicMaterial({ color: route.color })
        this.ownedMaterial.push(material)
        const mesh = new THREE.Group()
        const boat = definition.id === 'tideglass'
        const truck = definition.id === 'ember-forge'
        const hull = new THREE.Mesh(this.cube, bodyMaterial)
        hull.scale.set(boat ? 0.32 : 0.26, 0.1, truck ? 0.64 : 0.48)
        const canopy = new THREE.Mesh(this.cube, canopyMaterial)
        canopy.scale.set(0.19, boat ? 0.06 : 0.12, truck ? 0.35 : 0.21)
        canopy.position.set(0, 0.1, -0.035)
        mesh.add(hull, canopy)
        for (const side of [-1, 1]) {
          const light = new THREE.Mesh(this.cube, material)
          light.scale.set(0.055, 0.045, 0.055)
          light.position.set(side * 0.09, 0.035, 0.25)
          const pod = new THREE.Mesh(this.cube, bodyMaterial)
          pod.scale.set(0.07, 0.065, 0.24)
          pod.position.set(side * 0.18, -0.055, -0.08)
          const engine = new THREE.Mesh(this.cube, material)
          engine.scale.set(0.06, 0.03, 0.13)
          engine.position.set(side * 0.18, -0.055, -0.25)
          mesh.add(light, pod, engine)
        }
        const from = new THREE.Vector3(...route.from)
        const to = new THREE.Vector3(...route.to)
        mesh.position.copy(from)
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), to.clone().sub(from).normalize())
        field.group.add(mesh)
        return { mesh, from, to, phase: index / Math.max(1, blueprint.traffic.length) }
      })
      this.cities.set(definition.id, { field, fields: cityFields, normal, rotation, beacon, traffic })
    }
    this.scene.updateMatrixWorld(true)
  }

  private createSpace(): void {
    const points: number[] = []
    const colors: number[] = []
    const starColor = new THREE.Color()
    let seed = 761
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
    for (let i = 0; i < 1700; i++) {
      const y = random() * 2 - 1, angle = random() * Math.PI * 2, radius = 300 + random() * 500
      points.push(Math.cos(angle) * Math.sqrt(1 - y * y) * radius, y * radius, Math.sin(angle) * Math.sqrt(1 - y * y) * radius)
      starColor.setHSL([0.58, 0.73, 0.1, 0.48][i % 4], 0.25 + random() * 0.25, 0.55 + random() * 0.3)
      colors.push(starColor.r, starColor.g, starColor.b)
    }
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
      .setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    const material = new THREE.PointsMaterial({ vertexColors: true, size: 0.75, sizeAttenuation: true, transparent: true, opacity: 0.8 })
    this.scene.add(new THREE.Points(geometry, material))
    this.ownedGeometry.push(geometry)
    this.ownedMaterial.push(material)
    const orbitGeometry = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 181 }, (_, i) => {
      const angle = i / 180 * Math.PI * 2
      return new THREE.Vector3(Math.cos(angle) * 35.5, Math.sin(angle) * 7, Math.sin(angle) * 35.5)
    }))
    const orbitMaterial = new THREE.LineBasicMaterial({ color: 0x324353, transparent: true, opacity: 0.35 })
    this.scene.add(new THREE.LineLoop(orbitGeometry, orbitMaterial))
    this.ownedGeometry.push(orbitGeometry)
    this.ownedMaterial.push(orbitMaterial)
    const moonGeometry = new THREE.IcosahedronGeometry(4.5, 1)
    const moonMaterial = new THREE.MeshToonMaterial({ color: 0x576074, gradientMap: this.gradient })
    const moon = new THREE.Mesh(moonGeometry, moonMaterial)
    moon.position.set(-55, 23, -85)
    this.scene.add(moon)
    this.ownedGeometry.push(moonGeometry)
    this.ownedMaterial.push(moonMaterial)
    const atmosphereGeometry = new THREE.SphereGeometry(PLANET_RADIUS + 1.25, 64, 40)
    const atmosphereMaterial = new THREE.ShaderMaterial({
      uniforms: {
        strength: { value: 1 },
        cyan: { value: new THREE.Color(0x62d9f5) },
        violet: { value: new THREE.Color(0x9f7ced) },
      },
      vertexShader: [
        'varying vec3 viewNormal;',
        'varying vec3 viewPosition;',
        'void main() {',
        '  vec4 view = modelViewMatrix * vec4(position, 1.0);',
        '  viewPosition = view.xyz;',
        '  viewNormal = normalize(normalMatrix * normal);',
        '  gl_Position = projectionMatrix * view;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform float strength;',
        'uniform vec3 cyan;',
        'uniform vec3 violet;',
        'varying vec3 viewNormal;',
        'varying vec3 viewPosition;',
        'void main() {',
        '  vec3 n = normalize(viewNormal);',
        '  float rim = pow(1.0 - abs(dot(n, normalize(-viewPosition))), 4.0);',
        '  vec3 tint = mix(violet, cyan, n.y * 0.5 + 0.5);',
        '  gl_FragColor = vec4(tint, rim * 0.33 * strength);',
        '}',
      ].join('\n'),
      transparent: true, depthWrite: false, side: THREE.FrontSide, blending: THREE.AdditiveBlending,
    })
    this.atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial)
    this.scene.add(this.atmosphere)
    this.ownedGeometry.push(atmosphereGeometry)
    this.ownedMaterial.push(atmosphereMaterial)
  }

  private createLabels(): void {
    if (!this.hud) return
    this.labelLayer = document.createElement('div')
    this.labelLayer.className = 'sf-city-markers'
    for (const definition of CITIES) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'sf-city-marker'
      button.style.setProperty('--city-color', definition.color)
      button.textContent = definition.name
      button.setAttribute('aria-label', 'Zoom into ' + definition.name)
      button.addEventListener('click', () => { if (this.host?.isInteractive()) this.selectCity(definition.id) })
      this.labels.set(definition.id, button)
      this.labelLayer.append(button)
    }
    this.hud.element.append(this.labelLayer)
  }

  private updateLabels(): void {
    const width = window.innerWidth, height = window.innerHeight
    for (const [id, button] of this.labels) {
      const city = this.cities.get(id)!
      const point = new THREE.Vector3(0, 10.5, 0).applyMatrix4(city.field.group.matrixWorld)
      const front = this.camera.position.clone().sub(city.field.group.position).dot(city.normal) > 0
      point.project(this.camera)
      const visible = front && this.currentZoom < 0.4 && point.z < 1 && Math.abs(point.x) < 0.9 && Math.abs(point.y) < 0.8
      button.hidden = !visible
      if (visible) {
        button.style.left = (point.x * 0.5 + 0.5) * width + 'px'
        button.style.top = (-point.y * 0.5 + 0.5) * height + 'px'
        button.classList.toggle('is-selected', id === this.state.city)
      }
    }
  }

  private updateCamera(dt: number): void {
    const blend = this.motionPreference.matches ? 1 : 1 - Math.exp(-dt * 5)
    this.currentZoom = THREE.MathUtils.lerp(this.currentZoom, this.state.zoom, blend)
    this.cameraRotation.slerp(this.wantedRotation, blend)
    const zoom = this.currentZoom
    const narrow = Math.max(1, 0.85 / this.camera.aspect)
    const orbitDistance = Math.max(100, 69 / this.camera.aspect)
    const distance = zoom <= 0.72
      ? THREE.MathUtils.lerp(orbitDistance, 23 * narrow, zoom / 0.72)
      : THREE.MathUtils.lerp(23 * narrow, 11.5 * narrow, (zoom - 0.72) / 0.28)
    const focusRadius = PLANET_RADIUS * THREE.MathUtils.smoothstep(zoom, 0.04, 0.72) + 1.6 * THREE.MathUtils.smoothstep(zoom, 0.5, 1)
    const elevation = THREE.MathUtils.lerp(1.23, 0.67, zoom) + this.pitch
    const horizontal = Math.cos(elevation) * distance
    this.viewPosition.set(Math.sin(this.yaw) * horizontal, focusRadius + Math.sin(elevation) * distance, Math.cos(this.yaw) * horizontal)
    this.focus.set(0, focusRadius, 0)
    // Leave clear space beside the planet for the city rail on wider screens.
    if (this.camera.aspect > 1.3) this.focus.x = THREE.MathUtils.lerp(-7, -1.8, zoom)
    this.viewPosition.applyQuaternion(this.cameraRotation)
    this.focus.applyQuaternion(this.cameraRotation)
    this.camera.position.copy(this.viewPosition)
    this.camera.up.set(0, zoom, -(1 - zoom)).normalize().applyQuaternion(this.cameraRotation)
    this.camera.lookAt(this.focus)
    // Keep weapon rays stable while the rendered camera carries the impact vibration.
    this.aimCamera.copy(this.camera, false)
    this.aimCamera.updateMatrixWorld(true)
    this.camera.updateMatrixWorld(true)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion)
    const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion)
    this.sun.position.copy(this.camera.position).addScaledVector(right, -50).addScaledVector(cameraUp, 70)
    this.rim.position.copy(this.camera.position).multiplyScalar(-0.7).addScaledVector(right, 50)
  }

  private selectCity(id: CityId): void {
    const city = this.cities.get(id)
    if (!city) return
    this.state.city = id
    this.wantedRotation.copy(city.rotation)
    this.orbitMoved = false
    this.yaw = 0.48
    this.pitch = 0
    this.cancelPointer()
    this.setZoom(0.72)
    this.state.message = CITIES.find(item => item.id === id)!.description
    this.refreshHud()
  }

  private selectWeapon(id: WeaponId): void {
    if (!WEAPONS.some(item => item.id === id)) return
    this.state.weapon = id
    this.laserHeld = false
    this.keyboardLaserHeld = false
    this.centerLaserTime = 0
    this.feedback.laser(0)
    this.effects.laser(null)
    this.effects.setWeapon(id)
    this.state.message = WEAPONS.find(item => item.id === id)!.description
    this.refreshHud()
  }

  private setZoom(value: number): void {
    if (this.orbitMoved && this.state.zoom < 0.42 && value >= 0.42) {
      const front = new THREE.Vector3(0, 1, 0).applyQuaternion(this.wantedRotation)
      const nearest = [...this.cities.entries()].sort((a, b) => b[1].normal.dot(front) - a[1].normal.dot(front))[0]
      this.state.city = nearest[0]
      this.wantedRotation.copy(nearest[1].rotation)
      this.orbitMoved = false
      this.yaw = 0.48
      this.pitch = 0
    }
    this.state.zoom = THREE.MathUtils.clamp(value, 0, 1)
    this.state.view = value < 0.42 ? 'orbit' : value < 0.88 ? 'city' : 'street'
    this.refreshHud()
  }

  private pick(center: boolean): VoxelHit | null {
    this.raycaster.setFromCamera(center ? new THREE.Vector2(0, 0) : this.pointer, this.aimCamera)
    let closest: VoxelHit | null = null
    for (const field of this.fields) {
      if (!field.aliveCount) continue
      const hit = field.raycast(this.raycaster.ray)
      if (hit && (!closest || hit.distance < closest.distance)) closest = hit
    }
    return closest
  }

  private fire(center = false): void {
    if (this.state.paused || this.cooldown > 0 || !this.host?.isInteractive()) return
    const hit = this.pick(center)
    if (!hit) { this.state.message = 'Aim at the planet or a city to fire.'; return }
    this.state.shots++
    const weapon = this.state.weapon
    this.cooldown = weapon === 'pulse' ? 1.1 : weapon === 'cluster' ? 0.75 : 0.4
    this.audio.play('launch')
    const point = hit.point.clone()
    if (weapon === 'cluster') {
      const split = point.clone().addScaledVector(this.raycaster.ray.direction, -5)
      this.effects.fire('cluster', split, position => {
        const normal = point.clone().normalize()
        const tangent = new THREE.Vector3(1, 0, 0).cross(normal).normalize()
        if (tangent.lengthSq() < 0.1) tangent.set(0, 0, 1)
        const cross = normal.clone().cross(tangent).normalize()
        this.effects.flash(position, 0.7, 0xd8a0ff)
        for (let i = 0; i < 7; i++) {
          const angle = i * Math.PI / 3
          const target = point.clone()
          if (i) target.addScaledVector(tangent, Math.cos(angle) * 2.2).addScaledVector(cross, Math.sin(angle) * 2.2)
          this.effects.fire('cluster', target, end => this.blast(end, 1.55, 0xe5a7ff, 'cluster'), position, (i - 3) * 0.25)
        }
      })
    } else if (weapon === 'drill') {
      this.effects.fire('drill', point, (end, direction) => {
        this.effects.flash(end, 1, 0xffd45c, true)
        for (let i = 0; i < 7; i++) this.pending.push({
          delay: i * 0.07, point: end.clone().addScaledVector(direction, i * 0.85),
          radius: i === 6 ? 3.5 : 0.9, color: 0xffcf6b, feedback: i === 6 ? 'drill-finale' : 'drill', chain: true,
        })
        this.state.message = 'Drill embedded. Subsurface detonation incoming.'
      })
    } else {
      this.effects.fire(weapon, point, end => this.blast(end, weapon === 'pulse' ? 5 : 2.6, weapon === 'pulse' ? 0x9dadff : 0xffae66, weapon === 'pulse' ? 'pulse' : 'impact'))
    }
    this.refreshHud()
  }

  private blast(point: THREE.Vector3, radius: number, color: number, feedback: ImpactFeedback, chain = true): void {
    const allRemoved = []
    let destroyed = 0
    for (const field of this.fields) {
      const result = field.damage(point, radius, false)
      allRemoved.push(...result.removed)
      destroyed += result.removed.length
      if (field.structural && (result.removed.length || field.group.position.distanceTo(point) < radius + 10)) result.collapsed = field.collapse()
      for (const chunk of result.collapsed) {
        destroyed += chunk.length
        this.effects.collapse(chunk, point)
      }
      if (chain && result.reactors.length && this.pending.length < 24) {
        // One secondary explosion per damaged field avoids a reactor-voxel event storm.
        this.pending.push({ delay: 0.45, point: result.reactors[0], radius: 2.4, color: 0x83ffe7, feedback: 'reactor', chain: false })
      }
    }
    this.effects.debris(allRemoved, point, radius * 2.2)
    this.effects.flash(point, radius, color)
    this.effects.flash(point, radius, color, true)
    this.feedback.impact(feedback, radius)
    this.audio.play(radius > 4 ? 'pulse' : 'impact')
    if (destroyed) this.state.message = destroyed.toLocaleString() + ' voxels fractured. Damage persists until you restore the world.'
    this.refreshHud()
  }

  private updateLaser(dt: number): void {
    this.feedback.laser(0)
    this.centerLaserTime = Math.max(0, this.centerLaserTime - dt)
    const firing = this.state.weapon === 'laser' && (this.laserHeld || this.keyboardLaserHeld || this.centerLaserTime > 0) && !this.laserCooling
    if (!firing) {
      this.effects.laser(null)
      this.state.heat = Math.max(0, this.state.heat - dt * 32)
      if (this.state.heat < 25) this.laserCooling = false
      return
    }
    const hit = this.pick(this.keyboardLaserHeld || this.centerLaserTime > 0)
    this.effects.laser(hit?.point ?? null)
    if (!hit) return
    this.state.heat = Math.min(100, this.state.heat + dt * 24)
    if (this.state.heat >= 100) {
      this.laserCooling = true
      this.effects.laser(null)
      this.state.message = 'Laser cooling. Release to recover energy.'
      return
    }
    this.feedback.laser(0.65 + this.state.heat * 0.0035)
    this.laserTick -= dt
    if (this.laserTick <= 0) {
      this.laserTick = 0.09
      const point = hit.point.clone().addScaledVector(this.raycaster.ray.direction, 0.25)
      for (const field of this.fields) {
        const damage = field.damage(point, 0.48, false)
        if (field.structural && (damage.removed.length || field.group.position.distanceTo(point) < 10)) damage.collapsed = field.collapse()
        this.effects.debris(damage.removed, point, 2.5)
        for (const chunk of damage.collapsed) this.effects.collapse(chunk, point)
        if (damage.reactors.length && this.pending.length < 24) this.pending.push({ delay: 0.4, point: damage.reactors[0], radius: 2.4, color: 0x8ffff1, feedback: 'reactor', chain: false })
      }
      this.effects.flash(point, 0.3, 0x8ffaff)
      this.audio.play('laser')
    }
  }

  private resetCity(): void {
    this.stopEffects()
    const city = this.cities.get(this.state.city)!
    for (const field of city.fields) field.reset()
    this.terrain.restoreNear(city.field.group.position, 8.2)
    this.surface.restoreNear(city.field.group.position, 8.2)
    this.state.message = CITIES.find(item => item.id === this.state.city)!.name + ' restored.'
    this.refreshHud()
  }

  private resetPlanet(): void {
    this.stopEffects()
    for (const field of this.fields) field.reset()
    this.state.shots = 0
    this.state.paused = false
    this.state.message = 'Vesper IX restored. All six cities are ready.'
    this.refreshHud()
  }

  private stopEffects(): void {
    this.cancelPointer()
    this.effects.clear()
    this.pending.length = 0
    this.state.heat = 0
    this.laserCooling = false
    this.cooldown = 0
    this.feedback.clear()
  }

  private togglePause(): void {
    this.state.paused = !this.state.paused
    this.cancelPointer()
    this.state.message = this.state.paused ? 'Simulation paused. You can still inspect and zoom.' : 'Simulation resumed.'
    this.refreshHud()
  }

  private refreshHud(): void {
    const total = this.fields.reduce((count, field) => count + field.total, 0)
    const alive = this.fields.reduce((count, field) => count + field.aliveCount, 0)
    this.state.destroyed = total - alive
    this.state.integrity = alive / total * 100
    const city = this.cities.get(this.state.city)!
    const cityTotal = city.fields.reduce((count, field) => count + field.total, 0)
    const cityAlive = city.fields.reduce((count, field) => count + field.aliveCount, 0)
    this.state.cityIntegrity = cityAlive / cityTotal * 100
    if (this.atmosphere) {
      this.atmosphere.material.uniforms.strength.value = Math.min(1, (this.terrain.aliveCount + this.surface.aliveCount) / (this.terrain.total + this.surface.total) * 1.5)
    }
    this.hud?.update(this.state)
  }

  private updatePointer(event: PointerEvent): void {
    if (!this.host) return
    const rect = this.host.canvas.getBoundingClientRect()
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
    this.pointerInside = true
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.host?.isInteractive() || (this.dragPointer !== null && this.dragPointer !== event.pointerId)) return
    this.updatePointer(event)
    this.dragPointer = event.pointerId
    this.dragX = event.clientX
    this.dragY = event.clientY
    this.dragMoved = false
    this.orbitGesture = event.button === 2 || event.button === 1 || event.shiftKey
    if (event.button !== 0 && !this.orbitGesture) return
    this.host.canvas.setPointerCapture(event.pointerId)
    if (this.state.weapon === 'laser' && !this.orbitGesture && !this.state.paused) {
      this.laserHeld = true
      this.state.shots++
    }
    event.preventDefault()
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.updatePointer(event)
    if (this.dragPointer !== event.pointerId || !this.host?.isInteractive()) return
    const dx = event.clientX - this.dragX, dy = event.clientY - this.dragY
    if (Math.hypot(dx, dy) > 5) this.dragMoved = true
    if (this.orbitGesture || (event.pointerType === 'touch' && this.dragMoved && !this.laserHeld)) {
      this.orbitGesture = true
      this.orbit(dx * 0.008, dy * 0.005)
      this.marker.visible = false
      this.dragX = event.clientX
      this.dragY = event.clientY
    }
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.dragPointer !== event.pointerId) return
    const shouldFire = !this.orbitGesture && !this.dragMoved && this.state.weapon !== 'laser' && event.button === 0
    this.updatePointer(event)
    this.cancelPointer()
    if (shouldFire) this.fire()
  }

  private readonly cancelPointer = (): void => {
    const pointer = this.dragPointer
    this.dragPointer = null
    this.orbitGesture = false
    this.laserHeld = false
    this.keyboardLaserHeld = false
    this.centerLaserTime = 0
    this.feedback.laser(0)
    this.effects?.laser(null)
    if (pointer !== null && this.host?.canvas.hasPointerCapture(pointer)) this.host.canvas.releasePointerCapture(pointer)
  }
  private readonly onPointerLeave = (): void => {
    this.pointerInside = false
    this.marker.visible = false
    if (this.dragPointer === null) {
      this.laserHeld = false
      if (!this.keyboardLaserHeld && this.centerLaserTime <= 0) this.feedback.laser(0)
    }
  }
  private readonly onVisibility = (): void => { if (document.hidden) this.cancelPointer() }
  private readonly onContextMenu = (event: MouseEvent): void => { if (this.host?.isInteractive()) event.preventDefault() }
  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.host?.isInteractive()) return
    event.preventDefault()
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1
    this.setZoom(this.state.zoom - event.deltaY * units * 0.00065)
  }
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.host?.isInteractive() || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.target instanceof HTMLElement) {
      if (event.target.closest('input, select, textarea, [contenteditable="true"]')) return
      if (event.target.closest('button, a') && (event.code === 'Space' || event.code === 'Enter')) return
    }
    const weapon = WEAPONS.find(item => event.code === 'Digit' + item.key)
    if (weapon) { this.selectWeapon(weapon.id); return }
    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      event.preventDefault()
      this.orbit(event.code === 'ArrowLeft' ? -0.08 : 0.08, 0)
    } else if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
      event.preventDefault()
      this.orbit(0, event.code === 'ArrowUp' ? -0.05 : 0.05)
    } else if (event.code === 'Equal' || event.code === 'NumpadAdd') this.setZoom(this.state.zoom + 0.08)
    else if (event.code === 'Minus' || event.code === 'NumpadSubtract') this.setZoom(this.state.zoom - 0.08)
    else if (!event.repeat && event.code === 'KeyV') this.setZoom(0)
    else if (!event.repeat && event.code === 'KeyP') this.togglePause()
    else if (!event.repeat && event.code === 'KeyR') this.resetCity()
    else if (event.code === 'Space') {
      event.preventDefault()
      if (this.state.weapon === 'laser' && !this.state.paused) {
        if (!this.keyboardLaserHeld) this.state.shots++
        this.keyboardLaserHeld = true
      }
      else if (!event.repeat) this.fire(true)
    }
  }
  private orbit(dx: number, dy: number): void {
    if (this.currentZoom >= 0.42) {
      this.yaw -= dx
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy, -0.38, 0.28)
      return
    }
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.aimCamera.quaternion)
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.aimCamera.quaternion)
    this.wantedRotation.premultiply(new THREE.Quaternion().setFromAxisAngle(up, -dx))
    this.wantedRotation.premultiply(new THREE.Quaternion().setFromAxisAngle(right, -dy))
    this.wantedRotation.normalize()
    this.orbitMoved = true
  }
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') {
      this.centerLaserTime = 0
      this.keyboardLaserHeld = false
      if (!this.laserHeld) this.feedback.laser(0)
    }
  }
  private readonly resize = (): void => {
    this.camera.aspect = Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight)
    this.camera.updateProjectionMatrix()
    this.aimCamera.aspect = this.camera.aspect
    this.aimCamera.updateProjectionMatrix()
  }
}
