import * as THREE from 'three'

export type ImpactFeedback = 'impact' | 'cluster' | 'drill' | 'drill-finale' | 'pulse' | 'reactor'

interface Impulse { style: ImpactFeedback; age: number; strength: number; side: number }

const PROFILES: Record<ImpactFeedback, { duration: number; frequency: number; radius: number }> = {
  impact: { duration: 0.42, frequency: 13, radius: 2.6 },
  cluster: { duration: 0.18, frequency: 22, radius: 1.55 },
  drill: { duration: 0.16, frequency: 28, radius: 0.9 },
  'drill-finale': { duration: 0.65, frequency: 6.5, radius: 3.5 },
  pulse: { duration: 1.05, frequency: 3, radius: 5 },
  reactor: { duration: 0.55, frequency: 9, radius: 2.4 },
}

/** Adds temporary motion to a freshly positioned camera without changing its aim. */
export class CameraFeedback {
  private readonly impulses: Impulse[] = []
  private clusterSequence = 0
  private laserTarget = 0
  private laserStrength = 0
  private time = 0
  private readonly offset = new THREE.Vector3()
  private readonly rotation = new THREE.Euler()
  private readonly quaternion = new THREE.Quaternion()

  impact(style: ImpactFeedback, radius: number): void {
    // Cluster missiles can land in one frame: spread their little kicks into a short ripple.
    const queued = style === 'cluster' ? this.impulses.filter(item => item.style === 'cluster' && item.age <= 0).length : 0
    if (this.impulses.length >= 32) this.impulses.shift()
    this.impulses.push({
      style, age: -Math.min(0.18, queued * 0.028),
      strength: THREE.MathUtils.clamp(radius / PROFILES[style].radius, 0.4, 1.2),
      side: style === 'cluster' && this.clusterSequence++ % 2 ? -1 : 1,
    })
  }

  laser(strength: number): void {
    this.laserTarget = THREE.MathUtils.clamp(strength, 0, 1)
  }

  clear(): void {
    this.impulses.length = 0
    this.clusterSequence = 0
    this.laserTarget = this.laserStrength = 0
  }

  apply(camera: THREE.PerspectiveCamera, distance: number, dt: number, enabled: boolean): void {
    if (!enabled) { this.clear(); return }
    this.time += dt
    this.laserStrength = THREE.MathUtils.lerp(this.laserStrength, this.laserTarget, 1 - Math.exp(-dt * 30))
    const laser = this.laserStrength
    if (!this.impulses.length && laser < 0.001) return

    // Laser is a fine continuous buzz, independent of the discrete blast envelopes.
    let pitch = Math.sin(this.time * 173 + 0.6) * laser * 0.0022
    let yaw = Math.sin(this.time * 151) * laser * 0.0028
    let roll = Math.sin(this.time * 151) * laser * 0.0007
    this.offset.set(0, 0, 0)
    for (let i = this.impulses.length - 1; i >= 0; i--) {
      const impulse = this.impulses[i]
      const profile = PROFILES[impulse.style]
      const age = impulse.age
      impulse.age += dt
      if (age < 0) continue
      if (age >= profile.duration) { this.impulses.splice(i, 1); continue }
      const envelope = (1 - age / profile.duration) ** 2 * impulse.strength
      const phase = age * profile.frequency * Math.PI * 2
      const wave = Math.cos(phase) * envelope
      const cross = Math.sin(phase * 0.73) * envelope
      switch (impulse.style) {
        case 'impact':
          // A sharp upward kick with a short recoil and rebound.
          pitch += wave * 0.02
          yaw += cross * 0.004
          roll += cross * 0.003
          this.offset.y -= wave * 0.0015
          this.offset.z += wave * 0.004
          break
        case 'cluster':
          // Alternating side-to-side snaps distinguish the individual bomblets.
          pitch += wave * 0.004
          yaw += wave * impulse.side * 0.009
          roll += wave * impulse.side * 0.005
          this.offset.x += wave * impulse.side * 0.0018
          break
        case 'drill': {
          // Each buried charge sustains the fast, rough motor rattle.
          const rattle = (Math.cos(phase) + Math.sin(phase * 1.53) * 0.35) * envelope
          pitch += rattle * 0.0055
          yaw += cross * 0.0015
          this.offset.z += rattle * 0.0013
          break
        }
        case 'drill-finale':
          // A deeper, slower thud marks the final underground detonation.
          pitch -= wave * 0.024
          roll += cross * 0.004
          this.offset.y += wave * 0.002
          this.offset.z += wave * 0.007
          break
        case 'pulse': {
          // The wide shockwave swells into a slow push, roll, and return.
          const swell = 1 - Math.exp(-age * 55)
          pitch += wave * swell * 0.009
          roll += cross * swell * 0.01
          this.offset.y += cross * swell * 0.002
          this.offset.z += wave * swell * 0.012
          break
        }
        case 'reactor':
          pitch += wave * 0.012
          yaw += cross * 0.01
          roll += cross * 0.005
          this.offset.y += cross * 0.002
          break
      }
    }
    // Bound overlapping hits without replacing another weapon's active feedback.
    this.offset.clampLength(0, 0.012).multiplyScalar(Math.max(1, distance)).applyQuaternion(camera.quaternion)
    camera.position.add(this.offset)
    this.rotation.set(
      THREE.MathUtils.clamp(pitch, -0.032, 0.032),
      THREE.MathUtils.clamp(yaw, -0.028, 0.028),
      THREE.MathUtils.clamp(roll, -0.018, 0.018),
      'XYZ',
    )
    camera.quaternion.multiply(this.quaternion.setFromEuler(this.rotation))
  }
}
