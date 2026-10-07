import * as THREE from 'three'
import type { PlanetDefinition } from '../app/PlanetContracts.ts'
import { ShipController, type ShipActions } from './ShipController.ts'
import {
  differenceSpacePosition,
  distanceBetweenSpacePositions,
  offsetSpacePosition,
  type SpacePosition,
} from './SpacePosition.ts'

const FIXED_STEP = 1 / 60
const STAR_CELL_SIZE = 512
const STARS_PER_CELL = 15
const PLANET_FULL_DISTANCE = 1200
const PLANET_MARKER_DISTANCE = 1900

interface PlanetProxy {
  definition: PlanetDefinition
  group: THREE.Group
  radius: number
  body: THREE.Mesh
  atmosphere: THREE.Mesh
}

/** Space rendering and flight, with no renderer, DOM, or input listener of its own. */
export class SpaceSession {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(68, 1, 0.1, 2800)

  private readonly controller = new ShipController()
  private readonly ship: THREE.Group
  private readonly thrusterGlows: THREE.Mesh[] = []
  private readonly planets: PlanetProxy[] = []
  private readonly starDome: THREE.Points
  private readonly nearbyStars: THREE.Points
  private readonly ambient = new THREE.HemisphereLight(0x94bce8, 0x14203d, 1.15)
  private readonly sun = new THREE.DirectionalLight(0xffe9cb, 2.4)
  private readonly shipHull = new THREE.MeshStandardMaterial({
    color: 0xd6e9f6,
    metalness: 0.62,
    roughness: 0.28,
    flatShading: true,
  })
  private readonly canopy = new THREE.MeshPhysicalMaterial({
    color: 0x45d7ed,
    metalness: 0.35,
    roughness: 0.16,
    transparent: true,
    opacity: 0.87,
    clearcoat: 1,
  })
  private readonly engineMaterial = new THREE.MeshBasicMaterial({ color: 0x6cecff })
  private readonly desiredCamera = new THREE.Vector3()
  private readonly cameraTarget = new THREE.Vector3()
  private readonly cameraUp = new THREE.Vector3()
  private readonly cameraAttitude = new THREE.Quaternion()
  private readonly forward = new THREE.Vector3()
  private readonly planetVector = new THREE.Vector3()
  private readonly currentStarCell: [number, number, number] = [NaN, NaN, NaN]
  private accumulator = 0
  private elapsed = 0
  private held = false

  constructor(definitions: readonly PlanetDefinition[]) {
    this.scene.background = new THREE.Color(0x020917)
    this.sun.position.set(-100, 150, -200)
    this.scene.add(this.ambient, this.sun)

    this.ship = this.createShip()
    this.scene.add(this.ship)

    this.starDome = createStarDome()
    this.nearbyStars = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color: 0xa2ceff, size: 2.4, sizeAttenuation: false }),
    )
    this.scene.add(this.starDome, this.nearbyStars)

    definitions.forEach((definition, index) => {
      const proxy = createPlanetProxy(definition, index)
      this.planets.push(proxy)
      this.scene.add(proxy.group)
    })

    this.camera.position.set(0, 3.4, 11)
    this.camera.lookAt(0, 0, -4)
    this.updateVisuals(0, 0, false)
  }

  update(dt: number, actions: Readonly<ShipActions>): void {
    const frame = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0
    this.elapsed += frame

    if (this.held) {
      this.controller.stop()
      this.accumulator = 0
    } else {
      this.accumulator += frame
      while (this.accumulator >= FIXED_STEP) {
        this.controller.update(FIXED_STEP, actions)
        this.accumulator -= FIXED_STEP
      }
    }

    this.updateVisuals(frame, this.held ? 0 : actions.thrust, !this.held && actions.boost)
  }

  getShipPosition(): SpacePosition {
    return {
      sector: [...this.controller.position.sector],
      local: [...this.controller.position.local],
    }
  }

  /** World-space direction of the ship's nose, useful for the flight HUD. */
  getShipForward(): [number, number, number] {
    this.forward.set(0, 0, -1).applyQuaternion(this.controller.orientation)
    return [this.forward.x, this.forward.y, this.forward.z]
  }

  distanceTo(definition: PlanetDefinition): number {
    return distanceBetweenSpacePositions(this.controller.position, definition.position)
  }

  hold(value: boolean): void {
    this.held = value
    if (value) this.controller.stop()
  }

  /** Set the ship just outside approach range, looking at the planet. */
  placeOutside(definition: PlanetDefinition): void {
    const outward = differenceSpacePosition(definition.position, this.controller.position)
    const direction = new THREE.Vector3(...outward)
    if (direction.lengthSq() < 1) direction.set(0, 0, 1)
    direction.normalize().multiplyScalar(definition.radius + 105)
    this.controller.place(offsetSpacePosition(definition.position, [direction.x, direction.y, direction.z]))
    this.controller.orientation.setFromUnitVectors(
      new THREE.Vector3(0, 0, -1),
      direction.clone().negate().normalize(),
    )
    this.accumulator = 0
    this.updateVisuals(0, 0, false)
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line) {
        geometries.add(object.geometry)
        const list = Array.isArray(object.material) ? object.material : [object.material]
        list.forEach(material => materials.add(material))
      }
    })
    geometries.forEach(geometry => geometry.dispose())
    materials.forEach(material => material.dispose())
    this.scene.clear()
  }

  private updateVisuals(dt: number, thrust: number, boost: boolean): void {
    this.ship.quaternion.copy(this.controller.orientation)
    const power = Math.max(0, thrust)
    const pulse = 0.92 + Math.sin(this.elapsed * (boost ? 18 : 10)) * 0.08
    const length = (0.6 + power * 0.65 + (boost ? 0.75 : 0)) * pulse
    this.thrusterGlows.forEach(glow => glow.scale.set(1, 1, length))
    this.engineMaterial.color.setHex(boost ? 0xffffff : 0x6cecff)

    // The camera follows the craft's attitude with a small delay. A perfectly
    // matched camera makes yaw, pitch and especially roll appear motionless.
    const attitudeCatchUp = dt <= 0 ? 1 : 1 - Math.exp(-3.2 * dt)
    this.cameraAttitude.slerp(this.controller.orientation, attitudeCatchUp)
    const desired = this.desiredCamera.set(0, 3.4, 11).applyQuaternion(this.cameraAttitude)
    const catchUp = dt <= 0 ? 1 : 1 - Math.exp(-4.5 * dt)
    this.camera.position.lerp(desired, catchUp)
    this.cameraTarget.set(0, 0, -4).applyQuaternion(this.cameraAttitude)
    this.cameraUp.set(0, 1, 0).applyQuaternion(this.cameraAttitude)
    this.camera.up.copy(this.cameraUp)
    this.camera.lookAt(this.cameraTarget)

    this.starDome.position.copy(this.camera.position)
    this.updateNearbyStars()
    this.updatePlanets(dt)
  }

  private updatePlanets(dt: number): void {
    for (const proxy of this.planets) {
      const displacement = differenceSpacePosition(this.controller.position, proxy.definition.position)
      const distance = Math.hypot(...displacement)
      const marker = smoothStep(PLANET_FULL_DISTANCE, PLANET_MARKER_DISTANCE, distance)
      const drawDistance = THREE.MathUtils.lerp(distance, 1350, marker)
      const scale = THREE.MathUtils.lerp(1, 3.5 / proxy.radius, marker)

      this.planetVector.set(...displacement)
      if (distance > 0.001) this.planetVector.multiplyScalar(drawDistance / distance)
      proxy.group.position.copy(this.planetVector)
      proxy.group.scale.setScalar(scale)
      proxy.group.rotation.y += dt * 0.08
      proxy.group.visible = Number.isFinite(distance)

      const bodyMaterial = proxy.body.material as THREE.MeshStandardMaterial
      bodyMaterial.emissiveIntensity = 0.12 + (1 - marker) * 0.04
    }
  }

  private updateNearbyStars(): void {
    const position = this.controller.position
    const cell: [number, number, number] = [0, 1, 2].map(axis =>
      position.sector[axis] * 8 + Math.floor(position.local[axis] / STAR_CELL_SIZE),
    ) as [number, number, number]

    if (cell.some((value, axis) => value !== this.currentStarCell[axis])) {
      this.currentStarCell.splice(0, 3, ...cell)
      this.nearbyStars.geometry.dispose()
      this.nearbyStars.geometry = buildNearbyStarGeometry(cell)
    }

    this.nearbyStars.position.set(
      -positiveMod(position.local[0], STAR_CELL_SIZE),
      -positiveMod(position.local[1], STAR_CELL_SIZE),
      -positiveMod(position.local[2], STAR_CELL_SIZE),
    )
  }

  private createShip(): THREE.Group {
    const ship = new THREE.Group()
    const accent = new THREE.MeshStandardMaterial({
      color: 0x43c9ef,
      metalness: 0.5,
      roughness: 0.28,
      emissive: 0x0a6787,
      emissiveIntensity: 0.3,
    })
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x172b43, metalness: 0.68, roughness: 0.33 })

    const fuselage = new THREE.Mesh(new THREE.ConeGeometry(0.72, 4.7, 6), this.shipHull)
    fuselage.geometry.rotateX(-Math.PI / 2)
    ship.add(fuselage)

    const centralCore = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.67, 2.3, 8), this.shipHull)
    centralCore.rotation.x = Math.PI / 2
    centralCore.position.z = 1.0
    ship.add(centralCore)

    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.78, 18, 12), this.canopy)
    canopy.scale.set(0.72, 0.42, 1.28)
    canopy.position.set(0, 0.4, -0.55)
    ship.add(canopy)

    ship.add(createWing(-1, this.shipHull, accent), createWing(1, this.shipHull, accent))

    for (const side of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.15, 10), darkMetal)
      pod.rotation.x = Math.PI / 2
      pod.position.set(side * 0.55, -0.12, 1.92)
      ship.add(pod)

      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), this.engineMaterial)
      glow.position.set(side * 0.55, -0.12, 2.55)
      glow.scale.set(1, 1, 0.8)
      ship.add(glow)
      this.thrusterGlows.push(glow)
    }

    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.92, 3), accent)
    fin.position.set(0, 0.48, 1.5)
    fin.rotation.z = Math.PI / 2
    ship.add(fin)
    return ship
  }
}

function createWing(side: number, hull: THREE.Material, accent: THREE.Material): THREE.Group {
  const group = new THREE.Group()
  const vertices = new Float32Array([
    side * 0.47, 0, -1.05,
    side * 3.0, -0.06, 1.35,
    side * 0.48, 0, 1.65,
    side * 0.47, 0, -1.05,
    side * 0.48, 0, 1.65,
    side * 3.0, -0.06, 1.35,
  ])
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  const wingMaterial = hull.clone()
  wingMaterial.side = THREE.DoubleSide
  group.add(new THREE.Mesh(geometry, wingMaterial))

  const trim = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.045, 0.08), accent)
  trim.rotation.y = side * 0.5
  trim.position.set(side * 1.75, 0.04, 1.22)
  group.add(trim)
  return group
}

function createStarDome(): THREE.Points {
  const positions = new Float32Array(1800 * 3)
  let seed = 0x9aef12bd
  for (let i = 0; i < positions.length; i += 3) {
    seed = xorshift(seed)
    const z = (seed / 0xffffffff) * 2 - 1
    seed = xorshift(seed)
    const angle = (seed / 0xffffffff) * Math.PI * 2
    const radius = Math.sqrt(1 - z * z) * 2200
    positions[i] = Math.cos(angle) * radius
    positions[i + 1] = z * 2200
    positions[i + 2] = Math.sin(angle) * radius
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0xc8e3ff, size: 2.1, sizeAttenuation: false, transparent: true, opacity: 0.88, depthWrite: false }),
  )
}

function buildNearbyStarGeometry(center: readonly number[]): THREE.BufferGeometry {
  const positions = new Float32Array(27 * STARS_PER_CELL * 3)
  let index = 0
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        let seed = hashCell(center[0] + x, center[1] + y, center[2] + z)
        for (let star = 0; star < STARS_PER_CELL; star++) {
          seed = xorshift(seed)
          positions[index++] = (x + seed / 0xffffffff) * STAR_CELL_SIZE
          seed = xorshift(seed)
          positions[index++] = (y + seed / 0xffffffff) * STAR_CELL_SIZE
          seed = xorshift(seed)
          positions[index++] = (z + seed / 0xffffffff) * STAR_CELL_SIZE
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return geometry
}

function createPlanetProxy(definition: PlanetDefinition, index: number): PlanetProxy {
  const group = new THREE.Group()
  const radius = Math.max(12, Math.min(55, definition.radius))
  const isVoxel = definition.slug === 'voxel'
  const isBlackHole = definition.slug === 'event-horizon'
  const isBitboard = definition.slug === 'bitboard'
  const geometry = isVoxel
    ? new THREE.IcosahedronGeometry(radius, 1)
    : new THREE.SphereGeometry(radius, isBitboard ? 12 : 24, isBitboard ? 8 : 16)
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: isBlackHole ? 0x090b18 : definition.color,
    emissive: definition.color,
    emissiveIntensity: 0.15,
    roughness: isBlackHole ? 1 : 0.65,
    metalness: definition.slug === 'material-forge' ? 0.67 : 0.12,
    flatShading: isVoxel || isBitboard,
  })
  const body = new THREE.Mesh(geometry, bodyMaterial)
  group.add(body)

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.12, 20, 12),
    new THREE.MeshBasicMaterial({ color: definition.color, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.BackSide }),
  )
  group.add(atmosphere)

  if (isVoxel) {
    for (let i = 0; i < 7; i++) {
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(radius * 0.21, radius * 0.21, radius * 0.21),
        new THREE.MeshStandardMaterial({ color: definition.color, emissive: definition.color, emissiveIntensity: 0.2, flatShading: true }),
      )
      const angle = (i / 7) * Math.PI * 2
      cube.position.set(Math.cos(angle) * radius * 1.18, Math.sin(i * 2.2) * radius * 0.36, Math.sin(angle) * radius * 1.18)
      cube.rotation.set(i * 0.3, i * 0.7, i * 0.2)
      group.add(cube)
    }
  }

  if (isBlackHole || index % 3 === 1 || definition.slug === 'material-forge') {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 1.55, isBlackHole ? radius * 0.14 : radius * 0.035, 8, 72),
      new THREE.MeshBasicMaterial({ color: isBlackHole ? 0xffb052 : definition.color, transparent: true, opacity: 0.73, depthWrite: false }),
    )
    ring.rotation.set(1.17, 0.14, 0.2)
    group.add(ring)
  }

  if (isBitboard) {
    const grid = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(radius * 1.04, 1)),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }),
    )
    group.add(grid)
  }

  return { definition, group, radius, body, atmosphere }
}

function hashCell(x: number, y: number, z: number): number {
  let hash = 2166136261
  hash = Math.imul(hash ^ x, 16777619)
  hash = Math.imul(hash ^ y, 16777619)
  hash = Math.imul(hash ^ z, 16777619)
  return hash || 1
}

function xorshift(value: number): number {
  let x = value || 1
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  return x >>> 0
}

function smoothStep(start: number, end: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)))
  return t * t * (3 - 2 * t)
}

function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus
}
