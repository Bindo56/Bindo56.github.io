import * as THREE from 'three'
import { ENEMIES, WAVE_RULES, WEAPONS, type EnemyId } from '../data/waves.ts'
import type { ShotState, WaveEvent, WaveSystem } from '../systems/WaveSystem.ts'
import { createGlowSprite, createGlowTexture } from './Glow.ts'
import { createTextTexture, cssColor } from './TextPanel.ts'

const ARENA_COLOR = 0xff3b5c
/** How long an enemy swells after being hit, in seconds. */
const HIT_FLASH = 0.12
const BOMB_ARC_HEIGHT = 3

type ShotKind = ShotState['kind']

/**
 * The wave arena in the scene: its ring on the floor and its sign, and a model for every enemy and shot in the
 * WaveSystem, kept in step with it each frame. It only ever reads the simulation.
 */
export class WaveArena {
  readonly object = new THREE.Group()
  /** Where the sign stands, and the player starts the waves from. */
  readonly gate: { x: number; z: number }

  private readonly enemyModels = new Map<number, THREE.Object3D>()
  private readonly shotModels = new Map<number, THREE.Object3D>()
  private readonly enemyPool: Record<EnemyId, THREE.Object3D[]> = { crawler: [], drone: [], spitter: [], brute: [] }
  private readonly shotPool: Record<ShotKind, THREE.Object3D[]> = { pistol: [], bomb: [], rocket: [], spit: [] }
  private readonly hitAt = new Map<number, number>()
  private readonly disposables: { dispose(): void }[] = []
  private readonly materials: Record<EnemyId | ShotKind | 'shell' | 'eye', THREE.Material>
  private readonly geometries: Record<string, THREE.BufferGeometry>
  private time = 0

  constructor(center: { x: number; z: number }, gate: { x: number; z: number }) {
    this.gate = gate

    const standard = (color: number, emissive = 0.35) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: emissive, roughness: 0.45 })
    const glowing = (color: number) => new THREE.MeshBasicMaterial({ color })
    this.materials = {
      crawler: standard(ENEMIES.crawler.color),
      drone: standard(0x3a4255, 0),
      spitter: standard(ENEMIES.spitter.color),
      brute: standard(ENEMIES.brute.color, 0.2),
      shell: standard(0x1b2130, 0),
      eye: glowing(0xff3b3b),
      pistol: glowing(WEAPONS.pistol.color),
      bomb: glowing(WEAPONS.bomb.color),
      rocket: glowing(WEAPONS.rocket.color),
      spit: glowing(ENEMIES.spitter.color),
    }
    this.geometries = {
      crawler: new THREE.IcosahedronGeometry(ENEMIES.crawler.radius, 0),
      drone: new THREE.SphereGeometry(ENEMIES.drone.radius, 20, 14),
      droneRing: new THREE.TorusGeometry(ENEMIES.drone.radius + 0.12, 0.05, 8, 32),
      spitterBody: new THREE.CylinderGeometry(ENEMIES.spitter.radius * 0.7, ENEMIES.spitter.radius, 1.1, 16),
      spitterHead: new THREE.SphereGeometry(0.32, 16, 12),
      brute: new THREE.BoxGeometry(ENEMIES.brute.radius * 1.7, 1.7, ENEMIES.brute.radius * 1.7),
      eye: new THREE.BoxGeometry(0.9, 0.16, 0.08),
      pistol: new THREE.SphereGeometry(0.12, 8, 6),
      bomb: new THREE.SphereGeometry(0.28, 14, 10),
      rocket: new THREE.CylinderGeometry(0.1, 0.16, 0.8, 10).rotateX(Math.PI / 2),
      spit: new THREE.SphereGeometry(0.2, 10, 8),
    }
    this.disposables.push(...Object.values(this.materials), ...Object.values(this.geometries))

    this.buildRing(center)
    this.buildSign(gate)
  }

  /** Brings every model in line with the simulation. Enemies turn to face `player`. */
  sync(waves: WaveSystem, dt: number, player: { x: number; z: number }): void {
    this.time += dt
    this.syncModels(waves.enemies, this.enemyModels, (enemy) => this.takeEnemy(enemy.type), (model, enemy) => {
      const lift = enemy.type === 'drone' ? 1.4 + Math.sin(this.time * 5 + enemy.id) * 0.12 : 0
      model.position.set(enemy.x, lift, enemy.z)
      model.rotation.y = Math.atan2(player.x - enemy.x, player.z - enemy.z)

      const hit = this.hitAt.get(enemy.id)
      model.scale.setScalar(hit !== undefined && this.time - hit < HIT_FLASH ? 1.2 : 1)
    }, (model, enemy) => this.enemyPool[enemy.type].push(model))

    this.syncModels(waves.shots, this.shotModels, (shot) => this.takeShot(shot.kind), (model, shot) => {
      if (shot.kind === 'bomb') {
        // A lob: up and over, landing at the target.
        const t = Math.min(shot.age / shot.life, 1)
        model.position.set(shot.x, 0.3 + 4 * BOMB_ARC_HEIGHT * t * (1 - t), shot.z)
      } else {
        model.position.set(shot.x, shot.kind === 'spit' ? 1 : 1.1, shot.z)
        model.rotation.y = Math.atan2(shot.vx, shot.vz)
      }
    }, (model, shot) => this.shotPool[shot.kind].push(model))
  }

  /** The visual side of what happened: hit flashes. Bursts and sounds are the game's to show. */
  handle(events: readonly WaveEvent[]): void {
    for (const event of events) {
      if (event.kind === 'hit') this.hitAt.set(event.id, this.time)
      else if (event.kind === 'kill') this.hitAt.delete(event.id)
    }
  }

  dispose(): void {
    this.object.removeFromParent()
    for (const disposable of this.disposables) disposable.dispose()
    this.disposables.length = 0
  }

  private syncModels<T extends { id: number }>(
    items: readonly T[], models: Map<number, THREE.Object3D>,
    create: (item: T) => THREE.Object3D, place: (model: THREE.Object3D, item: T) => void,
    release: (model: THREE.Object3D, item: T) => void,
  ): void {
    const alive = new Set<number>()
    for (const item of items) {
      alive.add(item.id)
      let model = models.get(item.id)
      if (!model) {
        model = create(item)
        models.set(item.id, model)
      }
      // Kept for release: by then the item has left the simulation's list.
      ;(model.userData as { item?: T }).item = item
      place(model, item)
    }

    for (const [id, model] of models) {
      if (alive.has(id)) continue
      model.visible = false
      release(model, (model.userData as { item: T }).item)
      models.delete(id)
    }
  }

  private takeEnemy(type: EnemyId): THREE.Object3D {
    const pooled = this.enemyPool[type].pop()
    if (pooled) {
      pooled.visible = true
      return pooled
    }

    const model = new THREE.Group()
    const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, y = 0) => {
      const part = new THREE.Mesh(geometry, material)
      part.position.y = y
      part.castShadow = true
      model.add(part)
      return part
    }

    switch (type) {
      case 'crawler': {
        mesh(this.geometries.crawler, this.materials.crawler, ENEMIES.crawler.radius * 0.6).scale.y = 0.6
        break
      }
      case 'drone': {
        mesh(this.geometries.drone, this.materials.drone)
        const ring = mesh(this.geometries.droneRing, this.materials.eye)
        ring.rotation.x = Math.PI / 2
        break
      }
      case 'spitter': {
        mesh(this.geometries.spitterBody, this.materials.shell, 0.55)
        mesh(this.geometries.spitterHead, this.materials.spitter, 1.3)
        break
      }
      case 'brute': {
        mesh(this.geometries.brute, this.materials.brute, 0.85)
        const eye = mesh(this.geometries.eye, this.materials.eye, 1.25)
        eye.position.z = ENEMIES.brute.radius * 0.86
        break
      }
    }

    this.object.add(model)
    return model
  }

  private takeShot(kind: ShotKind): THREE.Object3D {
    const pooled = this.shotPool[kind].pop()
    if (pooled) {
      pooled.visible = true
      return pooled
    }

    const model = new THREE.Mesh(this.geometries[kind], this.materials[kind])
    this.object.add(model)
    return model
  }

  private buildRing(center: { x: number; z: number }): void {
    const radius = WAVE_RULES.arenaRadius
    const geometry = new THREE.RingGeometry(radius - 0.25, radius, 96)
    geometry.rotateX(-Math.PI / 2)
    const material = new THREE.MeshBasicMaterial({ color: ARENA_COLOR, transparent: true, opacity: 0.75, depthWrite: false })
    const ring = new THREE.Mesh(geometry, material)
    ring.position.set(center.x, 0.03, center.z)

    const innerGeometry = new THREE.CircleGeometry(radius - 0.25, 96)
    innerGeometry.rotateX(-Math.PI / 2)
    const innerMaterial = new THREE.MeshBasicMaterial({ color: ARENA_COLOR, transparent: true, opacity: 0.05, depthWrite: false })
    const inner = new THREE.Mesh(innerGeometry, innerMaterial)
    inner.position.set(center.x, 0.02, center.z)

    this.object.add(ring, inner)
    this.disposables.push(geometry, material, innerGeometry, innerMaterial)
  }

  private buildSign(gate: { x: number; z: number }): void {
    const texture = createTextTexture(
      [
        { text: 'SWARM ARENA', size: 88, weight: 800 },
        { text: '10 waves · Pistol · Bomb · Rocket', size: 40, color: '#8a93a8' },
      ],
      { width: 1024, height: 320, accent: cssColor(ARENA_COLOR), align: 'center' },
    )
    const boardGeometry = new THREE.PlaneGeometry(3.6, 1.125)
    const boardMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true })
    const board = new THREE.Mesh(boardGeometry, boardMaterial)
    board.position.set(gate.x, 3.2, gate.z - 0.6)

    const postGeometry = new THREE.CylinderGeometry(0.08, 0.1, 2.7, 10)
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x3a4255, metalness: 0.5, roughness: 0.5 })
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeometry, postMaterial)
      post.position.set(gate.x + side * 1.5, 1.35, gate.z - 0.6)
      post.castShadow = true
      this.object.add(post)
    }

    const glowTexture = createGlowTexture()
    const glow = createGlowSprite(glowTexture, ARENA_COLOR, 0.45)
    glow.scale.setScalar(5)
    glow.position.set(gate.x, 3.2, gate.z - 0.8)

    this.object.add(board, glow)
    this.disposables.push(texture, boardGeometry, boardMaterial, postGeometry, postMaterial, glowTexture, glow.material)
  }
}
