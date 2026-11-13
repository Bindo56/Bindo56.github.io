import { ENEMIES, WAVES, WAVE_RULES, WEAPONS, type EnemyId, type WeaponId } from '../data/waves.ts'

/**
 * The swarm wave simulation. Plain numbers only - no three.js - stepped at a fixed tick rate with its own
 * seeded random, so it is deterministic: the same seed and inputs give the same game anywhere. That is what
 * lets it move to a server later; `snapshot` is the state that would be sent.
 */

export type WavePhase = 'idle' | 'breather' | 'fighting' | 'victory' | 'defeat'

export interface EnemyState {
  id: number
  type: EnemyId
  x: number
  z: number
  health: number
  /** Seconds until it can attack again. */
  cooldown: number
}

export interface ShotState {
  id: number
  kind: WeaponId | 'spit'
  x: number
  z: number
  vx: number
  vz: number
  /** Seconds flown, and seconds it lasts. A lob travels from (fromX, fromZ) to (toX, toZ) over `life`. */
  age: number
  life: number
  fromX: number
  fromZ: number
  toX: number
  toZ: number
}

export type WaveEvent =
  | { kind: 'phase'; phase: WavePhase; wave: number }
  | { kind: 'cleared'; wave: number }
  | { kind: 'fire'; weapon: WeaponId; x: number; z: number; dx: number; dz: number }
  | { kind: 'spit'; x: number; z: number }
  | { kind: 'hit'; id: number }
  | { kind: 'kill'; id: number; type: EnemyId; x: number; z: number }
  | { kind: 'burst'; x: number; z: number; radius: number }
  | { kind: 'hurt'; amount: number }

export interface WaveInput {
  x: number
  z: number
  /** Heading in radians, 0 = +z. Where shots go with no target in range. */
  facing: number
  fire: boolean
}

/** Keeps a body out of the world's solid things. Mutates `point`. */
export type Constrain = (point: { x: number; z: number }, radius: number) => void

const STEP = 1 / WAVE_RULES.tickRate
const SHOT_RADIUS = 0.25

export class WaveSystem {
  phase: WavePhase = 'idle'
  /** 0-based index into WAVES. */
  wave = 0
  /** Seconds left of the breather or the result screen. */
  timer = 0
  playerHealth: number = WAVE_RULES.playerHealth
  readonly enemies: EnemyState[] = []
  readonly shots: ShotState[] = []

  private readonly center: { x: number; z: number }
  private readonly constrain: Constrain | undefined
  private queue: EnemyId[] = []
  private spawnTimer = 0
  private fireCooldown = 0
  private nextId = 1
  private rng = 1
  private accumulator = 0
  private events: WaveEvent[] = []

  constructor(center: { x: number; z: number }, constrain?: Constrain) {
    this.center = center
    this.constrain = constrain
  }

  /** A wave is on or about to be. */
  get isRunning(): boolean {
    return this.phase === 'breather' || this.phase === 'fighting'
  }

  get weapon(): WeaponId {
    return WAVES[this.wave].weapon
  }

  /** Enemies still to come this wave, alive or not yet arrived. */
  get remaining(): number {
    return this.queue.length + this.enemies.length
  }

  /** Starts at wave 1. `seed` decides spawn order and positions. */
  start(seed: number): void {
    this.rng = seed >>> 0 || 1
    this.nextId = 1
    this.clearField()
    this.enter('breather', 0)
  }

  /** Everything the game looks like right now, as plain data. */
  snapshot(): { phase: WavePhase; wave: number; timer: number; playerHealth: number; enemies: EnemyState[]; shots: ShotState[] } {
    return {
      phase: this.phase,
      wave: this.wave,
      timer: this.timer,
      playerHealth: this.playerHealth,
      enemies: this.enemies.map((enemy) => ({ ...enemy })),
      shots: this.shots.map((shot) => ({ ...shot })),
    }
  }

  /** Advances by `dt` seconds in fixed steps. Returns what happened, in order. */
  update(dt: number, input: WaveInput): WaveEvent[] {
    this.events = []
    if (this.phase === 'idle') return this.events

    this.accumulator = Math.min(this.accumulator + dt, STEP * 10)
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP
      this.tick(input)
    }
    return this.events
  }

  private tick(input: WaveInput): void {
    switch (this.phase) {
      case 'breather':
        this.playerHealth = WAVE_RULES.playerHealth
        if ((this.timer -= STEP) <= 0) this.beginWave()
        break
      case 'fighting':
        this.spawn(input)
        this.fire(input)
        this.moveShots(input)
        this.moveEnemies(input)
        this.checkWaveOver()
        break
      case 'victory':
      case 'defeat':
        if ((this.timer -= STEP) <= 0) this.enter('idle', this.wave)
        break
      case 'idle':
        break
    }
  }

  private enter(phase: WavePhase, wave: number): void {
    this.phase = phase
    this.wave = wave
    this.timer = phase === 'breather' ? WAVE_RULES.breather : WAVE_RULES.resultTime
    this.events.push({ kind: 'phase', phase, wave })
  }

  private beginWave(): void {
    this.queue = []
    for (const [type, count] of Object.entries(WAVES[this.wave].enemies) as [EnemyId, number][]) {
      for (let i = 0; i < count; i++) this.queue.push(type)
    }
    // Shuffled, so each kind arrives spread through the wave rather than all at once.
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1))
      ;[this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]]
    }
    this.spawnTimer = 0
    this.fireCooldown = 0
    this.enter('fighting', this.wave)
  }

  private spawn(input: WaveInput): void {
    if ((this.spawnTimer -= STEP) > 0 || this.queue.length === 0 || this.enemies.length >= WAVE_RULES.maxAlive) return
    this.spawnTimer = WAVE_RULES.spawnInterval

    // A few tries for a spot on the arena's edge that is not on top of the player.
    let x = 0
    let z = 0
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = this.random() * Math.PI * 2
      x = this.center.x + Math.sin(angle) * WAVE_RULES.arenaRadius
      z = this.center.z + Math.cos(angle) * WAVE_RULES.arenaRadius
      if (Math.hypot(x - input.x, z - input.z) >= WAVE_RULES.spawnClearance) break
    }

    const type = this.queue.shift() as EnemyId
    this.enemies.push({ id: this.nextId++, type, x, z, health: ENEMIES[type].health * this.intensity, cooldown: ENEMIES[type].cooldown })
  }

  private fire(input: WaveInput): void {
    this.fireCooldown -= STEP
    if (!input.fire || this.fireCooldown > 0) return

    const weapon = WEAPONS[this.weapon]
    this.fireCooldown = 1 / weapon.rate

    // Aim at the nearest enemy in range, else straight ahead.
    let target: EnemyState | null = null
    let nearest = weapon.range
    for (const enemy of this.enemies) {
      const distance = Math.hypot(enemy.x - input.x, enemy.z - input.z)
      if (distance <= nearest) {
        nearest = distance
        target = enemy
      }
    }

    const dx = target ? (target.x - input.x) / Math.max(nearest, 1e-6) : Math.sin(input.facing)
    const dz = target ? (target.z - input.z) / Math.max(nearest, 1e-6) : Math.cos(input.facing)
    const reach = target ? nearest : weapon.range
    const shot: ShotState = {
      id: this.nextId++, kind: this.weapon, x: input.x, z: input.z, vx: dx * weapon.speed, vz: dz * weapon.speed,
      age: 0, life: weapon.lob ?? (weapon.range / weapon.speed) * 1.1,
      fromX: input.x, fromZ: input.z, toX: input.x + dx * reach, toZ: input.z + dz * reach,
    }
    this.shots.push(shot)
    this.events.push({ kind: 'fire', weapon: this.weapon, x: input.x, z: input.z, dx, dz })
  }

  private moveShots(input: WaveInput): void {
    const intensity = this.intensity

    for (let i = this.shots.length - 1; i >= 0; i--) {
      const shot = this.shots[i]
      shot.age += STEP
      let done = shot.age >= shot.life

      if (shot.kind === 'bomb') {
        const t = Math.min(shot.age / shot.life, 1)
        shot.x = shot.fromX + (shot.toX - shot.fromX) * t
        shot.z = shot.fromZ + (shot.toZ - shot.fromZ) * t
        if (done) this.burst(shot.x, shot.z, WEAPONS.bomb)
      } else {
        shot.x += shot.vx * STEP
        shot.z += shot.vz * STEP

        if (shot.kind === 'spit') {
          if (Math.hypot(shot.x - input.x, shot.z - input.z) <= WAVE_RULES.playerRadius + SHOT_RADIUS) {
            this.hurt(ENEMIES.spitter.damage * intensity)
            // That may have been the end: the field is already cleared.
            if (this.phase !== 'fighting') return
            done = true
          }
        } else {
          const weapon = WEAPONS[shot.kind]
          const struck = this.enemies.find((enemy) => enemy.health > 0 && Math.hypot(enemy.x - shot.x, enemy.z - shot.z) <= ENEMIES[enemy.type].radius + SHOT_RADIUS)
          if (struck) {
            if (weapon.splash > 0) this.burst(shot.x, shot.z, weapon)
            else this.damage(struck, weapon.damage * intensity)
            done = true
          } else if (done && weapon.splash > 0) {
            this.burst(shot.x, shot.z, weapon)
          }
        }
      }

      if (done) this.shots.splice(i, 1)
    }

    this.removeDead()
  }

  private moveEnemies(input: WaveInput): void {
    const intensity = this.intensity

    for (const enemy of this.enemies) {
      const kind = ENEMIES[enemy.type]
      enemy.cooldown -= STEP

      const dx = input.x - enemy.x
      const dz = input.z - enemy.z
      const distance = Math.max(Math.hypot(dx, dz), 1e-6)
      const touching = distance <= kind.radius + WAVE_RULES.playerRadius + 0.05

      // Ranged kinds close to within range, back off when crowded in on, and shoot; the rest just come.
      let move = kind.speed
      if (kind.shot) {
        if (distance < kind.shot.range * 0.6) move = -kind.speed * 0.6
        else if (distance < kind.shot.range * 0.9) move = 0
      } else if (touching) {
        move = 0
      }
      enemy.x += (dx / distance) * move * STEP
      enemy.z += (dz / distance) * move * STEP

      if (enemy.cooldown <= 0) {
        if (kind.shot && distance <= kind.shot.range) {
          enemy.cooldown = kind.cooldown
          this.shots.push({
            id: this.nextId++, kind: 'spit', x: enemy.x, z: enemy.z,
            vx: (dx / distance) * kind.shot.speed, vz: (dz / distance) * kind.shot.speed,
            age: 0, life: (kind.shot.range / kind.shot.speed) * 1.5, fromX: enemy.x, fromZ: enemy.z, toX: input.x, toZ: input.z,
          })
          this.events.push({ kind: 'spit', x: enemy.x, z: enemy.z })
        } else if (touching) {
          enemy.cooldown = kind.cooldown
          this.hurt(kind.damage * intensity)
        }
      }
      if (this.phase !== 'fighting') return
    }

    // Crowding: overlapping enemies push each other apart, which is what spreads a swarm round the player.
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i]
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j]
        const reach = ENEMIES[a.type].radius + ENEMIES[b.type].radius
        const dx = b.x - a.x
        const dz = b.z - a.z
        const distance = Math.hypot(dx, dz)
        if (distance >= reach || distance < 1e-6) continue
        const push = (reach - distance) / 2 / distance
        a.x -= dx * push
        a.z -= dz * push
        b.x += dx * push
        b.z += dz * push
      }
    }

    for (const enemy of this.enemies) {
      const radius = ENEMIES[enemy.type].radius
      // Never inside the player.
      const dx = enemy.x - input.x
      const dz = enemy.z - input.z
      const distance = Math.hypot(dx, dz)
      const reach = radius + WAVE_RULES.playerRadius
      if (distance < reach && distance > 1e-6) {
        enemy.x = input.x + (dx / distance) * reach
        enemy.z = input.z + (dz / distance) * reach
      }
      this.constrain?.(enemy, radius)
    }
  }

  /** Everything within the weapon's splash takes its damage, down to half at the edge. */
  private burst(x: number, z: number, weapon: { damage: number; splash: number }): void {
    for (const enemy of this.enemies) {
      if (enemy.health <= 0) continue
      const distance = Math.hypot(enemy.x - x, enemy.z - z) - ENEMIES[enemy.type].radius
      if (distance > weapon.splash) continue
      const falloff = 1 - 0.5 * Math.max(0, distance) / weapon.splash
      this.damage(enemy, weapon.damage * this.intensity * falloff)
    }
    this.events.push({ kind: 'burst', x, z, radius: weapon.splash })
  }

  private damage(enemy: EnemyState, amount: number): void {
    // A hair of slack, so floating-point rounding never leaves an enemy alive on a hit meant to finish it.
    enemy.health -= amount * 1.0001
    this.events.push({ kind: 'hit', id: enemy.id })
    if (enemy.health <= 0) this.events.push({ kind: 'kill', id: enemy.id, type: enemy.type, x: enemy.x, z: enemy.z })
  }

  private hurt(amount: number): void {
    if (this.phase !== 'fighting') return
    this.playerHealth = Math.max(0, this.playerHealth - amount)
    this.events.push({ kind: 'hurt', amount })
    if (this.playerHealth <= 0) {
      this.clearField()
      this.enter('defeat', this.wave)
    }
  }

  private checkWaveOver(): void {
    if (this.phase !== 'fighting' || this.remaining > 0) return

    this.events.push({ kind: 'cleared', wave: this.wave })
    this.shots.length = 0
    if (this.wave >= WAVES.length - 1) this.enter('victory', this.wave)
    else this.enter('breather', this.wave + 1)
  }

  private removeDead(): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) if (this.enemies[i].health <= 0) this.enemies.splice(i, 1)
  }

  private clearField(): void {
    this.enemies.length = 0
    this.shots.length = 0
    this.queue = []
    this.accumulator = 0
  }

  private get intensity(): number {
    return WAVES[this.wave].intensity
  }

  /** mulberry32: a small, fast, seeded random in [0, 1). */
  private random(): number {
    this.rng = (this.rng + 0x6d2b79f5) >>> 0
    let t = this.rng
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
