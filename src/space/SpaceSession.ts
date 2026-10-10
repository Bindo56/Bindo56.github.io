import * as THREE from 'three'
import type { PlanetDefinition } from '../app/PlanetContracts.ts'
import { ShipController, type ShipActions } from './ShipController.ts'
import { createSpaceToonMaterial } from './SpaceToonShader.ts'
import { OrbitSystem } from './OrbitSystem.ts'
import { createPlanetMotif, type PlanetMotif } from './PlanetMotifs.ts'
import { BlackHoleVisual } from '../worlds/solar-dots/BlackHoleVisual.ts'
import {
  differenceSpacePosition,
  distanceBetweenSpacePositions,
  offsetSpacePosition,
  type SpacePosition,
} from './SpacePosition.ts'

const FIXED_STEP = 1 / 60
const STAR_CELL_SIZE = 512
const STARS_PER_CELL = 15
const PLANET_FULL_DISTANCE = 900
const PLANET_MARKER_DISTANCE = 1700
const NEAR_DETAIL_DISTANCE = 420
const MID_DETAIL_DISTANCE = 1050
const ORBIT_TRACK_RANGE = 680

interface PlanetProxy {
  definition: PlanetDefinition
  motif: PlanetMotif
  radius: number
}

interface OrbitTrack {
  definition: PlanetDefinition
  line: THREE.LineLoop
}

/** Space rendering and flight, with no renderer, DOM, or input listener of its own. */
export class SpaceSession {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(68, 1, 0.1, 2800)

  private readonly controller = new ShipController()
  private readonly orbits: OrbitSystem
  private readonly ship: THREE.Group
  private readonly thrusterGlows: THREE.Mesh[] = []
  private readonly planets: PlanetProxy[] = []
  private readonly orbitTracks: OrbitTrack[] = []
  private readonly blackHole: BlackHoleVisual
  private readonly starDome: THREE.Points
  private readonly nearbyStars: THREE.Points
  private readonly outlineMaterial = new THREE.MeshBasicMaterial({
    color: 0x020715,
    side: THREE.BackSide,
    toneMapped: false,
  })
  private readonly shipHull = createSpaceToonMaterial({
    base: 0xc9e0ef,
    shadow: 0x294961,
    highlight: 0xf5fdff,
    outline: 0x020715,
  })
  private readonly canopy = createSpaceToonMaterial({
    base: 0x287ba5,
    shadow: 0x0b3557,
    highlight: 0xb3f3ff,
    outline: 0x020715,
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
  private reducedMotion = false
  private selectedPlanet: PlanetDefinition | null = null
  private coMovingPlanet: PlanetDefinition | null = null

  constructor(definitions: readonly PlanetDefinition[]) {
    this.scene.background = new THREE.Color(0x020917)
    this.orbits = new OrbitSystem(definitions)

    this.ship = this.createShip()
    this.scene.add(this.ship)

    this.starDome = createStarDome()
    this.nearbyStars = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color: 0xa2ceff, size: 2.4, sizeAttenuation: false }),
    )
    this.scene.add(this.starDome, this.nearbyStars)

    this.blackHole = new BlackHoleVisual({ faceCamera: false })
    // The glow ends within the first orbit (260 units), leaving a visible gap.
    this.blackHole.group.scale.setScalar(18)
    this.scene.add(this.blackHole.group)

    definitions.forEach(definition => {
      const motif = createPlanetMotif(definition)
      this.planets.push({ definition, motif, radius: definition.radius })
      this.scene.add(motif.group)
      const line = createOrbitTrack(this.orbits, definition)
      this.orbitTracks.push({ definition, line })
      this.scene.add(line)
    })

    this.camera.position.set(0, 3.4, 11)
    this.camera.lookAt(0, 0, -4)
    this.updateVisuals(0, 0, false)
  }

  update(dt: number, actions: Readonly<ShipActions>): void {
    const frame = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0
    this.elapsed += frame
    this.advanceOrbitClock(frame)

    const manualFlight = Math.abs(actions.thrust) + Math.abs(actions.strafe) + Math.abs(actions.lift) > 0.05
    if (manualFlight) this.coMovingPlanet = null
    else if (this.held || actions.brake) this.captureNearbyOrbit()

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

  /** Keep the system in motion while a world scene owns the renderer. */
  advanceOrbits(dt: number): void {
    const frame = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0
    this.elapsed += frame
    this.advanceOrbitClock(frame)
  }

  getShipPosition(): SpacePosition {
    return {
      sector: [...this.controller.position.sector],
      local: [...this.controller.position.local],
    }
  }

  getOrbitSystem(): OrbitSystem {
    return this.orbits
  }

  getPlanetPosition(definition: PlanetDefinition): SpacePosition {
    return this.orbits.getPosition(definition)
  }

  setSelectedPlanet(definition: PlanetDefinition | null): void {
    this.selectedPlanet = definition
    this.updateTrackVisibility()
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value
  }

  /** World-space direction of the ship's nose, useful for the flight HUD. */
  getShipForward(): [number, number, number] {
    this.forward.set(0, 0, -1).applyQuaternion(this.controller.orientation)
    return [this.forward.x, this.forward.y, this.forward.z]
  }

  distanceTo(definition: PlanetDefinition): number {
    return distanceBetweenSpacePositions(this.controller.position, this.orbits.getPosition(definition))
  }

  hold(value: boolean): void {
    const wasHeld = this.held
    this.held = value
    if (value) {
      this.controller.stop()
      this.captureNearbyOrbit()
    } else if (wasHeld) {
      this.coMovingPlanet = null
    }
  }

  /** Set the ship just outside approach range, looking at the planet. */
  placeOutside(definition: PlanetDefinition): void {
    const planetPosition = this.orbits.getPosition(definition)
    const outward = differenceSpacePosition(planetPosition, this.controller.position)
    const direction = new THREE.Vector3(...outward)
    if (direction.lengthSq() < 1) direction.set(0, 0, 1)
    direction.normalize().multiplyScalar(definition.radius + 105)
    this.controller.place(offsetSpacePosition(planetPosition, [direction.x, direction.y, direction.z]))
    this.controller.orientation.setFromUnitVectors(
      new THREE.Vector3(0, 0, -1),
      direction.clone().negate().normalize(),
    )
    this.coMovingPlanet = definition
    this.accumulator = 0
    this.updateVisuals(0, 0, false)
  }

  dispose(): void {
    this.planets.forEach(proxy => {
      this.scene.remove(proxy.motif.group)
      proxy.motif.dispose()
    })
    this.scene.remove(this.blackHole.group)
    this.blackHole.dispose()
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
    this.updateSystemCenter()
    this.updatePlanets()
    this.updateTrackVisibility()
  }

  private updateSystemCenter(): void {
    this.blackHole.group.position.set(...differenceSpacePosition(this.controller.position, this.orbits.getCenter()))
    this.blackHole.update(this.orbits.getElapsedSeconds(), this.camera)
    for (const track of this.orbitTracks) track.line.position.copy(this.blackHole.group.position)
  }

  private updatePlanets(): void {
    for (const proxy of this.planets) {
      const displacement = differenceSpacePosition(this.controller.position, this.orbits.getPosition(proxy.definition))
      const distance = Math.hypot(...displacement)
      const marker = smoothStep(PLANET_FULL_DISTANCE, PLANET_MARKER_DISTANCE, distance)
      const scale = THREE.MathUtils.lerp(1, 7.5 / proxy.radius, marker)
      const detail = distance < NEAR_DETAIL_DISTANCE ? 'near' : distance < MID_DETAIL_DISTANCE ? 'mid' : 'far'

      this.planetVector.set(...displacement)
      proxy.motif.group.position.copy(this.planetVector)
      proxy.motif.group.scale.setScalar(scale)
      proxy.motif.group.visible = Number.isFinite(distance) && distance < this.camera.far + proxy.radius
      proxy.motif.update(this.orbits.getElapsedSeconds(), this.reducedMotion, detail)
    }
  }

  private updateTrackVisibility(): void {
    for (const track of this.orbitTracks) {
      const selected = this.selectedPlanet?.slug === track.definition.slug
      const close = this.distanceTo(track.definition) < ORBIT_TRACK_RANGE
      track.line.visible = selected || close
      const material = track.line.material as THREE.LineBasicMaterial
      material.opacity = selected ? 0.55 : 0.13
    }
  }

  private captureNearbyOrbit(): void {
    let closest: PlanetDefinition | null = null
    let nearestDistance = Infinity
    for (const proxy of this.planets) {
      const distance = this.distanceTo(proxy.definition)
      if (distance < proxy.radius + 125 && distance < nearestDistance) {
        closest = proxy.definition
        nearestDistance = distance
      }
    }
    if (closest) this.coMovingPlanet = closest
  }

  private advanceOrbitClock(frame: number): void {
    const movingPlanet = this.coMovingPlanet
    const previousPlanetPosition = movingPlanet ? this.orbits.getPosition(movingPlanet) : null
    this.orbits.advance(frame, !this.reducedMotion)
    if (movingPlanet && previousPlanetPosition) {
      const orbitalStep = differenceSpacePosition(previousPlanetPosition, this.orbits.getPosition(movingPlanet))
      this.controller.position = offsetSpacePosition(this.controller.position, orbitalStep)
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
    const accent = createSpaceToonMaterial({
      base: 0x25b9dc,
      shadow: 0x0a5872,
      highlight: 0xb9f6ff,
      outline: 0x020715,
    })
    const darkMetal = createSpaceToonMaterial({
      base: 0x385773,
      shadow: 0x091a2e,
      highlight: 0x7e9fbd,
      outline: 0x020715,
    })

    const fuselage = new THREE.Mesh(new THREE.ConeGeometry(0.72, 4.7, 6), this.shipHull)
    fuselage.geometry.rotateX(-Math.PI / 2)
    addBackfaceOutline(fuselage, this.outlineMaterial, 0.065)
    ship.add(fuselage)

    const centralCore = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.67, 2.3, 8), this.shipHull)
    centralCore.rotation.x = Math.PI / 2
    centralCore.position.z = 1.0
    addBackfaceOutline(centralCore, this.outlineMaterial, 0.055)
    ship.add(centralCore)

    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.78, 18, 12), this.canopy)
    canopy.scale.set(0.72, 0.42, 1.28)
    canopy.position.set(0, 0.4, -0.55)
    addBackfaceOutline(canopy, this.outlineMaterial, 0.06)
    ship.add(canopy)

    ship.add(
      createWing(-1, this.shipHull, accent, this.outlineMaterial),
      createWing(1, this.shipHull, accent, this.outlineMaterial),
    )

    for (const side of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.15, 10), darkMetal)
      pod.rotation.x = Math.PI / 2
      pod.position.set(side * 0.55, -0.12, 1.92)
      addBackfaceOutline(pod, this.outlineMaterial, 0.075)
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
    addBackfaceOutline(fin, this.outlineMaterial, 0.08)
    ship.add(fin)
    return ship
  }
}

function addBackfaceOutline(mesh: THREE.Mesh, material: THREE.Material, width: number): void {
  const outline = new THREE.Mesh(mesh.geometry, material)
  outline.name = 'Ink outline'
  outline.scale.setScalar(1 + width)
  outline.renderOrder = -1
  mesh.add(outline)
}

function createWing(
  side: number,
  hull: THREE.ShaderMaterial,
  accent: THREE.ShaderMaterial,
  outlineMaterial: THREE.Material,
): THREE.Group {
  const group = new THREE.Group()
  const leadingRoot = new THREE.Vector3(side * 0.47, 0, -1.05)
  const tip = new THREE.Vector3(side * 3.0, -0.06, 1.35)
  const trailingRoot = new THREE.Vector3(side * 0.48, 0, 1.65)
  const vertices = new Float32Array([
    ...leadingRoot.toArray(),
    ...tip.toArray(),
    ...trailingRoot.toArray(),
  ])
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  const wingMaterial = hull.clone()
  wingMaterial.side = THREE.DoubleSide
  group.add(new THREE.Mesh(geometry, wingMaterial))

  // A line follows the flat wing silhouette where a backface shell cannot.
  const perimeter = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([leadingRoot, tip, trailingRoot]),
    new THREE.LineBasicMaterial({ color: 0x020715, toneMapped: false }),
  )
  perimeter.renderOrder = 1
  group.add(perimeter)

  const trim = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.045, 0.08), accent)
  trim.rotation.y = side * 0.5
  trim.position.set(side * 1.75, 0.04, 1.22)
  addBackfaceOutline(trim, outlineMaterial, 0.15)
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

function createOrbitTrack(orbits: OrbitSystem, definition: PlanetDefinition): THREE.LineLoop {
  const center = orbits.getCenter()
  const points: THREE.Vector3[] = []
  const segments = 128
  for (let i = 0; i < segments; i++) {
    points.push(new THREE.Vector3(...differenceSpacePosition(center, orbits.samplePosition(definition, i / segments))))
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points)
  const orbit = orbits.getOrbit(definition)
  const color = orbit.group === 'gameplay' ? 0xff9a79 : orbit.group === 'simulation' ? 0x73e5ce : 0xd5d68b
  const material = new THREE.LineDashedMaterial({
    color,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
    dashSize: orbit.linePattern === 'solid' ? 10000 : orbit.linePattern === 'dashed' ? 11 : 2,
    gapSize: orbit.linePattern === 'solid' ? 0 : orbit.linePattern === 'dashed' ? 11 : 13,
  })
  const line = new THREE.LineLoop(geometry, material)
  line.computeLineDistances()
  line.name = `${definition.title} orbit`
  return line
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
