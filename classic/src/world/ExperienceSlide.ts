import * as THREE from 'three'
import type { Experience } from '../data/experience.ts'
import { createGlowSprite, createGlowTexture } from './Glow.ts'
import { createTextTexture, cssColor } from './TextPanel.ts'
import type { Collider } from './World.ts'

/** Side-to-side distance between a zig and its zag, in metres. */
const RUN_WIDTH = 8
/** How far each experience's run carries the slide forward (+z, toward the start). */
const RUN_DEPTH = 3
/** Height lost over each experience's run. */
const RUN_DROP = 1.3
/** Height of the last turn before the run-out to the floor. */
const LAST_TURN_HEIGHT = 1.2
/** How much of each corner is rounded off, in metres from the corner. */
const CORNER_ROUNDING = 1.6
/** The trough's lowest line at the exit: on the floor, just clear of it so the two never flicker. */
const FLOOR_CLEARANCE = 0.02

const TROUGH_RADIUS = 0.55
/** How far past a half-pipe the walls carry on up, in radians. */
const TROUGH_LIP = 0.5
const TROUGH_SIDES = 16
const TROUGH_STEP = 0.25
/** Where the trough is lower than this (bottom line, metres), the player cannot walk under it. */
const HEADROOM = 1.8
const TROUGH_COLLIDER_STEP = 0.5

const PLATFORM_SIZE = 2.4
const RUNG_SPACING = 0.35
const POST_RADIUS = 0.12

const BOARD_WIDTH = 3.4
const BOARD_HEIGHT = 1.7
/** Boards hang this far behind (-z) and above their stop. */
const BOARD_BEHIND = 1
const BOARD_ABOVE = 2.2
/** The frame a board hangs from stands this far either side of the slide's centre - clear of every run. */
const FRAME_HALF_WIDTH = 5.2

const SLIDE_COLOR = 0xffb020
const FRAME_COLOR = 0x3a4255

/** One accent per board, cycling. */
const ACCENTS = [0x4f8cff, 0x3ddc97, 0xffb020, 0xff6b9a, 0xa78bfa, 0x38d0e8]

/** The colour of stop `index`'s board - for anything else about that experience, like its popup. */
export function experienceAccent(index: number): number {
  return ACCENTS[index % ACCENTS.length]
}

const UP = new THREE.Vector3(0, 1, 0)

/**
 * A playground slide that zig-zags down to the floor toward the start - one run per experience, newest at
 * the top. Each run has a stop halfway along, in front of that experience's board. The ride itself lives
 * in SlideSystem; this is the structure, its path and its colliders.
 */
export class ExperienceSlide {
  readonly object = new THREE.Group()

  /** The trough's bottom line, from the launch at the top to the exit on the floor. */
  readonly path = new THREE.CurvePath<THREE.Vector3>()
  readonly length: number

  /** Distance along the path of each experience's stop, in order. */
  readonly stops: readonly number[]

  /** On the floor just past the exit, clear of the trough's colliders: where the ride hands control back. */
  readonly dismountPoint: THREE.Vector3

  /** Where the player stands to climb. */
  readonly ladderFoot: THREE.Vector3
  /** Foot of the ladder, top of the ladder, then the launch point: the way up. */
  readonly climbRoute: readonly THREE.Vector3[]

  /** The big arrow and floor ring marking the ladder. Hide it while the slide is in use. */
  readonly ladderMarker = new THREE.Group()
  /** The arrow on its own - public so the AnimationSystem can bob it. */
  readonly ladderArrow = new THREE.Group()
  /** The arrow's glow - public so the AnimationSystem can pulse it. */
  readonly ladderHalo: THREE.Sprite

  /** Footprints of everything the player could walk into: the tower, the posts, the low end of the trough. */
  readonly colliders: Collider[] = []

  private readonly center: { x: number; z: number }
  /** The tower's deck, as its footprint and the height of its top. */
  private readonly deck: { minX: number; maxX: number; minZ: number; maxZ: number; top: number }
  private readonly disposables: { dispose(): void }[] = []

  /** `bottom` is where the last turn sits on the ground plane: the slide rises away from it along -z. */
  constructor(entries: readonly Experience[], bottom: { x: number; z: number }) {
    this.center = bottom
    const runs = Math.max(entries.length, 1)
    const top = LAST_TURN_HEIGHT + runs * RUN_DROP

    // Turn i opens run i. Turn `runs` is the last one, before the run-out.
    const turns: THREE.Vector3[] = []
    for (let i = 0; i <= runs; i++) {
      turns.push(new THREE.Vector3(
        bottom.x + (i % 2 === 0 ? -RUN_WIDTH / 2 : RUN_WIDTH / 2),
        top - i * RUN_DROP,
        bottom.z - (runs - i) * RUN_DEPTH,
      ))
    }

    const first = turns[0]
    const last = turns[runs]
    const launch = new THREE.Vector3(first.x - 0.9, top, first.z)
    const runOutEnd = new THREE.Vector3(last.x, FLOOR_CLEARANCE, last.z + 2.6)
    const exit = runOutEnd.clone().add(new THREE.Vector3(0, 0, 1.5))

    // launch, turn 0 ... turn N, run-out, exit. Route index r + 1 is turn r.
    const corners = this.buildPath([launch, ...turns, runOutEnd, exit])
    this.length = this.path.getLength()

    // The exit's collider reaches TROUGH_RADIUS + 0.1 past the end; a body up to 0.6 m across stands clear of it.
    this.dismountPoint = new THREE.Vector3(exit.x, 0, exit.z + TROUGH_RADIUS + 0.1 + 0.6)

    // Halfway along each run's straight: between the end of turn r and the start of turn r + 1.
    this.stops = Array.from({ length: entries.length }, (_, run) => (corners[run].end + corners[run + 1].start) / 2)

    // The deck sits back from the launch (-z), but reaches far enough forward that the first board's frame
    // post lands on it rather than clipping its edge (buildBoard then moves it to the back).
    const platformCenter = new THREE.Vector3(first.x - PLATFORM_SIZE / 2 - 0.1, top, first.z - 0.7)
    this.deck = {
      minX: platformCenter.x - PLATFORM_SIZE / 2,
      maxX: platformCenter.x + PLATFORM_SIZE / 2,
      minZ: platformCenter.z - PLATFORM_SIZE / 2,
      maxZ: platformCenter.z + PLATFORM_SIZE / 2,
      top,
    }
    this.ladderFoot = new THREE.Vector3(this.deck.minX - 0.6, 0, platformCenter.z)
    this.climbRoute = [
      this.ladderFoot,
      new THREE.Vector3(this.ladderFoot.x, top, platformCenter.z),
      launch,
    ]

    const frameMaterial = new THREE.MeshStandardMaterial({ color: FRAME_COLOR, metalness: 0.5, roughness: 0.5 })
    const postGeometry = new THREE.CylinderGeometry(POST_RADIUS * 0.85, POST_RADIUS, 1, 10)
    this.disposables.push(frameMaterial, postGeometry)

    this.buildTrough()
    this.buildTroughColliders()

    // A post under every turn and under every stop, up to the trough.
    const supports = [...corners.slice(1).map((corner) => (corner.start + corner.end) / 2), ...this.stops]
    for (const distance of supports) this.addSupport(distance, postGeometry, frameMaterial)

    this.buildTower(platformCenter, top, frameMaterial)
    entries.forEach((entry, index) => this.buildBoard(entry, index, entries.length, this.pointAt(this.stops[index]), postGeometry, frameMaterial))
    this.buildTitle(platformCenter, top)
    this.ladderHalo = this.buildLadderMarker()
  }

  /** The point on the trough's bottom line this far along it. */
  pointAt(distance: number, target = new THREE.Vector3()): THREE.Vector3 {
    return this.path.getPoint(THREE.MathUtils.clamp(distance / this.length, 0, 1), target)
  }

  tangentAt(distance: number, target = new THREE.Vector3()): THREE.Vector3 {
    return this.path.getTangent(THREE.MathUtils.clamp(distance / this.length, 0, 1), target)
  }

  dispose(): void {
    this.object.removeFromParent()
    for (const disposable of this.disposables) disposable.dispose()
    this.disposables.length = 0
    this.colliders.length = 0
  }

  /**
   * Straight lines between the route points, with every inner corner rounded off by a curve. Returns, for
   * each inner corner in order, the distances where its curve starts and ends, and the curve's middle.
   */
  private buildPath(route: readonly THREE.Vector3[]): { start: number; end: number; middle: THREE.Vector3 }[] {
    const corners: { start: number; end: number; middle: THREE.Vector3 }[] = []
    let cursor = route[0]
    let distance = 0

    const addLine = (to: THREE.Vector3) => {
      const line = new THREE.LineCurve3(cursor.clone(), to.clone())
      this.path.add(line)
      distance += line.getLength()
      cursor = to
    }

    for (let i = 1; i < route.length - 1; i++) {
      const corner = route[i]
      const toCorner = corner.clone().sub(route[i - 1])
      const fromCorner = route[i + 1].clone().sub(corner)
      const rounding = Math.min(CORNER_ROUNDING, toCorner.length() * 0.45, fromCorner.length() * 0.45)

      const start = corner.clone().addScaledVector(toCorner.normalize(), -rounding)
      const end = corner.clone().addScaledVector(fromCorner.normalize(), rounding)

      addLine(start)
      const startDistance = distance

      const curve = new THREE.QuadraticBezierCurve3(start, corner.clone(), end)
      this.path.add(curve)
      distance += curve.getLength()
      corners.push({ start: startDistance, end: distance, middle: curve.getPoint(0.5) })
      cursor = end
    }

    addLine(route[route.length - 1])
    return corners
  }

  /** A half-pipe swept along the path. */
  private buildTrough(): void {
    const steps = Math.ceil(this.length / TROUGH_STEP)
    const columns = TROUGH_SIDES + 1
    const positions = new Float32Array((steps + 1) * columns * 3)
    const indices: number[] = []

    const point = new THREE.Vector3()
    const tangent = new THREE.Vector3()
    const side = new THREE.Vector3()
    const up = new THREE.Vector3()
    const center = new THREE.Vector3()
    const vertex = new THREE.Vector3()

    for (let step = 0; step <= steps; step++) {
      const t = step / steps
      this.path.getPoint(t, point)
      this.path.getTangent(t, tangent)
      side.crossVectors(tangent, UP).normalize()
      up.crossVectors(side, tangent).normalize()

      // The path is the trough's lowest line, so the half-pipe's centre sits one radius above it.
      center.copy(point).addScaledVector(up, TROUGH_RADIUS)

      for (let s = 0; s < columns; s++) {
        const angle = -TROUGH_LIP + (s / TROUGH_SIDES) * (Math.PI + TROUGH_LIP * 2)
        vertex.copy(center)
          .addScaledVector(side, Math.cos(angle) * TROUGH_RADIUS)
          .addScaledVector(up, -Math.sin(angle) * TROUGH_RADIUS)
        vertex.toArray(positions, (step * columns + s) * 3)

        if (step < steps && s < TROUGH_SIDES) {
          const a = step * columns + s
          const b = a + columns
          indices.push(a, b, a + 1, a + 1, b, b + 1)
        }
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()

    const material = new THREE.MeshStandardMaterial({ color: SLIDE_COLOR, roughness: 0.4, side: THREE.DoubleSide })
    const trough = new THREE.Mesh(geometry, material)
    trough.castShadow = true
    trough.receiveShadow = true

    this.object.add(trough)
    this.disposables.push(geometry, material)
  }

  /** Circles along wherever the trough is too low to walk under. */
  private buildTroughColliders(): void {
    const point = new THREE.Vector3()
    for (let distance = 0; distance <= this.length; distance += TROUGH_COLLIDER_STEP) {
      this.pointAt(distance, point)
      if (point.y < HEADROOM) this.colliders.push({ kind: 'circle', x: point.x, z: point.z, radius: TROUGH_RADIUS + 0.1 })
    }
  }

  /**
   * A post up to the trough this far along it. It stops short of the lowest point of the trough around it,
   * so on a steep stretch its top never pokes up through the bottom.
   */
  private addSupport(distance: number, geometry: THREE.BufferGeometry, material: THREE.Material): void {
    const point = this.pointAt(distance)
    let lowest = point.y
    const sample = new THREE.Vector3()
    for (let offset = -0.6; offset <= 0.6; offset += 0.1) lowest = Math.min(lowest, this.pointAt(distance + offset, sample).y)

    this.addPost(point.x, point.z, lowest - 0.05, geometry, material)
  }

  /**
   * A post from whatever it stands on - the tower's deck if it is over it, else the floor - up to `topY`.
   * Posts shorter than 10 cm are left out.
   */
  private addPost(x: number, z: number, topY: number, geometry: THREE.BufferGeometry, material: THREE.Material): void {
    const onDeck = x >= this.deck.minX && x <= this.deck.maxX && z >= this.deck.minZ && z <= this.deck.maxZ
    const baseY = onDeck ? this.deck.top : 0
    const height = topY - baseY
    if (height <= 0.1) return

    const post = new THREE.Mesh(geometry, material)
    post.scale.y = height
    post.position.set(x, baseY + height / 2, z)
    post.castShadow = true
    this.object.add(post)

    // Up on the deck is out of reach of anyone walking.
    if (!onDeck) this.colliders.push({ kind: 'circle', x, z, radius: POST_RADIUS })
  }

  /** The platform at the top, its legs, and the ladder up its far side. */
  private buildTower(center: THREE.Vector3, top: number, material: THREE.Material): void {
    const half = PLATFORM_SIZE / 2

    const deckGeometry = new THREE.BoxGeometry(PLATFORM_SIZE, 0.2, PLATFORM_SIZE)
    const deck = new THREE.Mesh(deckGeometry, material)
    deck.position.set(center.x, top - 0.1, center.z)
    deck.castShadow = true
    deck.receiveShadow = true
    this.object.add(deck)

    const legGeometry = new THREE.BoxGeometry(0.16, top, 0.16)
    for (const dx of [-1, 1]) {
      for (const dz of [-1, 1]) {
        const leg = new THREE.Mesh(legGeometry, material)
        leg.position.set(center.x + dx * (half - 0.1), top / 2, center.z + dz * (half - 0.1))
        leg.castShadow = true
        this.object.add(leg)
      }
    }

    const railGeometry = new THREE.BoxGeometry(0.07, top + 0.9, 0.07)
    const ladderX = center.x - half - 0.08
    for (const dz of [-0.35, 0.35]) {
      const rail = new THREE.Mesh(railGeometry, material)
      rail.position.set(ladderX, (top + 0.9) / 2, center.z + dz)
      rail.castShadow = true
      this.object.add(rail)
    }

    const rungGeometry = new THREE.CylinderGeometry(0.035, 0.035, 0.7, 8)
    rungGeometry.rotateX(Math.PI / 2)
    const rungCount = Math.floor(top / RUNG_SPACING)
    const rungs = new THREE.InstancedMesh(rungGeometry, material, rungCount)
    const matrix = new THREE.Matrix4()
    for (let i = 0; i < rungCount; i++) {
      matrix.makeTranslation(ladderX, (i + 1) * RUNG_SPACING, center.z)
      rungs.setMatrixAt(i, matrix)
    }
    rungs.castShadow = true
    this.object.add(rungs)

    // Solid from the ladder rails to the far legs; the ladder's foot stays reachable just outside.
    this.colliders.push({ kind: 'box', minX: ladderX - 0.05, maxX: center.x + half, minZ: center.z - half, maxZ: center.z + half })
    this.disposables.push(deckGeometry, legGeometry, railGeometry, rungGeometry, rungs)
  }

  /**
   * Experience `index`'s board, hanging behind its stop from a frame that stands on the floor either side
   * of the slide, facing the camera.
   */
  private buildBoard(
    entry: Experience, index: number, total: number, stop: THREE.Vector3,
    postGeometry: THREE.BufferGeometry, material: THREE.Material,
  ): void {
    const accent = experienceAccent(index)
    const texture = createTextTexture(
      [
        { text: `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, size: 34, weight: 600, color: cssColor(accent) },
        { text: entry.role, size: 64, weight: 700 },
        { text: entry.company, size: 50, weight: 500 },
        { text: entry.period, size: 38, color: '#8a93a8' },
      ],
      { width: 1024, height: 512, accent: cssColor(accent) },
    )

    const geometry = new THREE.PlaneGeometry(BOARD_WIDTH, BOARD_HEIGHT)
    const boardMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true })
    const board = new THREE.Mesh(geometry, boardMaterial)
    const z = stop.z - BOARD_BEHIND
    board.position.set(stop.x, stop.y + BOARD_ABOVE, z)
    this.object.add(board)

    // A frame post that would land on the tower's deck moves to the deck's back edge, out of the way of
    // the player crossing to the launch.
    const frameX = [-1, 1].map((side) => {
      const x = this.center.x + side * FRAME_HALF_WIDTH
      const overDeck = x >= this.deck.minX && x <= this.deck.maxX && z >= this.deck.minZ && z <= this.deck.maxZ
      return overDeck ? this.deck.minX + 0.25 : x
    })

    const beamY = board.position.y + BOARD_HEIGHT / 2 + 0.3
    const beamGeometry = new THREE.BoxGeometry(frameX[1] - frameX[0], 0.14, 0.14)
    const beam = new THREE.Mesh(beamGeometry, material)
    beam.position.set((frameX[0] + frameX[1]) / 2, beamY, z)
    beam.castShadow = true
    this.object.add(beam)

    const hangerGeometry = new THREE.BoxGeometry(0.05, 0.3, 0.05)
    for (const dx of [-BOARD_WIDTH / 2 + 0.3, BOARD_WIDTH / 2 - 0.3]) {
      const hanger = new THREE.Mesh(hangerGeometry, material)
      hanger.position.set(stop.x + dx, beamY - 0.15, z)
      this.object.add(hanger)
    }

    for (const x of frameX) this.addPost(x, z, beamY + 0.07, postGeometry, material)

    this.disposables.push(texture, geometry, boardMaterial, beamGeometry, hangerGeometry)
  }

  /**
   * A big arrow pointing down at the foot of the ladder, over a ring on the floor where the player stands.
   * Unlit and unfogged, so it shows bright from the start of the avenue.
   */
  /** Returns the arrow's halo. */
  private buildLadderMarker(): THREE.Sprite {
    const material = new THREE.MeshBasicMaterial({ color: SLIDE_COLOR, fog: false })

    // Big enough to pick out from the start of the avenue, some fifty metres away.
    const headGeometry = new THREE.ConeGeometry(1.3, 2.2, 32)
    headGeometry.rotateX(Math.PI) // point down
    const head = new THREE.Mesh(headGeometry, material)

    const shaftGeometry = new THREE.CylinderGeometry(0.45, 0.45, 2.6, 24)
    const shaft = new THREE.Mesh(shaftGeometry, material)
    shaft.position.y = 1.1 + 1.3

    // Tip 2.4 m up: above the player's head, so it never hides them.
    this.ladderArrow.add(head, shaft)
    this.ladderArrow.position.y = 2.4 + 1.1

    const ringGeometry = new THREE.RingGeometry(0.9, 1.2, 48)
    ringGeometry.rotateX(-Math.PI / 2)
    const ringMaterial = new THREE.MeshBasicMaterial({ color: SLIDE_COLOR, fog: false, transparent: true, opacity: 0.8, depthWrite: false })
    const ring = new THREE.Mesh(ringGeometry, ringMaterial)
    ring.position.y = 0.03

    // A metre out from the ladder, so the arrow's head stays clear of the rails; standing in the ring is
    // still well within reach of the ladder's prompt.
    this.ladderMarker.position.set(this.ladderFoot.x - 1, 0, this.ladderFoot.z)
    // A halo round the arrow and a glow on the floor under the ring - the halo's is the one to pulse.
    const glowTexture = createGlowTexture()
    const halo = createGlowSprite(glowTexture, SLIDE_COLOR, 0.7, false)
    halo.scale.setScalar(7)
    halo.position.y = 1.3
    const floorGlow = createGlowSprite(glowTexture, SLIDE_COLOR, 0.5, false)
    floorGlow.scale.setScalar(4.5)
    floorGlow.position.y = 0.2

    const labelTexture = createTextTexture([{ text: 'CLIMB HERE', size: 104, weight: 800 }], {
      width: 800,
      height: 200,
      accent: cssColor(SLIDE_COLOR),
      align: 'center',
    })
    const labelMaterial = new THREE.SpriteMaterial({ map: labelTexture, depthWrite: false, fog: false })
    const label = new THREE.Sprite(labelMaterial)
    label.scale.set(3.6, 0.9, 1)
    label.position.y = 3.7 + 0.9

    this.ladderArrow.add(halo, label)
    this.ladderMarker.add(this.ladderArrow, ring, floorGlow)
    this.object.add(this.ladderMarker)
    this.disposables.push(
      material, headGeometry, shaftGeometry, ringGeometry, ringMaterial,
      glowTexture, halo.material, floorGlow.material, labelTexture, labelMaterial,
    )
    return halo
  }

  private buildTitle(platformCenter: THREE.Vector3, top: number): void {
    const texture = createTextTexture(
      [
        { text: 'EXPERIENCE', size: 84, weight: 800 },
        { text: 'Climb up and slide down', size: 40, color: '#8a93a8' },
      ],
      { width: 1024, height: 320, accent: cssColor(SLIDE_COLOR), align: 'center' },
    )

    const geometry = new THREE.PlaneGeometry(3.6, 1.125)
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true })
    const title = new THREE.Mesh(geometry, material)
    title.position.set(platformCenter.x, top + 2.4, platformCenter.z - PLATFORM_SIZE / 2 - 0.2)

    this.object.add(title)
    this.disposables.push(texture, geometry, material)
  }
}
