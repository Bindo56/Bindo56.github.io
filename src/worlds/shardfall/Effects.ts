import * as THREE from 'three'
import type { WorldVoxel } from './VoxelField.ts'
import type { WeaponId } from './types.ts'

interface Particle { position: THREE.Vector3; velocity: THREE.Vector3; rotation: THREE.Vector3; size: number; age: number; life: number; color: number }
interface Flash { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; age: number; life: number; radius: number; ring: boolean }
interface Chunk { mesh: THREE.InstancedMesh; velocity: THREE.Vector3; spin: THREE.Vector3; age: number }
export interface Projectile {
  mesh: THREE.Group
  trail: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>
  start: THREE.Vector3
  end: THREE.Vector3
  arc: THREE.Vector3
  age: number
  duration: number
  weapon: WeaponId
  impact: (point: THREE.Vector3, direction: THREE.Vector3) => void
}

const UP = new THREE.Vector3(0, 1, 0)
const Z = new THREE.Vector3(0, 0, 1)
const MAX_PARTICLES = 1100

export class ShardfallEffects {
  readonly launcher = new THREE.Group()
  private readonly particles: Particle[] = []
  private readonly flashes: Flash[] = []
  private readonly chunks: Chunk[] = []
  private readonly projectiles: Projectile[] = []
  private readonly dummy = new THREE.Object3D()
  private readonly instances: THREE.InstancedMesh
  private readonly sphere = new THREE.IcosahedronGeometry(1, 1)
  private readonly ring = new THREE.RingGeometry(0.91, 1, 64)
  private readonly cylinder = new THREE.CylinderGeometry(1, 1, 1, 6)
  private readonly nose = new THREE.ConeGeometry(0.13, 0.35, 5)
  private readonly missileBody = new THREE.CylinderGeometry(0.09, 0.13, 0.65, 6)
  private readonly beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>
  private readonly beamCore: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>
  private readonly beamTarget = new THREE.Vector3()
  private readonly launcherModels = new Map<WeaponId, THREE.Group>()
  private readonly rigMaterials: THREE.Material[] = []
  private readonly missileMaterial = new THREE.MeshBasicMaterial({ color: 0xfff0c3 })
  private readonly engineMaterial = new THREE.MeshBasicMaterial({ color: 0xff8d42 })
  private readonly vector = new THREE.Vector3()
  private readonly color = new THREE.Color()
  private particleCursor = 0
  private recoil = 0
  private elapsed = 0
  private disposed = false

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly cube: THREE.BoxGeometry,
    private readonly material: THREE.MeshToonMaterial,
    private readonly reducedMotion: boolean,
  ) {
    this.instances = new THREE.InstancedMesh(cube, material, MAX_PARTICLES)
    this.instances.count = 0
    this.instances.frustumCulled = false
    this.instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    scene.add(this.instances)
    this.beam = new THREE.Mesh(this.cylinder, new THREE.MeshBasicMaterial({ color: 0x39e8f1, transparent: true, opacity: 0.24, depthWrite: false }))
    this.beamCore = new THREE.Mesh(this.cylinder, new THREE.MeshBasicMaterial({ color: 0xd6ffff }))
    this.beam.visible = this.beamCore.visible = false
    scene.add(this.beam, this.beamCore)
    camera.add(this.launcher)
    this.buildLaunchers()
  }

  setWeapon(weapon: WeaponId): void {
    for (const [id, model] of this.launcherModels) model.visible = id === weapon
  }

  muzzle(): THREE.Vector3 {
    this.launcher.updateWorldMatrix(true, false)
    return this.launcher.localToWorld(new THREE.Vector3(0, 0, -1.5))
  }

  fire(weapon: WeaponId, target: THREE.Vector3, impact: Projectile['impact'], start?: THREE.Vector3, arcOffset = 0): void {
    if (this.projectiles.length >= 40) return
    const origin = start?.clone() ?? this.muzzle()
    const mesh = new THREE.Group()
    const body = new THREE.Mesh(this.missileBody, this.missileMaterial)
    const tip = new THREE.Mesh(this.nose, this.missileMaterial)
    tip.position.y = 0.46
    const flame = new THREE.Mesh(this.nose, this.engineMaterial)
    flame.rotation.z = Math.PI
    flame.position.y = -0.5
    flame.scale.set(0.6, 1.4, 0.6)
    mesh.add(body, tip, flame)
    mesh.scale.setScalar(THREE.MathUtils.clamp(origin.distanceTo(target) * 0.018, 0.3, 1))
    mesh.position.copy(origin)
    const trail = new THREE.Mesh(this.cylinder, new THREE.MeshBasicMaterial({
      color: weapon === 'drill' ? 0xffd45c : weapon === 'cluster' ? 0xd49dff : 0xffb665,
      transparent: true, opacity: 0.6, depthWrite: false,
    }))
    const arc = this.vector.copy(origin).add(target).normalize().multiplyScalar(Math.min(8, origin.distanceTo(target) * 0.12)).clone()
    arc.x += arcOffset
    const projectile: Projectile = {
      mesh, trail, start: origin, end: target.clone(), arc, age: 0,
      duration: THREE.MathUtils.clamp(origin.distanceTo(target) / 85, 0.38, 1.25), weapon, impact,
    }
    this.projectiles.push(projectile)
    this.scene.add(mesh, trail)
    this.recoil = 0.15
  }

  laser(target: THREE.Vector3 | null): void {
    this.beam.visible = this.beamCore.visible = target !== null
    if (!target) return
    this.beamTarget.copy(target)
    this.syncLaser()
  }

  syncLaser(): void {
    if (!this.beam.visible) return
    const start = this.muzzle()
    this.segment(this.beam, start, this.beamTarget, 0.1)
    this.segment(this.beamCore, start, this.beamTarget, 0.025)
  }

  flash(point: THREE.Vector3, radius: number, color: number, wave = false): void {
    if (this.flashes.length > 22) this.removeFlash(this.flashes.shift()!)
    const mesh = new THREE.Mesh(wave ? this.ring : this.sphere, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: wave ? 0.8 : 0.7,
      side: THREE.DoubleSide, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }))
    mesh.position.copy(point)
    if (wave) mesh.quaternion.setFromUnitVectors(Z, point.clone().normalize())
    mesh.scale.setScalar(0.02)
    this.scene.add(mesh)
    this.flashes.push({ mesh, age: 0, life: this.reducedMotion ? 0.22 : wave ? 0.95 : 0.38, radius, ring: wave })
  }

  debris(voxels: WorldVoxel[], origin: THREE.Vector3, power: number): void {
    const stride = Math.max(1, Math.ceil(voxels.length / (this.reducedMotion ? 40 : 260)))
    for (let i = 0; i < voxels.length; i += stride) {
      const voxel = voxels[i]
      const direction = voxel.position.clone().sub(origin).normalize()
      if (direction.lengthSq() < 0.1) direction.copy(voxel.position).normalize()
      const particle: Particle = {
        position: voxel.position.clone(),
        velocity: direction.multiplyScalar(2 + Math.random() * power).addScaledVector(voxel.position.clone().normalize(), 1.4),
        rotation: new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(3),
        size: voxel.size * (0.45 + Math.random() * 0.45), age: 0,
        life: this.reducedMotion ? 0.65 : 2 + Math.random() * 2.1, color: voxel.color,
      }
      if (this.particles.length < MAX_PARTICLES) this.particles.push(particle)
      else this.particles[this.particleCursor++ % MAX_PARTICLES] = particle
    }
  }

  collapse(voxels: WorldVoxel[], origin: THREE.Vector3): void {
    if (voxels.length < 8 || this.reducedMotion) { this.debris(voxels, origin, 2); return }
    // Keep recognizable pieces of floors and bridges while bounding transient GPU work.
    if (this.chunks.length >= 14) this.removeChunk(this.chunks.shift()!)
    const selected = voxels.filter((_, i) => i % Math.max(1, Math.ceil(voxels.length / 2000)) === 0)
    const center = new THREE.Vector3()
    for (const voxel of selected) center.add(voxel.position)
    center.multiplyScalar(1 / selected.length)
    const mesh = new THREE.InstancedMesh(this.cube, this.material, selected.length)
    for (let i = 0; i < selected.length; i++) {
      const voxel = selected[i]
      this.dummy.position.copy(voxel.position).sub(center)
      this.dummy.quaternion.copy(voxel.rotation)
      this.dummy.scale.setScalar(voxel.size * 0.985)
      this.dummy.updateMatrix()
      mesh.setMatrixAt(i, this.dummy.matrix)
      mesh.setColorAt(i, this.color.setHex(voxel.color))
    }
    mesh.position.copy(center)
    mesh.computeBoundingSphere()
    this.scene.add(mesh)
    this.chunks.push({
      mesh, age: 0,
      velocity: center.clone().sub(origin).normalize().multiplyScalar(1.5),
      spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.7),
    })
  }

  update(dt: number, paused: boolean): void {
    const aspect = this.camera.aspect
    this.launcher.position.set(Math.min(1.5, aspect * 0.65), -0.65, -3.1)
    this.launcher.scale.setScalar(aspect < 0.8 ? 0.12 : 0.17)
    this.launcher.rotation.set(-0.12, -0.18, -0.07)
    this.launcher.position.z += this.recoil
    if (paused) return
    this.elapsed += dt
    this.recoil *= Math.exp(-dt * 18)
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i]
      projectile.age += dt
      const t = Math.min(1, projectile.age / projectile.duration)
      const previous = projectile.mesh.position.clone()
      projectile.mesh.position.lerpVectors(projectile.start, projectile.end, t).addScaledVector(projectile.arc, Math.sin(t * Math.PI))
      const direction = projectile.mesh.position.clone().sub(previous).normalize()
      if (direction.lengthSq()) projectile.mesh.quaternion.setFromUnitVectors(UP, direction)
      const tail = projectile.mesh.position.clone().addScaledVector(direction, -Math.min(4, 0.25 + projectile.start.distanceTo(projectile.end) * 0.035))
      this.segment(projectile.trail, tail, projectile.mesh.position, 0.035)
      if (t >= 1) {
        projectile.mesh.removeFromParent()
        projectile.trail.removeFromParent()
        projectile.trail.material.dispose()
        this.projectiles.splice(i, 1)
        projectile.impact(projectile.end.clone(), direction)
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const flash = this.flashes[i]
      flash.age += dt
      const progress = Math.min(1, flash.age / flash.life)
      flash.mesh.scale.setScalar(flash.radius * (0.15 + progress * (flash.ring ? 1.8 : 1)))
      flash.mesh.material.opacity = (1 - progress) * (flash.ring ? 0.7 : 0.65)
      if (progress >= 1) { this.removeFlash(flash); this.flashes.splice(i, 1) }
    }
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const chunk = this.chunks[i]
      chunk.age += dt
      this.vector.copy(chunk.mesh.position).normalize()
      chunk.velocity.addScaledVector(this.vector, -4.8 * dt)
      chunk.mesh.position.addScaledVector(chunk.velocity, dt)
      chunk.mesh.rotation.x += chunk.spin.x * dt
      chunk.mesh.rotation.y += chunk.spin.y * dt
      chunk.mesh.rotation.z += chunk.spin.z * dt
      chunk.mesh.scale.setScalar(chunk.age > 3 ? Math.max(0, 1 - (chunk.age - 3) / 1.5) : 1)
      if (chunk.age > 4.5) { this.removeChunk(chunk); this.chunks.splice(i, 1) }
    }
    let count = 0
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i]
      particle.age += dt
      if (particle.age > particle.life) { this.particles.splice(i, 1); continue }
      particle.velocity.addScaledVector(this.vector.copy(particle.position).normalize(), -3.5 * dt)
      particle.position.addScaledVector(particle.velocity, dt)
      this.dummy.position.copy(particle.position)
      this.dummy.rotation.set(particle.rotation.x * particle.age, particle.rotation.y * particle.age, particle.rotation.z * particle.age)
      this.dummy.scale.setScalar(particle.size * Math.min(1, (particle.life - particle.age) * 1.6))
      this.dummy.updateMatrix()
      this.instances.setMatrixAt(count, this.dummy.matrix)
      this.instances.setColorAt(count, this.color.setHex(particle.color))
      count++
    }
    this.instances.count = count
    this.instances.instanceMatrix.needsUpdate = true
    if (this.instances.instanceColor) this.instances.instanceColor.needsUpdate = true
  }

  clear(): void {
    for (const projectile of this.projectiles) {
      projectile.mesh.removeFromParent()
      projectile.trail.removeFromParent()
      projectile.trail.material.dispose()
    }
    for (const flash of this.flashes) this.removeFlash(flash)
    for (const chunk of this.chunks) this.removeChunk(chunk)
    this.projectiles.length = this.flashes.length = this.chunks.length = this.particles.length = 0
    this.instances.count = 0
    this.laser(null)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clear()
    this.instances.dispose()
    this.instances.removeFromParent()
    this.launcher.removeFromParent()
    this.beam.removeFromParent()
    this.beamCore.removeFromParent()
    this.beam.material.dispose()
    this.beamCore.material.dispose()
    this.missileMaterial.dispose()
    this.engineMaterial.dispose()
    for (const material of this.rigMaterials) material.dispose()
    for (const geometry of [this.sphere, this.ring, this.cylinder, this.nose, this.missileBody]) geometry.dispose()
  }

  private segment(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, width: number): void {
    this.vector.copy(to).sub(from)
    const length = this.vector.length()
    mesh.position.copy(from).add(to).multiplyScalar(0.5)
    mesh.quaternion.setFromUnitVectors(UP, this.vector.normalize())
    mesh.scale.set(width, length, width)
  }
  private removeFlash(flash: Flash): void { flash.mesh.removeFromParent(); flash.mesh.material.dispose() }
  private removeChunk(chunk: Chunk): void { chunk.mesh.removeFromParent(); chunk.mesh.dispose() }

  private buildLaunchers(): void {
    const shell = new THREE.MeshToonMaterial({ color: 0x344854, gradientMap: this.material.gradientMap })
    const trim = new THREE.MeshToonMaterial({ color: 0xd8e0db, gradientMap: this.material.gradientMap })
    const dark = new THREE.MeshToonMaterial({ color: 0x0b1622, gradientMap: this.material.gradientMap })
    this.rigMaterials.push(shell, trim, dark)
    const box = (group: THREE.Group, size: number[], position: number[], material: THREE.Material): THREE.Mesh => {
      const mesh = new THREE.Mesh(this.cube, material)
      mesh.scale.set(size[0], size[1], size[2])
      mesh.position.set(position[0], position[1], position[2])
      group.add(mesh)
      return mesh
    }
    for (const [id, color] of [['impact', 0xffb56b], ['cluster', 0xdca0ff], ['drill', 0xffd95c], ['laser', 0x7bf5ef], ['pulse', 0x98b1ff]] as const) {
      const model = new THREE.Group()
      const accent = new THREE.MeshBasicMaterial({ color })
      this.rigMaterials.push(accent)
      box(model, [2.1, 0.35, 2.3], [0, -0.55, 0.45], shell)
      box(model, [0.8, 0.8, 0.8], [0, -0.05, 0.45], dark)
      box(model, [1.4, 0.5, 1.5], [0, 0.4, 0.2], shell)
      if (id === 'cluster') {
        for (let x = -1; x <= 1; x++) for (let y = 0; y < 2; y++) {
          box(model, [0.38, 0.38, 1.5], [x * 0.44, 0.35 + y * 0.45, -0.65], trim)
          box(model, [0.24, 0.24, 0.04], [x * 0.44, 0.35 + y * 0.45, -1.42], accent)
        }
      } else if (id === 'laser') {
        box(model, [0.38, 0.42, 2.8], [0, 0.5, -0.75], trim)
        for (const x of [-0.5, 0.5]) box(model, [0.18, 0.7, 2], [x, 0.5, -0.8], accent)
      } else if (id === 'pulse') {
        for (let i = 0; i < 8; i++) {
          const angle = i * Math.PI / 4
          box(model, [0.3, 0.3, 0.9], [Math.cos(angle) * 0.7, 0.6 + Math.sin(angle) * 0.7, -0.7], accent)
        }
        box(model, [0.6, 0.6, 1.2], [0, 0.6, -0.5], dark)
      } else {
        box(model, [0.7, 0.7, id === 'drill' ? 2.6 : 2], [0, 0.6, -0.65], trim)
        box(model, [0.52, 0.52, 0.06], [0, 0.6, id === 'drill' ? -1.98 : -1.68], accent)
        if (id === 'drill') for (let i = 0; i < 4; i++) box(model, [0.9, 0.9, 0.1], [0, 0.6, -0.3 - i * 0.4], shell)
      }
      box(model, [1.9, 0.06, 0.08], [0, -0.34, 1.3], accent)
      this.launcher.add(model)
      this.launcherModels.set(id, model)
    }
    this.setWeapon('impact')
  }
}
