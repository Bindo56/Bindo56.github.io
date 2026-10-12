import * as THREE from 'three'

const PLANET_RADIUS = 3.35
const UP = new THREE.Vector3(0, 1, 0)
const FORWARD = new THREE.Vector3(0, 0, 1)
const BLUE = 0x4ebaff
const RED = 0xff6658

export type Team = 'blue' | 'red'
export type Weapon = 'rifle' | 'rocket'

interface Fighter {
  root: THREE.Group
  zone: THREE.Group
  leftArm: THREE.Group
  rightArm: THREE.Group
  leftLeg: THREE.Group
  rightLeg: THREE.Group
  muzzle: THREE.Mesh
  team: Team
  baseX: number
  baseZ: number
  phase: number
  x: number
  z: number
  stunnedUntil: number
}

interface Shot {
  mesh: THREE.Mesh
  direction: THREE.Vector3
  speed: number
  life: number
  rocket: boolean
  target: Fighter | null
}

interface BattleZone {
  root: THREE.Group
  normal: THREE.Vector3
}

interface Tracer {
  mesh: THREE.Mesh
  from: Fighter
  to: Fighter
  phase: number
}

interface Smoke {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  baseX: number
  baseZ: number
  phase: number
}

/** A globe-scale spectator diorama. Every battle stays on the planet surface. */
export class WarfrontVisual {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 90)

  private readonly geometries = new Set<THREE.BufferGeometry>()
  private readonly materials = new Set<THREE.Material>()
  private readonly boxCache = new Map<string, THREE.BoxGeometry>()
  private readonly fighterMaterialCache = new Map<string, THREE.Material>()
  private readonly fighters: Fighter[] = []
  private readonly shots: Shot[] = []
  private readonly impacts: { mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; life: number }[] = []
  private readonly battleZones: BattleZone[] = []
  private readonly tracers: Tracer[] = []
  private readonly smoke: Smoke[] = []
  private readonly blasts: { mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; phase: number }[] = []
  private readonly shockwaves: { mesh: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>; phase: number }[] = []
  private readonly embers: { mesh: THREE.InstancedMesh; positions: THREE.Vector3[]; phases: number[]; zone: THREE.Group }[] = []
  private readonly dummy = new THREE.Object3D()
  private readonly globe = new THREE.Group()
  private readonly playerAnchor = new THREE.Group()
  private readonly tempStart = new THREE.Vector3()
  private readonly tempEnd = new THREE.Vector3()
  private readonly tempDirection = new THREE.Vector3()
  private elapsed = 0
  private azimuth = 0
  private elevation = 0.16
  private distance = 12.8
  private targetAzimuth = 0
  private targetElevation = 0.16
  private targetDistance = 12.8
  private selected: Fighter | null = null
  private weapon: Weapon = 'rifle'
  private heading = 0
  private moveForward = 0
  private moveStrafe = 0
  private turnSpeed = 0
  private firing = false
  private nextShot = 0
  private hopTime = 0
  private entryProgress = 1
  private readonly entryCamera = new THREE.Vector3()
  private disposed = false
  private readonly reducedMotion = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  constructor() {
    this.scene.background = new THREE.Color(0x050b18)
    this.scene.fog = new THREE.FogExp2(0x050b18, 0.011)
    this.scene.add(new THREE.AmbientLight(0xb9d3f7, 1.45))
    const sun = new THREE.DirectionalLight(0xffb79a, 2.5)
    sun.position.set(6, 8, 10)
    this.scene.add(sun)
    const rim = new THREE.DirectionalLight(0x63a9ff, 1.25)
    rim.position.set(-7, -2, -5)
    this.scene.add(rim)

    this.addStars()
    this.globe.name = 'Warfront planet'
    this.scene.add(this.globe)
    this.addPlanet(this.globe)
    this.globe.add(this.playerAnchor)

    this.addSurfaceDetails(this.globe)
    // Fibonacci spacing covers both hemispheres without a repeated latitude pattern.
    for (let index = 0; index < 28; index++) {
      const y = 1 - 2 * (index + 0.5) / 28
      const radius = Math.sqrt(1 - y * y)
      const angle = index * Math.PI * (3 - Math.sqrt(5))
      this.addBattlefield(this.globe, new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius), index)
    }
    this.update(0)
  }

  orbit(deltaX: number, deltaY: number): void {
    if (this.disposed || this.selected) return
    this.targetAzimuth -= deltaX * 0.0046
    this.targetElevation = THREE.MathUtils.clamp(this.targetElevation + deltaY * 0.0046, -1.18, 1.18)
  }

  zoom(delta: number): void {
    if (this.disposed || this.selected) return
    this.targetDistance = THREE.MathUtils.clamp(this.targetDistance + delta * 0.013, 4.75, 15)
  }

  showPlanet(): void {
    this.targetDistance = 12.8
    this.targetAzimuth = 0
    this.targetElevation = 0.16
  }

  focusBattle(): void {
    this.targetDistance = 5.25
    this.targetAzimuth = 0
    this.targetElevation = 0.16
  }

  get zoomPercent(): number {
    return Math.round((15 - this.targetDistance) / (15 - 4.75) * 100)
  }

  get isPlaying(): boolean { return this.selected !== null }
  get playerTeam(): Team | null { return this.selected?.team ?? null }
  get currentWeapon(): Weapon { return this.weapon }

  enterRandomSoldier(): Team {
    if (this.selected) return this.selected.team
    const fighter = this.fighters[Math.floor(Math.random() * this.fighters.length)]
    this.selected = fighter
    this.heading = fighter.team === 'blue' ? Math.PI / 2 : -Math.PI / 2
    this.weapon = 'rifle'
    this.nextShot = 0
    this.firing = false
    this.hopTime = 0
    this.entryProgress = 0
    this.entryCamera.copy(this.camera.position)
    const start = fighter.zone.localToWorld(new THREE.Vector3(fighter.x, surfaceY(fighter.x, fighter.z), fighter.z))
    const normal = start.normalize()
    this.playerAnchor.position.copy(normal).multiplyScalar(PLANET_RADIUS + 0.012)
    this.playerAnchor.quaternion.setFromUnitVectors(UP, normal)
    this.playerAnchor.add(fighter.root)
    fighter.root.position.set(0, 0.036, 0)
    fighter.root.rotation.y = this.heading
    this.camera.fov = 61
    this.camera.near = 0.015
    this.camera.updateProjectionMatrix()
    return fighter.team
  }

  leaveSoldier(): void {
    const fighter = this.selected
    if (!fighter) return
    this.selected = null
    this.firing = false
    this.moveForward = this.moveStrafe = this.turnSpeed = 0
    fighter.zone.add(fighter.root)
    fighter.root.position.set(fighter.x, surfaceY(fighter.x, fighter.z) + 0.036, fighter.z)
    this.camera.fov = 48
    this.camera.near = 0.1
    this.camera.up.copy(UP)
    this.camera.updateProjectionMatrix()
    const normal = this.playerAnchor.position.clone().normalize()
    this.targetAzimuth = Math.atan2(normal.x, normal.z)
    this.targetElevation = Math.asin(normal.y)
    this.targetDistance = 5.6
    this.azimuth = this.targetAzimuth
    this.elevation = this.targetElevation
    this.distance = this.targetDistance
  }

  setMovement(forward: number, strafe: number, turn: number): void {
    this.moveForward = THREE.MathUtils.clamp(forward, -1, 1)
    this.moveStrafe = THREE.MathUtils.clamp(strafe, -1, 1)
    this.turnSpeed = THREE.MathUtils.clamp(turn, -1, 1)
  }

  aim(deltaX: number): void { if (this.selected) this.heading -= deltaX * 0.006 }
  jump(): void { if (this.selected && this.hopTime <= 0) this.hopTime = 0.52 }
  equip(weapon: Weapon): void { this.weapon = weapon }
  setFiring(value: boolean): void { this.firing = value && this.selected !== null }

  update(dt: number): void {
    if (this.disposed) return
    const frame = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, 0.08) : 0
    this.elapsed += frame
    if (this.selected) this.updatePlayer(frame)
    else {
      const easing = this.reducedMotion ? 1 : 1 - Math.exp(-6 * frame)
      this.azimuth += (this.targetAzimuth - this.azimuth) * easing
      this.elevation += (this.targetElevation - this.elevation) * easing
      this.distance += (this.targetDistance - this.distance) * easing
      const horizontal = Math.cos(this.elevation) * this.distance
      this.camera.position.set(Math.sin(this.azimuth) * horizontal, Math.sin(this.elevation) * this.distance, Math.cos(this.azimuth) * horizontal)
      this.camera.lookAt(0, 0, 0)
    }

    for (const fighter of this.fighters) {
      if (fighter === this.selected) continue
      const stride = this.elapsed * 2.9 + fighter.phase
      fighter.x = fighter.baseX + Math.sin(this.elapsed * 0.73 + fighter.phase) * 0.075
      fighter.z = fighter.baseZ + Math.cos(this.elapsed * 0.61 + fighter.phase) * 0.058
      fighter.root.position.set(fighter.x, surfaceY(fighter.x, fighter.z) + 0.036 + Math.abs(Math.sin(stride)) * 0.009, fighter.z)
      fighter.root.rotation.y = (fighter.team === 'blue' ? Math.PI / 2 : -Math.PI / 2) + Math.sin(this.elapsed * 0.8 + fighter.phase) * 0.075
      fighter.leftLeg.rotation.x = Math.sin(stride) * 0.29
      fighter.rightLeg.rotation.x = -Math.sin(stride) * 0.29
      fighter.leftArm.rotation.x = -Math.sin(stride) * 0.09
      fighter.rightArm.rotation.x = Math.sin(stride) * 0.09
      fighter.muzzle.visible = Math.sin(this.elapsed * 6.8 + fighter.phase * 2.3) > 0.97
      fighter.root.rotation.z = this.elapsed < fighter.stunnedUntil ? 0.5 : 0
    }

    for (const tracer of this.tracers) {
      if (tracer.from === this.selected || tracer.to === this.selected) { tracer.mesh.visible = false; continue }
      const cycle = (this.elapsed * 1.15 + tracer.phase) % 1.9
      tracer.mesh.visible = cycle < 0.42
      if (!tracer.mesh.visible) continue
      const progress = cycle / 0.42
      this.tempStart.set(tracer.from.x, surfaceY(tracer.from.x, tracer.from.z) + 0.17, tracer.from.z)
      this.tempEnd.set(tracer.to.x, surfaceY(tracer.to.x, tracer.to.z) + 0.16, tracer.to.z)
      tracer.mesh.position.copy(this.tempStart).lerp(this.tempEnd, progress)
      tracer.mesh.position.y += Math.sin(progress * Math.PI) * 0.085
      this.tempDirection.copy(this.tempEnd).sub(this.tempStart).normalize()
      tracer.mesh.quaternion.setFromUnitVectors(FORWARD, this.tempDirection)
    }

    for (const smoke of this.smoke) {
      const rise = (this.elapsed * 0.19 + smoke.phase) % 1
      smoke.mesh.position.set(smoke.baseX + Math.sin(this.elapsed * 0.7 + smoke.phase) * 0.035, surfaceY(smoke.baseX, smoke.baseZ) + 0.17 + rise * 0.54, smoke.baseZ)
      smoke.mesh.scale.setScalar(0.7 + rise * 1.8)
      smoke.mesh.material.opacity = (1 - rise) * 0.25
    }
    for (const blast of this.blasts) {
      const cycle = (this.elapsed * 0.31 + blast.phase) % 1
      const flare = cycle < 0.19 ? cycle / 0.19 : 0
      blast.mesh.visible = flare > 0
      blast.mesh.scale.setScalar(0.18 + flare * 2.1)
      blast.mesh.material.opacity = (1 - flare) * 0.55
    }
    for (const wave of this.shockwaves) {
      const cycle = (this.elapsed * 0.31 + wave.phase) % 1
      wave.mesh.visible = cycle < 0.23
      if (!wave.mesh.visible) continue
      const progress = cycle / 0.23
      wave.mesh.scale.setScalar(0.15 + progress * 5.5)
      wave.mesh.material.opacity = (1 - progress) * 0.48
    }
    for (const field of this.embers) {
      for (let index = 0; index < field.positions.length; index++) {
        const origin = field.positions[index]
        const drift = (this.elapsed * 0.16 + field.phases[index]) % 1
        this.dummy.position.set(origin.x + Math.sin(this.elapsed * 1.2 + index) * 0.035, origin.y + drift * 0.38, origin.z)
        this.dummy.scale.setScalar((1 - drift) * 0.7 + 0.18)
        this.dummy.updateMatrix()
        field.mesh.setMatrixAt(index, this.dummy.matrix)
      }
      field.mesh.instanceMatrix.needsUpdate = true
    }
    this.updateShots(frame)
    const view = this.camera.position.clone().normalize()
    for (const zone of this.battleZones) zone.root.visible = zone.normal.dot(view) > (this.selected ? 0.55 : -0.05)
  }

  private updatePlayer(frame: number): void {
    const fighter = this.selected
    if (!fighter) return
    this.heading += this.turnSpeed * frame * 2.3
    const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading))
    const right = new THREE.Vector3(forward.z, 0, -forward.x)
    const movement = forward.clone().multiplyScalar(this.moveForward).addScaledVector(right, this.moveStrafe)
    if (movement.lengthSq() > 1) movement.normalize()
    if (movement.lengthSq() > 0) {
      const tangent = movement.applyQuaternion(this.playerAnchor.quaternion)
      const normal = this.playerAnchor.position.clone().normalize().addScaledVector(tangent, frame * 0.47 / PLANET_RADIUS).normalize()
      this.playerAnchor.position.copy(normal).multiplyScalar(PLANET_RADIUS + 0.012)
      this.playerAnchor.quaternion.setFromUnitVectors(UP, normal)
    }
    if (this.hopTime > 0) this.hopTime = Math.max(0, this.hopTime - frame)
    const hop = this.hopTime > 0 ? Math.sin((1 - this.hopTime / 0.52) * Math.PI) * 0.11 : 0
    fighter.root.position.set(0, 0.036 + hop, 0)
    fighter.root.rotation.y = this.heading
    const stride = this.elapsed * 12
    const walk = movement.lengthSq() > 0 ? 0.38 : 0.045
    fighter.leftLeg.rotation.x = Math.sin(stride) * walk
    fighter.rightLeg.rotation.x = -Math.sin(stride) * walk
    fighter.leftArm.rotation.x = -Math.sin(stride) * walk * 0.4
    fighter.rightArm.rotation.x = Math.sin(stride) * walk * 0.4
    fighter.muzzle.visible = false

    this.globe.updateMatrixWorld(true)
    const normal = this.playerAnchor.position.clone().normalize()
    const worldForward = forward.applyQuaternion(this.playerAnchor.quaternion)
    const target = normal.clone().multiplyScalar(PLANET_RADIUS + 0.19).addScaledVector(worldForward, 0.39)
    const desired = normal.clone().multiplyScalar(PLANET_RADIUS + 0.48).addScaledVector(worldForward, -0.72)
    desired.addScaledVector(right.applyQuaternion(this.playerAnchor.quaternion), 0.14)
    if (this.entryProgress < 1) {
      this.entryProgress = Math.min(1, this.entryProgress + frame / 0.75)
      const t = this.reducedMotion ? 1 : this.entryProgress * this.entryProgress * (3 - 2 * this.entryProgress)
      this.camera.position.copy(this.entryCamera).lerp(desired, t)
    } else this.camera.position.lerp(desired, this.reducedMotion ? 1 : 1 - Math.exp(-9 * frame))
    this.camera.up.copy(normal)
    this.camera.lookAt(target)
    if (this.firing && this.elapsed >= this.nextShot) this.fire()
  }

  private fire(): void {
    const fighter = this.selected
    if (!fighter) return
    const rocket = this.weapon === 'rocket'
    this.nextShot = this.elapsed + (rocket ? 1.1 : 0.14)
    fighter.muzzle.visible = true
    this.globe.updateMatrixWorld(true)
    const normal = this.playerAnchor.position.clone().normalize()
    const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)).applyQuaternion(this.playerAnchor.quaternion)
    const start = normal.clone().multiplyScalar(PLANET_RADIUS + 0.16).addScaledVector(forward, 0.17)
    let target: Fighter | null = null
    let best = rocket ? 1.9 : 1.25
    for (const enemy of this.fighters) {
      if (enemy.team === fighter.team || enemy === fighter || !enemy.zone.visible) continue
      const position = enemy.root.getWorldPosition(new THREE.Vector3())
      const to = position.sub(start)
      const range = to.length()
      if (range > best || to.normalize().dot(forward) < (rocket ? 0.78 : 0.91)) continue
      best = range
      target = enemy
    }
    const direction = target
      ? target.root.getWorldPosition(new THREE.Vector3()).sub(start).normalize()
      : forward.clone().addScaledVector(normal, 0.035).normalize()
    const mesh = new THREE.Mesh(
      rocket ? new THREE.ConeGeometry(0.025, 0.085, 6) : new THREE.BoxGeometry(0.009, 0.009, 0.07),
      new THREE.MeshBasicMaterial({ color: rocket ? 0xffa34c : fighter.team === 'blue' ? 0xa7ecff : 0xffb0a0, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    mesh.position.copy(start)
    mesh.quaternion.setFromUnitVectors(rocket ? UP : FORWARD, direction)
    this.scene.add(mesh)
    this.shots.push({ mesh, direction, speed: rocket ? 2.4 : 6.5, life: rocket ? 0.9 : 0.28, rocket, target })
  }

  private updateShots(frame: number): void {
    for (let index = this.shots.length - 1; index >= 0; index--) {
      const shot = this.shots[index]
      shot.life -= frame
      shot.mesh.position.addScaledVector(shot.direction, frame * shot.speed)
      const hit = shot.target && shot.mesh.position.distanceTo(shot.target.root.getWorldPosition(this.tempEnd)) < (shot.rocket ? 0.09 : 0.055)
      if (shot.life > 0 && !hit && shot.mesh.position.length() > PLANET_RADIUS - 0.02) continue
      if (hit && shot.target) shot.target.stunnedUntil = this.elapsed + (shot.rocket ? 1.4 : 0.24)
      if (shot.rocket || hit) this.addImpact(shot.mesh.position, shot.rocket)
      this.scene.remove(shot.mesh)
      shot.mesh.geometry.dispose()
      ;(shot.mesh.material as THREE.Material).dispose()
      this.shots.splice(index, 1)
    }
    for (let index = this.impacts.length - 1; index >= 0; index--) {
      const impact = this.impacts[index]
      impact.life -= frame
      if (impact.life <= 0) {
        this.scene.remove(impact.mesh)
        impact.mesh.geometry.dispose()
        impact.mesh.material.dispose()
        this.impacts.splice(index, 1)
      } else {
        impact.mesh.scale.setScalar((1 - impact.life / 0.34) * 2.6 + 0.1)
        impact.mesh.material.opacity = impact.life / 0.34 * 0.75
      }
    }
  }

  private addImpact(position: THREE.Vector3, rocket: boolean): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(rocket ? 0.12 : 0.035, 8, 6),
      new THREE.MeshBasicMaterial({ color: rocket ? 0xff8d3f : 0xffd28c, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    mesh.position.copy(position)
    this.scene.add(mesh)
    this.impacts.push({ mesh, life: 0.34 })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const shot of this.shots) { shot.mesh.geometry.dispose(); (shot.mesh.material as THREE.Material).dispose() }
    for (const impact of this.impacts) { impact.mesh.geometry.dispose(); impact.mesh.material.dispose() }
    this.shots.length = 0
    this.impacts.length = 0
    this.scene.clear()
    for (const geometry of this.geometries) geometry.dispose()
    for (const material of this.materials) material.dispose()
    this.geometries.clear()
    this.materials.clear()
    this.boxCache.clear()
    this.fighterMaterialCache.clear()
    this.fighters.length = 0
    this.tracers.length = 0
    this.smoke.length = 0
    this.blasts.length = 0
    this.shockwaves.length = 0
    this.embers.length = 0
    this.battleZones.length = 0
  }

  private addPlanet(globe: THREE.Group): void {
    const geometry = this.geometry(new THREE.IcosahedronGeometry(PLANET_RADIUS, 5))
    const positions = geometry.getAttribute('position')
    const colors: number[] = []
    const ash = new THREE.Color(0x182635)
    const rust = new THREE.Color(0x70433f)
    const ember = new THREE.Color(0xa34e30)
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index) / PLANET_RADIUS
      const y = positions.getY(index) / PLANET_RADIUS
      const z = positions.getZ(index) / PLANET_RADIUS
      const heat = Math.sin(x * 19 + Math.sin(z * 13) * 2) * Math.cos(y * 24 - z * 6)
      const fracture = Math.sin(x * 41 + y * 29) * Math.sin(z * 35 - x * 18)
      const color = ash.clone().lerp(rust, THREE.MathUtils.clamp(0.48 + heat * 0.35, 0, 1))
      if (fracture > 0.55) color.lerp(ember, (fracture - 0.55) * 0.5)
      colors.push(color.r, color.g, color.b)
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    globe.add(new THREE.Mesh(geometry, this.material(new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 0.94, metalness: 0.07,
    }))))
    globe.add(new THREE.Mesh(
      this.geometry(new THREE.SphereGeometry(PLANET_RADIUS * 1.037, 40, 28)),
      this.material(new THREE.MeshBasicMaterial({ color: 0xd4573d, side: THREE.BackSide, transparent: true, opacity: 0.12, depthWrite: false })),
    ))
  }

  private addSurfaceDetails(globe: THREE.Group): void {
    const rockGeometry = this.geometry(new THREE.DodecahedronGeometry(0.065, 0))
    const rockMaterial = this.material(new THREE.MeshStandardMaterial({ color: 0x303744, roughness: 1, flatShading: true }))
    const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, 620)
    const ruinGeometry = this.geometry(new THREE.BoxGeometry(0.045, 0.16, 0.055))
    const ruinMaterial = this.material(new THREE.MeshStandardMaterial({ color: 0x65717c, roughness: 0.9, metalness: 0.2, flatShading: true }))
    const ruins = new THREE.InstancedMesh(ruinGeometry, ruinMaterial, 220)
    const craterGeometry = this.geometry(new THREE.TorusGeometry(0.085, 0.012, 4, 9))
    const craterMaterial = this.material(new THREE.MeshBasicMaterial({ color: 0x101c27 }))
    const craters = new THREE.InstancedMesh(craterGeometry, craterMaterial, 180)
    const place = (mesh: THREE.InstancedMesh, count: number, seed: number, scale: number, lift: number): void => {
      for (let index = 0; index < count; index++) {
        const y = 1 - 2 * (index + 0.5) / count
        const angle = index * Math.PI * (3 - Math.sqrt(5)) + seed + hash(index + seed) * 0.25
        const radial = Math.sqrt(1 - y * y)
        const normal = new THREE.Vector3(Math.cos(angle) * radial, y, Math.sin(angle) * radial)
        this.dummy.position.copy(normal).multiplyScalar(PLANET_RADIUS + lift)
        this.dummy.quaternion.setFromUnitVectors(mesh === craters ? FORWARD : UP, normal)
        this.dummy.rotateY(hash(index * 19 + seed) * Math.PI * 2)
        const variation = 0.45 + hash(index * 7 + seed) * 1.35
        this.dummy.scale.set(scale * variation, scale * variation, scale * variation)
        this.dummy.updateMatrix()
        mesh.setMatrixAt(index, this.dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
      globe.add(mesh)
    }
    place(rocks, 620, 11, 1, 0.014)
    place(ruins, 220, 73, 1, 0.065)
    place(craters, 180, 137, 1, 0.027)
  }

  private addBattlefield(globe: THREE.Group, normal: THREE.Vector3, zoneIndex: number): void {
    const zone = new THREE.Group()
    zone.name = `Battle sector ${zoneIndex + 1}`
    zone.position.copy(normal).multiplyScalar(PLANET_RADIUS + 0.012)
    zone.quaternion.setFromUnitVectors(UP, normal)
    globe.add(zone)
    this.battleZones.push({ root: zone, normal })

    for (const [side, color] of [[-1, BLUE], [1, RED]] as const) {
      const signal = new THREE.Mesh(
        this.boxGeometry(0.018, 0.012, 0.48),
        this.material(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82 })),
      )
      signal.position.set(side * 0.42, surfaceY(side * 0.42, 0) + 0.016, 0)
      zone.add(signal)
    }

    const ruin = this.material(new THREE.MeshStandardMaterial({ color: 0x56616b, roughness: 0.78, metalness: 0.28, flatShading: true }))
    const scar = this.material(new THREE.MeshBasicMaterial({ color: 0xff7b39, transparent: true, opacity: 0.72 }))
    for (let index = 0; index < 13; index++) {
      const angle = index * Math.PI * 2 / 13 + zoneIndex * 0.31
      const distance = 0.38 + hash(index * 3 + zoneIndex * 13) * 0.27
      const height = 0.11 + hash(index * 19 + zoneIndex * 7) * 0.22
      const x = Math.cos(angle) * distance
      const z = Math.sin(angle) * distance
      const wall = new THREE.Mesh(this.boxGeometry(0.11 + (index % 3) * 0.035, height, 0.08), ruin)
      wall.position.set(x, surfaceY(x, z) + height / 2 + 0.012, z)
      wall.rotation.set((index % 2 ? 1 : -1) * 0.1, angle + 0.4, (index % 3 - 1) * 0.13)
      zone.add(wall)
      if (index % 2 === 0) {
        const crackX = Math.cos(angle) * (distance - 0.08)
        const crackZ = Math.sin(angle) * (distance - 0.08)
        const crack = new THREE.Mesh(this.boxGeometry(0.16, 0.006, 0.012), scar)
        crack.position.set(crackX, surfaceY(crackX, crackZ) + 0.012, crackZ)
        crack.rotation.y = angle
        zone.add(crack)
      }
    }

    for (const side of [-1, 1]) {
      const x = side * 0.54
      const z = side * 0.3
      const flame = new THREE.Mesh(
        this.geometry(new THREE.ConeGeometry(0.052, 0.16, 5)),
        this.material(new THREE.MeshBasicMaterial({ color: 0xff9e45, transparent: true, opacity: 0.82, depthWrite: false })),
      )
      flame.position.set(x, surfaceY(x, z) + 0.09, z)
      zone.add(flame)
      for (let index = 0; index < 2; index++) {
        const mesh = new THREE.Mesh(
          this.geometry(new THREE.SphereGeometry(0.075, 6, 4)),
          this.material(new THREE.MeshBasicMaterial({ color: 0x89939b, transparent: true, opacity: 0.2, depthWrite: false })),
        )
        zone.add(mesh)
        this.smoke.push({ mesh, baseX: x, baseZ: z, phase: (index + (side + 1) * 0.37) / 2 })
      }
    }

    const blue: Fighter[] = []
    const red: Fighter[] = []
    for (let index = 0; index < 4; index++) {
      blue.push(this.addFighter(zone, 'blue', index, zoneIndex))
      red.push(this.addFighter(zone, 'red', index, zoneIndex))
    }
    const blueBolt = this.material(new THREE.MeshBasicMaterial({ color: 0x7ae7ff, blending: THREE.AdditiveBlending, depthWrite: false }))
    const redBolt = this.material(new THREE.MeshBasicMaterial({ color: 0xffaa65, blending: THREE.AdditiveBlending, depthWrite: false }))
    const boltGeometry = this.geometry(new THREE.BoxGeometry(0.018, 0.018, 0.19))
    for (let index = 0; index < 7; index++) {
      const from = index % 2 ? red[index % red.length] : blue[index % blue.length]
      const to = index % 2 ? blue[(index + 2) % blue.length] : red[(index + 3) % red.length]
      const mesh = new THREE.Mesh(boltGeometry, from.team === 'blue' ? blueBolt : redBolt)
      mesh.visible = false
      zone.add(mesh)
      this.tracers.push({ mesh, from, to, phase: index * 0.31 + zoneIndex * 0.17 })
    }
    const blast = new THREE.Mesh(
      this.geometry(new THREE.SphereGeometry(0.13, 10, 8)),
      this.material(new THREE.MeshBasicMaterial({ color: 0xff9c51, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })),
    )
    const blastZ = (zoneIndex % 2 ? 1 : -1) * 0.17
    blast.position.set(0.04, surfaceY(0.04, blastZ) + 0.1, blastZ)
    zone.add(blast)
    const phase = hash(zoneIndex * 37) * 0.95
    this.blasts.push({ mesh: blast, phase })
    const wave = new THREE.Mesh(
      this.geometry(new THREE.TorusGeometry(0.09, 0.008, 4, 20)),
      this.material(new THREE.MeshBasicMaterial({ color: 0xffac65, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })),
    )
    wave.rotation.x = -Math.PI / 2
    wave.position.set(0.04, surfaceY(0.04, blastZ) + 0.018, blastZ)
    zone.add(wave)
    this.shockwaves.push({ mesh: wave, phase })
    const emberGeometry = this.geometry(new THREE.TetrahedronGeometry(0.008))
    const emberMaterial = this.material(new THREE.MeshBasicMaterial({ color: 0xffaa58, blending: THREE.AdditiveBlending, depthWrite: false }))
    const emberMesh = new THREE.InstancedMesh(emberGeometry, emberMaterial, 14)
    emberMesh.frustumCulled = false
    zone.add(emberMesh)
    const positions: THREE.Vector3[] = []
    const phases: number[] = []
    for (let index = 0; index < 14; index++) {
      const x = (hash(index * 17 + zoneIndex * 3) - 0.5) * 0.95
      const z = (hash(index * 23 + zoneIndex * 11) - 0.5) * 0.95
      positions.push(new THREE.Vector3(x, surfaceY(x, z) + 0.04, z))
      phases.push(hash(index * 29 + zoneIndex * 13))
    }
    this.embers.push({ mesh: emberMesh, positions, phases, zone })
  }

  private addFighter(zone: THREE.Group, team: Team, index: number, zoneIndex: number): Fighter {
    const color = team === 'blue' ? BLUE : RED
    const armor = this.fighterMaterial(`armor-${team}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.68, metalness: 0.26, flatShading: true }))
    const face = this.fighterMaterial('face', () => new THREE.MeshStandardMaterial({ color: 0xe8c8a0, roughness: 0.96, flatShading: true }))
    const dark = this.fighterMaterial('dark', () => new THREE.MeshStandardMaterial({ color: 0x202b39, roughness: 0.72, metalness: 0.24 }))
    const glint = this.fighterMaterial(`glint-${team}`, () => new THREE.MeshBasicMaterial({ color: team === 'blue' ? 0xb8f3ff : 0xffc1a3 }))
    const root = new THREE.Group()
    root.name = `${team} block soldier`
    root.scale.setScalar(0.43)
    zone.add(root)

    const box = (width: number, height: number, depth: number, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Group = root): THREE.Mesh => {
      const mesh = new THREE.Mesh(this.boxGeometry(width, height, depth), material)
      mesh.position.set(x, y, z)
      parent.add(mesh)
      return mesh
    }
    box(0.23, 0.22, 0.13, armor, 0, 0.27, 0)
    box(0.17, 0.15, 0.14, face, 0, 0.47, 0.008)
    box(0.22, 0.07, 0.19, armor, 0, 0.56, 0)
    box(0.17, 0.044, 0.019, glint, 0, 0.49, 0.084)
    box(0.15, 0.14, 0.07, dark, 0, 0.29, -0.11)
    const leftArm = new THREE.Group()
    const rightArm = new THREE.Group()
    const leftLeg = new THREE.Group()
    const rightLeg = new THREE.Group()
    leftArm.position.set(-0.15, 0.35, 0)
    rightArm.position.set(0.15, 0.35, 0)
    leftLeg.position.set(-0.064, 0.16, 0)
    rightLeg.position.set(0.064, 0.16, 0)
    root.add(leftArm, rightArm, leftLeg, rightLeg)
    box(0.065, 0.18, 0.075, armor, 0, -0.09, 0, leftArm)
    box(0.065, 0.18, 0.075, armor, 0, -0.09, 0, rightArm)
    box(0.072, 0.17, 0.078, dark, 0, -0.08, 0, leftLeg)
    box(0.072, 0.17, 0.078, dark, 0, -0.08, 0, rightLeg)
    box(0.058, 0.048, 0.31, dark, 0.04, 0.28, 0.18)
    box(0.09, 0.066, 0.12, dark, 0.04, 0.28, 0.04)
    const muzzle = box(0.105, 0.105, 0.04, glint, 0.04, 0.28, 0.355)
    muzzle.visible = false

    const phase = index * 0.88 + zoneIndex * 1.3 + (team === 'red' ? 2.2 : 0)
    const baseX = (team === 'blue' ? -0.24 : 0.24) + (hash(index * 11 + zoneIndex * 9) - 0.5) * 0.14
    const baseZ = -0.28 + index * 0.18 + (hash(index * 23 + zoneIndex * 3) - 0.5) * 0.08
    const fighter: Fighter = { root, zone, leftArm, rightArm, leftLeg, rightLeg, muzzle, team, baseX, baseZ, phase, x: baseX, z: baseZ, stunnedUntil: 0 }
    this.fighters.push(fighter)
    return fighter
  }

  private addStars(): void {
    const positions: number[] = []
    for (let index = 0; index < 280; index++) {
      const y = 1 - (index / 279) * 2
      const a = index * 2.399963 + hash(index + 40) * 0.4
      const radius = Math.sqrt(1 - y * y)
      positions.push(Math.cos(a) * radius * 42, y * 42, Math.sin(a) * radius * 42)
    }
    const geometry = this.geometry(new THREE.BufferGeometry())
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    this.scene.add(new THREE.Points(geometry, this.material(new THREE.PointsMaterial({ color: 0xb8d7ec, size: 0.038, sizeAttenuation: true }))))
  }

  private geometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.add(geometry)
    return geometry
  }

  private boxGeometry(width: number, height: number, depth: number): THREE.BoxGeometry {
    const key = `${width}/${height}/${depth}`
    let geometry = this.boxCache.get(key)
    if (!geometry) {
      geometry = this.geometry(new THREE.BoxGeometry(width, height, depth))
      this.boxCache.set(key, geometry)
    }
    return geometry
  }

  private fighterMaterial(key: string, create: () => THREE.Material): THREE.Material {
    let material = this.fighterMaterialCache.get(key)
    if (!material) {
      material = this.material(create())
      this.fighterMaterialCache.set(key, material)
    }
    return material
  }

  private material<T extends THREE.Material>(material: T): T {
    this.materials.add(material)
    return material
  }
}

function surfaceY(x: number, z: number): number {
  return Math.sqrt(Math.max(0, PLANET_RADIUS * PLANET_RADIUS - x * x - z * z)) - PLANET_RADIUS
}

function hash(value: number): number {
  const fraction = Math.sin(value * 127.13) * 43758.5453
  return fraction - Math.floor(fraction)
}
