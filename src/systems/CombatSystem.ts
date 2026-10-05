import type * as THREE from 'three'

/** Anything the combat system can hit. */
export interface Damageable {
  readonly object: THREE.Object3D
  health: number
  readonly maxHealth: number
  /** Called once, the moment health reaches zero. */
  onDefeated(): void
}

export interface PulseResult {
  hits: number
  defeated: number
}

/** Health, damage, and the player's area pulse. */
export class CombatSystem {
  /** Metres. */
  readonly pulseRadius = 5
  readonly pulseDamage = 50
  /** Seconds between pulses. */
  readonly pulseCooldown = 0.8

  private readonly targets = new Set<Damageable>()
  private cooldownRemaining = 0

  register(target: Damageable): void {
    this.targets.add(target)
  }

  unregister(target: Damageable): void {
    this.targets.delete(target)
  }

  get canPulse(): boolean {
    return this.cooldownRemaining <= 0
  }

  /** 1 just after a pulse, falling to 0 when the next one is ready. */
  get cooldownFraction(): number {
    return Math.max(0, this.cooldownRemaining) / this.pulseCooldown
  }

  /** Damages every target within pulseRadius of the origin. Null while the pulse is cooling down. */
  pulse(origin: THREE.Vector3): PulseResult | null {
    if (!this.canPulse) return null
    this.cooldownRemaining = this.pulseCooldown

    let hits = 0
    let defeated = 0

    for (const target of this.targets) {
      const position = target.object.position
      if (Math.hypot(position.x - origin.x, position.z - origin.z) > this.pulseRadius) continue

      hits++
      if (this.damage(target, this.pulseDamage)) defeated++
    }

    return { hits, defeated }
  }

  /** Returns true if this hit is the one that defeated the target. */
  damage(target: Damageable, amount: number): boolean {
    if (target.health <= 0) return false

    target.health = Math.max(0, target.health - amount)
    if (target.health > 0) return false

    this.targets.delete(target)
    target.onDefeated()
    return true
  }

  update(dt: number): void {
    if (this.cooldownRemaining > 0) this.cooldownRemaining -= dt
  }

  dispose(): void {
    this.targets.clear()
  }
}
