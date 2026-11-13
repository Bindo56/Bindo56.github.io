import * as THREE from 'three'

/** A per-frame animation. `elapsed` is total seconds since the system started; `dt` is this frame's step. */
type Animation = (elapsed: number, dt: number) => void

interface RingEffect {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  age: number
  duration: number
  radius: number
}

const RING_OPACITY = 0.85

/**
 * Procedural animation (spin, bob), one-shot effects, and the AnimationMixers of any rigged models
 * added later - all advanced from a single update.
 */
export class AnimationSystem {
  private elapsed = 0
  private readonly animations = new Map<THREE.Object3D, Animation[]>()
  private readonly mixers = new Set<THREE.AnimationMixer>()
  private readonly rings: RingEffect[] = []

  /** Continuous rotation around Y. */
  spin(object: THREE.Object3D, radiansPerSecond: number): void {
    this.add(object, (_elapsed, dt) => {
      object.rotation.y += radiansPerSecond * dt
    })
  }

  /** Floats an object up and down around the height it has right now. */
  bob(object: THREE.Object3D, amplitude: number, cyclesPerSecond: number): void {
    const baseY = object.position.y

    // A random phase, so a row of identical objects does not move in lockstep.
    const phase = Math.random() * Math.PI * 2

    this.add(object, (elapsed) => {
      object.position.y = baseY + Math.sin(elapsed * cyclesPerSecond * Math.PI * 2 + phase) * amplitude
    })
  }

  /** Breathes a material's opacity between `min` and `max`. `object` is what `stop` knows it by. */
  pulseOpacity(object: THREE.Object3D, material: { opacity: number }, min: number, max: number, cyclesPerSecond: number): void {
    this.add(object, (elapsed) => {
      material.opacity = min + (max - min) * (0.5 + 0.5 * Math.sin(elapsed * cyclesPerSecond * Math.PI * 2))
    })
  }

  /** For rigged models (e.g. glTF) - their clips advance here alongside everything else. */
  addMixer(mixer: THREE.AnimationMixer): void {
    this.mixers.add(mixer)
  }

  removeMixer(mixer: THREE.AnimationMixer): void {
    this.mixers.delete(mixer)
  }

  /** Stops every procedural animation on an object, leaving it where it is. */
  stop(object: THREE.Object3D): void {
    this.animations.delete(object)
  }

  /** An expanding, fading ring on the ground. */
  ring(scene: THREE.Scene, center: THREE.Vector3, radius: number, color: number, duration = 0.45): void {
    const geometry = new THREE.RingGeometry(0.85, 1, 64)
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: RING_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
    })

    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(center.x, 0.05, center.z)
    mesh.scale.setScalar(0.01)
    scene.add(mesh)

    this.rings.push({ mesh, age: 0, duration, radius })
  }

  update(dt: number): void {
    this.elapsed += dt

    for (const list of this.animations.values()) {
      for (const animation of list) animation(this.elapsed, dt)
    }

    for (const mixer of this.mixers) mixer.update(dt)

    // Backwards, because finished rings are removed mid-loop.
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i]
      ring.age += dt

      const t = Math.min(ring.age / ring.duration, 1)
      const easedOut = 1 - (1 - t) ** 3
      ring.mesh.scale.setScalar(Math.max(easedOut * ring.radius, 0.01))
      ring.mesh.material.opacity = RING_OPACITY * (1 - t)

      if (t >= 1) {
        this.disposeRing(ring)
        this.rings.splice(i, 1)
      }
    }
  }

  dispose(): void {
    this.animations.clear()
    this.mixers.clear()
    for (const ring of this.rings) this.disposeRing(ring)
    this.rings.length = 0
  }

  private add(object: THREE.Object3D, animation: Animation): void {
    const list = this.animations.get(object)
    if (list) list.push(animation)
    else this.animations.set(object, [animation])
  }

  private disposeRing(ring: RingEffect): void {
    ring.mesh.removeFromParent()
    ring.mesh.geometry.dispose()
    ring.mesh.material.dispose()
  }
}
