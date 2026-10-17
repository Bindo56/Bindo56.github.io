import * as THREE from 'three'
import type { WarfrontAudio } from './WarfrontAudio.ts'

const PLANET_RADIUS = 3.35
const GROUND_SCALE = 5
const GROUND_RADIUS = PLANET_RADIUS * GROUND_SCALE
const SOLDIER_GROUND_CLEARANCE = 0.003
const PLAYER_ANCHOR_CLEARANCE = 0.0005
const UP = new THREE.Vector3(0, 1, 0)
const FORWARD = new THREE.Vector3(0, 0, 1)
const BLUE = 0x4ebaff
const RED = 0xff6658
const SOLDIER_HEALTH = 3
const PLAYER_HEALTH = 6

export type Team = 'blue' | 'red'
export type Weapon = 'rifle' | 'scattergun' | 'rocket'
type Formation = 'front' | Team

interface Fighter {
  root: THREE.Group
  zone: THREE.Group
  leftArm: THREE.Group
  rightArm: THREE.Group
  leftLeg: THREE.Group
  rightLeg: THREE.Group
  muzzle: THREE.Mesh
  muzzleUntil: number
  weaponKick: number
  weapon: Weapon
  assignedWeapon: Weapon
  weaponModels: Partial<Record<Weapon, { root: THREE.Group; muzzle: THREE.Mesh }>>
  team: Team
  baseX: number
  baseZ: number
  formation: Formation
  rank: number
  zoneIndex: number
  phase: number
  x: number
  z: number
  stunnedUntil: number
  health: number
  deathAt: number
  respawnAt: number
  reinforcement: number
  deathPosition: THREE.Vector3
  deathNormal: THREE.Vector3
}

interface Shot {
  mesh: THREE.Mesh
  trail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  trailPoints: THREE.Vector3[]
  velocity: THREE.Vector3
  life: number
  weapon: Weapon
  team: Team
}

interface Impact {
  group: THREE.Group
  flash: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>
  life: number
  duration: number
}

interface BattleZone {
  root: THREE.Group
  normal: THREE.Vector3
  groundDetail: THREE.Group
}

interface BuildingObstacle {
  normal: THREE.Vector3
  center: THREE.Vector3
  radius: number
  detail: THREE.Group
  group: THREE.Group
  height: number
}

interface GroundAsset {
  object: THREE.Object3D
  zone: THREE.Group
  x: number
  z: number
  clearance: number
  rotation: THREE.Quaternion
}

interface Tracer {
  mesh: THREE.Mesh
  from: Fighter
  targets: Fighter[]
  velocity: THREE.Vector3
  nextFire: number
  life: number
  active: boolean
  weapon: Weapon
}

interface Smoke {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  baseX: number
  baseZ: number
  phase: number
}

interface HealthBar {
  group: THREE.Group
  fill: THREE.Mesh
}

/** A globe-scale spectator diorama. Every battle stays on the planet surface. */
export class WarfrontVisual {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 90)

  private readonly geometries = new Set<THREE.BufferGeometry>()
  private readonly materials = new Set<THREE.Material>()
  private readonly boxCache = new Map<string, THREE.BoxGeometry>()
  private readonly cylinderCache = new Map<string, THREE.CylinderGeometry>()
  private readonly projectileCache = new Map<Weapon, THREE.BufferGeometry>()
  private readonly fighterMaterialCache = new Map<string, THREE.Material>()
  private readonly fighters: Fighter[] = []
  private readonly frontlineFighters: Fighter[] = []
  private readonly kills: Record<Team, number> = { blue: 0, red: 0 }
  private readonly shots: Shot[] = []
  private readonly impacts: Impact[] = []
  private readonly battleZones: BattleZone[] = []
  private readonly buildingObstacles: BuildingObstacle[] = []
  private readonly groundAssets: GroundAsset[] = []
  private readonly tracers: Tracer[] = []
  private readonly pursuers = new Set<Fighter>()
  private readonly smoke: Smoke[] = []
  private readonly blasts: { mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; phase: number }[] = []
  private readonly shockwaves: { mesh: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>; phase: number }[] = []
  private readonly embers: { mesh: THREE.InstancedMesh; positions: THREE.Vector3[]; phases: number[]; zone: THREE.Group }[] = []
  private readonly banners: { flag: THREE.Mesh; phase: number }[] = []
  private readonly playerBar: HealthBar
  private readonly enemyBar: HealthBar
  private readonly dummy = new THREE.Object3D()
  private readonly globe = new THREE.Group()
  private atmosphere: THREE.Mesh | null = null
  private readonly playerAnchor = new THREE.Group()
  private audio: WarfrontAudio | null = null
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
  private focusedEnemy: Fighter | null = null
  private focusedEnemyUntil = 0
  private playerInvulnerableUntil = 0
  private weapon: Weapon = 'scattergun'
  private readonly playerForward = new THREE.Vector3(0, 0, 1)
  private recoil = 0
  private cameraShake = 0
  private pitch = -0.02
  private moveForward = 0
  private moveStrafe = 0
  private turnSpeed = 0
  private firing = false
  private nextShot = 0
  private hopTime = 0
  private footstepTimer = 0
  private nextLowHealthCue = 0
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
    this.playerBar = this.createHealthBar(BLUE)
    this.enemyBar = this.createHealthBar(RED)

    this.addStars()
    this.globe.name = 'Warfront planet'
    this.scene.add(this.globe)
    this.addPlanet(this.globe)
    this.globe.add(this.playerAnchor)

    this.addSurfaceDetails(this.globe)
    // The x=0 great circle is the front. Blue and Red hold opposite hemispheres.
    for (let index = 0; index < 12; index++) {
      const angle = index * Math.PI * 2 / 12
      this.addBattlefield(this.globe, new THREE.Vector3(0, Math.cos(angle), Math.sin(angle)), index, 'front')
    }
    for (let index = 0; index < 8; index++) {
      const angle = index * Math.PI * 2 / 8 + Math.PI / 8
      const y = Math.cos(angle) * 0.76
      const z = Math.sin(angle) * 0.76
      this.addBattlefield(this.globe, new THREE.Vector3(-0.65, y, z), 12 + index, 'blue')
      this.addBattlefield(this.globe, new THREE.Vector3(0.65, y, z), 20 + index, 'red')
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
  get enemyTeam(): Team | null { return this.selected?.team === 'blue' ? 'red' : this.selected?.team === 'red' ? 'blue' : null }
  get enemyKills(): number { return this.enemyTeam ? this.kills[this.enemyTeam] : 0 }
  get playerHealth(): number { return this.selected?.health ?? 0 }
  get playerMaxHealth(): number { return PLAYER_HEALTH }
  get currentWeapon(): Weapon { return this.weapon }

  setAudio(audio: WarfrontAudio): void { this.audio = audio }

  enterRandomSoldier(): Team {
    if (this.selected) return this.selected.team
    const available = this.frontlineFighters.filter(fighter => fighter.health > 0)
    const pool = available.length > 0 ? available : this.frontlineFighters
    const fighter = pool[Math.floor(Math.random() * pool.length)]
    fighter.health = PLAYER_HEALTH
    fighter.root.visible = true
    this.selected = fighter
    this.audio?.activate()
    this.audio?.playEnter()
    this.focusedEnemy = null
    this.playerInvulnerableUntil = this.elapsed + 0.65
    const heading = fighter.team === 'blue' ? Math.PI / 2 : -Math.PI / 2
    this.pitch = -0.02
    this.weapon = 'scattergun'
    this.setFighterWeapon(fighter, this.weapon)
    this.nextShot = 0
    this.firing = false
    this.hopTime = 0
    this.entryProgress = 0
    this.resetArmyFire()
    const start = fighter.zone.localToWorld(new THREE.Vector3(fighter.x, surfaceY(fighter.x, fighter.z), fighter.z))
    const normal = start.normalize()
    this.playerAnchor.position.copy(normal).multiplyScalar(PLANET_RADIUS + PLAYER_ANCHOR_CLEARANCE)
    this.playerForward.set(Math.sin(heading), 0, Math.cos(heading)).applyQuaternion(fighter.zone.getWorldQuaternion(new THREE.Quaternion()))
    this.orientPlayer()
    this.globe.scale.setScalar(GROUND_SCALE)
    for (const zone of this.battleZones) {
      zone.root.scale.setScalar(1 / GROUND_SCALE)
      this.adjustZoneSurface(zone, GROUND_RADIUS)
    }
    if (this.atmosphere) this.atmosphere.visible = false
    this.playerAnchor.scale.setScalar(1 / GROUND_SCALE)
    this.playerAnchor.add(fighter.root)
    fighter.root.position.set(0, SOLDIER_GROUND_CLEARANCE, 0)
    fighter.root.rotation.y = 0
    this.refreshGroundObstacles()
    this.entryCamera.copy(normal).multiplyScalar(GROUND_RADIUS + 5).addScaledVector(this.playerForward, -2)
    this.camera.position.copy(this.entryCamera)
    this.camera.fov = 61
    this.camera.near = 0.015
    this.camera.updateProjectionMatrix()
    return fighter.team
  }

  leaveSoldier(): void {
    const fighter = this.selected
    if (!fighter) return
    this.audio?.playExit()
    this.selected = null
    this.focusedEnemy = null
    fighter.health = Math.min(fighter.health, SOLDIER_HEALTH)
    this.pursuers.clear()
    this.firing = false
    this.resetArmyFire()
    this.clearShots()
    for (const impact of this.impacts) this.disposeImpact(impact)
    this.impacts.length = 0
    this.recoil = 0
    this.cameraShake = 0
    fighter.root.rotation.x = 0
    fighter.weaponKick = 0
    this.setFighterWeapon(fighter, fighter.assignedWeapon)
    this.moveForward = this.moveStrafe = this.turnSpeed = 0
    for (const zone of this.battleZones) zone.groundDetail.visible = false
    fighter.zone.add(fighter.root)
    for (const casualty of this.fighters) {
      if (casualty.root.parent !== this.scene) continue
      casualty.zone.add(casualty.root)
      casualty.root.position.set(casualty.x, surfaceY(casualty.x, casualty.z) + SOLDIER_GROUND_CLEARANCE, casualty.z)
      casualty.root.visible = false
    }
    this.globe.scale.setScalar(1)
    for (const zone of this.battleZones) {
      zone.root.scale.setScalar(1)
      this.adjustZoneSurface(zone, PLANET_RADIUS)
    }
    if (this.atmosphere) this.atmosphere.visible = true
    this.playerAnchor.scale.setScalar(1)
    fighter.root.position.set(fighter.x, surfaceY(fighter.x, fighter.z) + SOLDIER_GROUND_CLEARANCE, fighter.z)
    this.refreshGroundObstacles()
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

  aim(deltaX: number, deltaY: number): void {
    if (!this.selected) return
    this.playerForward.applyAxisAngle(this.playerAnchor.position.clone().normalize(), deltaX * 0.0035)
    this.orientPlayer()
    this.pitch = THREE.MathUtils.clamp(this.pitch - deltaY * 0.0028, -0.55, 0.45)
  }

  private orientPlayer(): void {
    const normal = this.playerAnchor.position.clone().normalize()
    this.playerForward.addScaledVector(normal, -this.playerForward.dot(normal)).normalize()
    const basisX = normal.clone().cross(this.playerForward).normalize()
    const basis = new THREE.Matrix4().makeBasis(basisX, normal, this.playerForward)
    this.playerAnchor.quaternion.setFromRotationMatrix(basis)
  }

  private refreshGroundObstacles(): void {
    this.globe.updateMatrixWorld(true)
    for (const building of this.buildingObstacles) {
      building.normal.copy(building.group.getWorldPosition(this.tempStart)).normalize()
      building.center.copy(building.group.localToWorld(new THREE.Vector3(0, building.height * 0.48, 0)))
    }
  }
  private groundAsset(zone: THREE.Group, object: THREE.Object3D, clearance: number): void {
    const asset: GroundAsset = {
      object, zone, x: object.position.x, z: object.position.z, clearance, rotation: object.quaternion.clone(),
    }
    this.groundAssets.push(asset)
    this.placeGroundAsset(asset, PLANET_RADIUS)
  }

  private placeGroundAsset(asset: GroundAsset, radius: number): void {
    asset.object.position.set(asset.x, surfaceY(asset.x, asset.z, radius) + asset.clearance, asset.z)
    asset.object.quaternion.setFromUnitVectors(UP, surfaceNormal(asset.x, asset.z, radius)).multiply(asset.rotation)
  }

  private adjustZoneSurface(zone: BattleZone, radius: number): void {
    for (const asset of this.groundAssets) if (asset.zone === zone.root) this.placeGroundAsset(asset, radius)
  }
  jump(): void {
    if (!this.selected || this.hopTime > 0) return
    this.hopTime = 0.52
    this.audio?.playJump()
  }
  equip(weapon: Weapon): void {
    if (weapon !== this.weapon && this.selected) this.audio?.playEquip()
    this.weapon = weapon
    if (this.selected) this.setFighterWeapon(this.selected, weapon)
  }
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

    this.updatePursuers()
    for (const fighter of this.fighters) {
      if (fighter === this.selected) continue
      let respawned = false
      if (fighter.health <= 0) {
        if (this.elapsed < fighter.deathAt + 0.5) {
          const fall = THREE.MathUtils.clamp((this.elapsed - fighter.deathAt) / 0.5, 0, 1)
          fighter.root.visible = true
          fighter.root.rotation.z = (fighter.team === 'blue' ? -1 : 1) * fall * 1.25
          if (fighter.root.parent === this.scene) fighter.root.position.copy(fighter.deathPosition)
          else fighter.root.position.set(fighter.x, surfaceY(fighter.x, fighter.z, this.selected ? GROUND_RADIUS : PLANET_RADIUS) + SOLDIER_GROUND_CLEARANCE, fighter.z)
          continue
        }
        fighter.root.visible = false
        if (this.elapsed < fighter.respawnAt) continue
        if (fighter.root.parent === this.scene) fighter.zone.add(fighter.root)
        fighter.health = SOLDIER_HEALTH
        fighter.reinforcement = 0
        this.setFighterWeapon(fighter, fighter.assignedWeapon)
        fighter.root.rotation.set(0, 0, 0)
        fighter.root.visible = true
        respawned = true
      }
      const stride = this.elapsed * 2.9 + fighter.phase
      const side = fighter.team === 'blue' ? -1 : 1
      const advance = Math.max(0, Math.sin(this.elapsed * 0.85 + fighter.zoneIndex * 0.52 + fighter.rank * 0.25))
      fighter.reinforcement = Math.min(1, fighter.reinforcement + frame / 2.25)
      const rearX = side * (fighter.formation === 'front' ? 1.06 : 0.85)
      const formationX = THREE.MathUtils.lerp(rearX, fighter.baseX, fighter.reinforcement)
        - side * advance * (fighter.formation === 'front' ? 0.1 : 0.025) * fighter.reinforcement
        + Math.sin(this.elapsed * 1.1 + fighter.phase) * 0.012
      const formationZ = fighter.baseZ + Math.cos(this.elapsed * 0.7 + fighter.phase) * 0.018
      const chasing = this.pursuers.has(fighter) && fighter.reinforcement >= 1 && this.selected !== null
      let heading: number
      if (chasing) {
        const playerLocal = fighter.zone.worldToLocal(this.playerAnchor.getWorldPosition(new THREE.Vector3()))
        const dx = playerLocal.x - fighter.x
        const dz = playerLocal.z - fighter.z
        const distance = Math.hypot(dx, dz)
        if (distance > 0.68) {
          const step = Math.min(distance - 0.68, frame * (fighter.weapon === 'rocket' ? 1.05 : 1.35))
          fighter.x += dx / distance * step
          fighter.z += dz / distance * step
        }
        heading = Math.atan2(dx, dz)
      } else {
        const step = Math.min(1, frame * 2.2)
        fighter.x = THREE.MathUtils.lerp(fighter.x, formationX, step)
        fighter.z = THREE.MathUtils.lerp(fighter.z, formationZ, step)
        heading = (fighter.team === 'blue' ? Math.PI / 2 : -Math.PI / 2) + Math.sin(this.elapsed * 0.8 + fighter.phase) * 0.075
      }
      const radius = this.selected ? GROUND_RADIUS : PLANET_RADIUS
      fighter.root.position.set(fighter.x, surfaceY(fighter.x, fighter.z, radius) + SOLDIER_GROUND_CLEARANCE, fighter.z)
      fighter.root.rotation.set(0, heading, this.elapsed < fighter.stunnedUntil ? 0.5 : 0)
      fighter.root.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(UP, surfaceNormal(fighter.x, fighter.z, radius)))
      if (respawned && this.selected) {
        const sound = this.soundPlacement(fighter.root.getWorldPosition(new THREE.Vector3()))
        this.audio?.playReinforcement(sound.distance, sound.pan)
      }
      fighter.leftLeg.rotation.x = Math.sin(stride) * 0.29
      fighter.rightLeg.rotation.x = -Math.sin(stride) * 0.29
      fighter.weaponKick *= Math.exp(-14 * frame)
      fighter.leftArm.rotation.x = -Math.sin(stride) * 0.09 - fighter.weaponKick * 0.22
      fighter.rightArm.rotation.x = Math.sin(stride) * 0.09 - fighter.weaponKick * 0.6
      fighter.weaponModels[fighter.weapon]?.root.position.set(0.04, 0.29, 0.13 - fighter.weaponKick * 0.065)
      fighter.muzzle.visible = this.elapsed < fighter.muzzleUntil
    }

    this.updateArmyFire(frame)

    for (const smoke of this.smoke) {
      const rise = (this.elapsed * 0.19 + smoke.phase) % 1
      smoke.mesh.position.set(smoke.baseX + Math.sin(this.elapsed * 0.7 + smoke.phase) * 0.035, surfaceY(smoke.baseX, smoke.baseZ, this.selected ? GROUND_RADIUS : PLANET_RADIUS) + 0.17 + rise * 0.54, smoke.baseZ)
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
        const groundOffset = this.selected ? surfaceY(origin.x, origin.z, GROUND_RADIUS) - surfaceY(origin.x, origin.z) : 0
        this.dummy.position.set(origin.x + Math.sin(this.elapsed * 1.2 + index) * 0.035, origin.y + groundOffset + drift * 0.38, origin.z)
        this.dummy.scale.setScalar((1 - drift) * 0.7 + 0.18)
        this.dummy.updateMatrix()
        field.mesh.setMatrixAt(index, this.dummy.matrix)
      }
      field.mesh.instanceMatrix.needsUpdate = true
    }
    for (const banner of this.banners) banner.flag.rotation.y = Math.sin(this.elapsed * 2.1 + banner.phase) * 0.18
    this.updateShots(frame)
    this.updateHealthBars()
    if (this.selected && this.selected.health <= 2 && this.elapsed >= this.nextLowHealthCue) {
      this.audio?.playLowHealth()
      this.nextLowHealthCue = this.elapsed + 1.3
    }
    const view = this.camera.position.clone().normalize()
    const playerNormal = this.selected ? this.playerAnchor.position.clone().normalize() : null
    for (const zone of this.battleZones) {
      zone.root.visible = zone.normal.dot(view) > (this.selected ? 0.55 : -0.05)
      zone.groundDetail.visible = playerNormal !== null && zone.normal.dot(playerNormal) > 0.8
    }
  }

  private updatePursuers(): void {
    const player = this.selected
    if (!player) { this.pursuers.clear(); return }
    const position = this.playerAnchor.getWorldPosition(new THREE.Vector3())
    for (const fighter of this.pursuers) {
      if (fighter.team === player.team || fighter.health <= 0
        || fighter.root.getWorldPosition(new THREE.Vector3()).distanceToSquared(position) > 13 * 13) this.pursuers.delete(fighter)
    }
    const nearby = this.frontlineFighters
      .filter(fighter => fighter.team !== player.team && fighter.health > 0)
      .map(fighter => ({ fighter, distance: fighter.root.getWorldPosition(new THREE.Vector3()).distanceToSquared(position) }))
      .filter(entry => entry.distance < 9 * 9)
      .sort((a, b) => a.distance - b.distance)
    for (const entry of nearby) {
      if (this.pursuers.size >= 8) break
      this.pursuers.add(entry.fighter)
    }
  }

  private soundPlacement(position: THREE.Vector3): { distance: number; pan: number } {
    const toward = position.clone().sub(this.camera.position)
    const distance = toward.length()
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion)
    return { distance, pan: distance > 0.001 ? right.dot(toward.multiplyScalar(1 / distance)) : 0 }
  }

  private createHealthBar(color: number): HealthBar {
    const group = new THREE.Group()
    group.visible = false
    const panel = new THREE.Mesh(
      this.geometry(new THREE.PlaneGeometry(0.46, 0.075)),
      this.material(new THREE.MeshBasicMaterial({ color: 0x09111d, depthTest: false, depthWrite: false })),
    )
    const track = new THREE.Mesh(
      this.geometry(new THREE.PlaneGeometry(0.42, 0.043)),
      this.material(new THREE.MeshBasicMaterial({ color: 0x33404c, depthTest: false, depthWrite: false })),
    )
    track.position.z = 0.001
    const fill = new THREE.Mesh(
      this.geometry(new THREE.PlaneGeometry(0.4, 0.031)),
      this.material(new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false })),
    )
    fill.position.z = 0.002
    group.add(panel, track, fill)
    group.renderOrder = 20
    this.scene.add(group)
    return { group, fill }
  }

  private placeHealthBar(bar: HealthBar, fighter: Fighter, maxHealth: number): void {
    const position = fighter.root.getWorldPosition(new THREE.Vector3())
    position.addScaledVector(position.clone().normalize(), 0.37)
    bar.group.position.copy(position)
    bar.group.quaternion.copy(this.camera.quaternion)
    bar.group.scale.setScalar(THREE.MathUtils.clamp(position.distanceTo(this.camera.position) * 0.34, 0.42, 1.3))
    const fraction = THREE.MathUtils.clamp(fighter.health / maxHealth, 0, 1)
    bar.fill.scale.x = fraction
    bar.fill.position.x = (fraction - 1) * 0.2
    bar.group.visible = true
  }

  private updateHealthBars(): void {
    const player = this.selected
    this.playerBar.group.visible = player !== null
    this.enemyBar.group.visible = false
    if (!player) return
    ;(this.playerBar.fill.material as THREE.MeshBasicMaterial).color.setHex(player.team === 'blue' ? BLUE : RED)
    this.placeHealthBar(this.playerBar, player, PLAYER_HEALTH)
    const enemy = this.focusedEnemy
    if (!enemy || enemy.team === player.team || this.elapsed > this.focusedEnemyUntil
      || (enemy.health <= 0 && this.elapsed > enemy.deathAt + 0.5)) return
    ;(this.enemyBar.fill.material as THREE.MeshBasicMaterial).color.setHex(enemy.team === 'blue' ? BLUE : RED)
    this.placeHealthBar(this.enemyBar, enemy, SOLDIER_HEALTH)
  }

  private focusEnemy(enemy: Fighter): void {
    this.focusedEnemy = enemy
    this.focusedEnemyUntil = this.elapsed + 2
  }

  private focusEnemyOnShot(start: THREE.Vector3, direction: THREE.Vector3, team: Team): void {
    let aimed: Fighter | null = null
    let best = Infinity
    for (const enemy of this.fighters) {
      if (enemy.team === team || enemy.health <= 0) continue
      const position = enemy.root.getWorldPosition(new THREE.Vector3())
      position.addScaledVector(position.clone().normalize(), 0.16)
      const toward = position.sub(start)
      const along = toward.dot(direction)
      if (along <= 0 || along > 9) continue
      const miss = toward.lengthSq() - along * along
      if (miss > 0.38 * 0.38) continue
      const score = miss + along * 0.003
      if (score < best) { best = score; aimed = enemy }
    }
    if (aimed) this.focusEnemy(aimed)
    else this.focusedEnemy = null
  }

  private updatePlayer(frame: number): void {
    const fighter = this.selected
    if (!fighter) return
    const oldNormal = this.playerAnchor.position.clone().normalize()
    if (this.turnSpeed !== 0) {
      this.playerForward.applyAxisAngle(oldNormal, this.turnSpeed * frame * 2.3)
      this.orientPlayer()
    }
    const right = oldNormal.clone().cross(this.playerForward).normalize()
    const movement = this.playerForward.clone().multiplyScalar(this.moveForward).addScaledVector(right, this.moveStrafe)
    if (movement.lengthSq() > 1) movement.normalize()
    if (movement.lengthSq() > 0) {
      const distance = movement.length() * frame * 0.95
      const arc = distance / GROUND_RADIUS
      let nextNormal = oldNormal.clone().multiplyScalar(Math.cos(arc)).addScaledVector(movement.normalize(), Math.sin(arc)).normalize()
      for (const building of this.buildingObstacles) {
        if (!building.detail.visible) continue
        const footNormal = building.normal
        const minArc = 0.26 / GROUND_RADIUS
        const dot = THREE.MathUtils.clamp(nextNormal.dot(footNormal), -1, 1)
        if (Math.acos(dot) >= minArc) continue
        const away = nextNormal.clone().addScaledVector(footNormal, -dot)
        if (away.lengthSq() < 0.000001) away.copy(right).addScaledVector(footNormal, -right.dot(footNormal))
        nextNormal = footNormal.clone().multiplyScalar(Math.cos(minArc)).addScaledVector(away.normalize(), Math.sin(minArc)).normalize()
      }
      const transport = new THREE.Quaternion().setFromUnitVectors(oldNormal, nextNormal)
      this.playerForward.applyQuaternion(transport)
      this.playerAnchor.position.copy(nextNormal).multiplyScalar(PLANET_RADIUS + PLAYER_ANCHOR_CLEARANCE)
      this.orientPlayer()
    }
    const wasHopping = this.hopTime > 0
    if (wasHopping) {
      this.hopTime = Math.max(0, this.hopTime - frame)
      if (this.hopTime === 0) this.audio?.playLand()
    }
    if (movement.lengthSq() > 0 && this.hopTime === 0) {
      this.footstepTimer -= frame
      if (this.footstepTimer <= 0) {
        this.audio?.playFootstep()
        this.footstepTimer = 0.36
      }
    } else this.footstepTimer = 0.1
    const hop = this.hopTime > 0 ? Math.sin((1 - this.hopTime / 0.52) * Math.PI) * 0.11 : 0
    fighter.root.position.set(0, SOLDIER_GROUND_CLEARANCE + hop, 0)
    fighter.root.rotation.y = 0
    const stride = this.elapsed * 12
    const walk = movement.lengthSq() > 0 ? 0.38 : 0.045
    fighter.leftLeg.rotation.x = Math.sin(stride) * walk
    fighter.rightLeg.rotation.x = -Math.sin(stride) * walk
    fighter.weaponKick *= Math.exp(-14 * frame)
    fighter.leftArm.rotation.x = -Math.sin(stride) * walk * 0.4 - fighter.weaponKick * 0.22
    fighter.rightArm.rotation.x = Math.sin(stride) * walk * 0.4 - fighter.weaponKick * 0.6
    fighter.weaponModels[fighter.weapon]?.root.position.set(0.04, 0.29, 0.13 - fighter.weaponKick * 0.065)
    fighter.muzzle.visible = this.elapsed < fighter.muzzleUntil

    this.globe.updateMatrixWorld(true)
    const normal = this.playerAnchor.position.clone().normalize()
    const worldForward = this.playerForward
    const aimDirection = worldForward.clone().addScaledVector(normal, this.pitch + this.recoil * 0.07).normalize()
    const desired = normal.clone().multiplyScalar(GROUND_RADIUS + 0.48).addScaledVector(worldForward, -0.72 - this.recoil * 0.09)
    desired.addScaledVector(normal.clone().cross(worldForward).normalize(), 0.14)
    if (this.buildingObstacles.some(building => building.detail.visible && desired.distanceToSquared(building.center) < 0.48 * 0.48)) {
      desired.addScaledVector(normal, 0.65)
    }
    if (this.cameraShake > 0) desired.addScaledVector(normal.clone().cross(worldForward).normalize(), (Math.random() - 0.5) * this.cameraShake * 0.12)
    if (this.entryProgress < 1) {
      this.entryProgress = Math.min(1, this.entryProgress + frame / 0.75)
      const t = this.reducedMotion ? 1 : this.entryProgress * this.entryProgress * (3 - 2 * this.entryProgress)
      this.camera.position.copy(this.entryCamera).lerp(desired, t)
    } else this.camera.position.lerp(desired, this.reducedMotion ? 1 : 1 - Math.exp(-9 * frame))
    this.camera.up.copy(normal)
    this.camera.lookAt(this.camera.position.clone().add(aimDirection))
    fighter.root.rotation.x = -this.recoil * 0.12
    this.recoil *= Math.exp(-12 * frame)
    this.cameraShake *= Math.exp(-17 * frame)
    if (this.firing && this.elapsed >= this.nextShot) this.fire()
  }

  private fire(): void {
    const fighter = this.selected
    if (!fighter) return
    const weapon = this.weapon
    this.audio?.playWeapon(weapon, 0, 0, true)
    this.nextShot = this.elapsed + (weapon === 'rocket' ? 1.1 : weapon === 'scattergun' ? 0.68 : 0.14)
    this.recoil = Math.min(1.4, this.recoil + (weapon === 'rocket' ? 1 : weapon === 'scattergun' ? 0.65 : 0.16))
    this.cameraShake = Math.max(this.cameraShake, weapon === 'rocket' ? 0.65 : weapon === 'scattergun' ? 0.3 : 0.1)
    if (typeof navigator.vibrate === 'function') navigator.vibrate(weapon === 'rocket' ? [35, 18, 55] : weapon === 'scattergun' ? [24, 12, 20] : 10)
    fighter.muzzleUntil = this.elapsed + (weapon === 'rocket' ? 0.18 : weapon === 'scattergun' ? 0.13 : 0.07)
    fighter.weaponKick = Math.max(fighter.weaponKick, weapon === 'rocket' ? 1 : weapon === 'scattergun' ? 0.7 : 0.28)
    fighter.muzzle.visible = true
    this.globe.updateMatrixWorld(true)
    const normal = this.playerAnchor.position.clone().normalize()
    const right = normal.clone().cross(this.playerForward).normalize()
    const start = fighter.muzzle.getWorldPosition(new THREE.Vector3())
    this.focusEnemyOnShot(start, this.playerForward.clone().addScaledVector(normal, this.pitch).normalize(), fighter.team)
    const pelletCount = weapon === 'scattergun' ? 7 : 1
    for (let index = 0; index < pelletCount; index++) {
      const spreadX = weapon === 'scattergun' ? (index - 3) * 0.045 + (Math.random() - 0.5) * 0.025 : 0
      const spreadY = weapon === 'scattergun' ? (Math.random() - 0.5) * 0.08 : 0
      const direction = this.playerForward.clone().addScaledVector(right, spreadX).addScaledVector(normal, this.pitch + spreadY).normalize()
      this.spawnShot(start, direction, weapon, fighter.team)
    }
  }

  private spawnShot(start: THREE.Vector3, direction: THREE.Vector3, weapon: Weapon, team: Team): void {
    const rocket = weapon === 'rocket'
    const mesh = new THREE.Mesh(
      rocket ? new THREE.ConeGeometry(0.043, 0.15, 6) : weapon === 'scattergun' ? new THREE.SphereGeometry(0.018, 5, 4) : new THREE.BoxGeometry(0.016, 0.016, 0.11),
      new THREE.MeshBasicMaterial({ color: rocket ? 0xffa34c : weapon === 'scattergun' ? 0xffd48a : team === 'blue' ? 0xa7ecff : 0xffb0a0, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    mesh.position.copy(start)
    mesh.quaternion.setFromUnitVectors(rocket ? UP : FORWARD, direction)
    this.scene.add(mesh)
    const trailGeometry = new THREE.BufferGeometry()
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(14 * 3), 3))
    trailGeometry.setDrawRange(0, 1)
    const trail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({
      color: rocket ? 0xff8d4c : weapon === 'scattergun' ? 0xffd48a : team === 'blue' ? 0x87e5ff : 0xff9a86,
      transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false,
    }))
    trail.frustumCulled = false
    this.scene.add(trail)
    this.shots.push({ mesh, trail, trailPoints: [start.clone()], velocity: direction.clone().multiplyScalar(rocket ? 8 : weapon === 'scattergun' ? 14 : 18), life: rocket ? 1.7 : weapon === 'scattergun' ? 0.38 : 0.82, weapon, team })
  }

  private updateArmyFire(frame: number): void {
    const ground = this.selected ? GROUND_RADIUS : PLANET_RADIUS
    for (const tracer of this.tracers) {
      if (!tracer.active) {
        if (this.elapsed < tracer.nextFire || tracer.from.health <= 0 || tracer.from === this.selected) continue
        const weapon = tracer.from.weapon
        const start = tracer.from.muzzle.getWorldPosition(this.tempStart)
        const candidates = tracer.targets.filter(fighter => fighter.health > 0
          && fighter.root.getWorldPosition(this.tempEnd).distanceToSquared(start) < 2.1 * 2.1)
        const player = this.selected
        const playerDistance = player && player.team !== tracer.from.team && player.health > 0
          ? player.root.getWorldPosition(this.tempEnd).distanceTo(start) : Infinity
        const target = player && this.pursuers.has(tracer.from) && playerDistance < 4.5
          ? player : candidates[Math.floor(hash(this.elapsed * 1.7 + tracer.from.phase) * candidates.length)]
        if (!target) { tracer.nextFire = this.elapsed + 0.5; continue }
        const end = target.root.getWorldPosition(this.tempEnd).clone()
        if (target === player) {
          const normal = this.playerAnchor.position.clone().normalize()
          const right = normal.clone().cross(this.playerForward).normalize()
          const lead = Math.min(1.2, playerDistance / (weapon === 'rocket' ? 2.1 : weapon === 'scattergun' ? 3.2 : 3.8)) * 0.65
          end.addScaledVector(this.playerForward, this.moveForward * 0.95 * lead)
            .addScaledVector(right, this.moveStrafe * 0.95 * lead)
        }
        const direction = end.clone().addScaledVector(end.clone().normalize(), 0.13)
          .sub(start).normalize()
        if (weapon === 'scattergun') direction.addScaledVector(direction.clone().cross(start.clone().normalize()).normalize(), (hash(this.elapsed * 13 + tracer.from.phase) - 0.5) * 0.13).normalize()
        tracer.weapon = weapon
        tracer.mesh.geometry = this.projectileGeometry(weapon)
        tracer.mesh.material = this.armyBulletMaterial(weapon, tracer.from.team)
        tracer.mesh.position.copy(start)
        tracer.velocity.copy(direction).multiplyScalar(weapon === 'rocket' ? 2.1 : weapon === 'scattergun' ? 3.2 : 3.8)
        tracer.mesh.quaternion.setFromUnitVectors(weapon === 'rocket' ? UP : FORWARD, direction)
        tracer.mesh.visible = true
        const sound = this.soundPlacement(start)
        this.audio?.playWeapon(weapon, sound.distance, sound.pan)
        tracer.from.muzzleUntil = this.elapsed + (weapon === 'rocket' ? 0.18 : weapon === 'scattergun' ? 0.13 : 0.07)
        tracer.from.weaponKick = Math.max(tracer.from.weaponKick, weapon === 'rocket' ? 1 : weapon === 'scattergun' ? 0.7 : 0.28)
        tracer.from.muzzle.visible = true
        tracer.active = true
        tracer.life = Math.max(weapon === 'rocket' ? 1.45 : weapon === 'scattergun' ? 0.65 : 0.85,
          start.distanceTo(end) / tracer.velocity.length() + 0.25)
        continue
      }
      tracer.life -= frame
      const previous = tracer.mesh.position.clone()
      const next = previous.clone().addScaledVector(tracer.velocity, frame)
      const segment = next.clone().sub(previous)
      const lengthSquared = Math.max(segment.lengthSq(), 0.000001)
      let hit = false
      for (const fighter of this.armyTargets(tracer)) {
        if (fighter.health <= 0) continue
        const position = fighter.root.getWorldPosition(this.tempEnd)
        position.addScaledVector(position.clone().normalize(), 0.12)
        const along = THREE.MathUtils.clamp(position.clone().sub(previous).dot(segment) / lengthSquared, 0, 1)
        const contact = previous.clone().addScaledVector(segment, along)
        const hitRadius = tracer.weapon === 'rocket' ? 0.2 : tracer.weapon === 'scattergun' ? 0.17 : 0.13
        if (contact.distanceToSquared(position) > hitRadius * hitRadius) continue
        tracer.mesh.position.copy(contact)
        this.addImpact(contact, tracer.weapon, tracer.from.team)
        this.damageFighter(fighter, tracer.weapon === 'rocket' ? 3 : tracer.weapon === 'scattergun' ? 2 : 1)
        if (tracer.weapon === 'rocket') this.damageArmySplash(tracer, contact, fighter)
        hit = true
        break
      }
      if (!hit) tracer.mesh.position.copy(next)
      if (!hit && tracer.life > 0 && next.lengthSq() > (ground + 0.01) ** 2) continue
      if (!hit && (next.lengthSq() <= (ground + 0.01) ** 2 || tracer.weapon === 'rocket')) {
        this.addImpact(next, tracer.weapon, tracer.from.team)
        if (tracer.weapon === 'rocket') this.damageArmySplash(tracer, next)
      }
      tracer.active = false
      tracer.mesh.visible = false
      tracer.nextFire = this.elapsed + (tracer.weapon === 'rocket' ? 2.1 : tracer.weapon === 'scattergun' ? 1.35 : 0.85)
        + hash(tracer.from.phase + this.elapsed * 0.5) * 0.65
    }
  }

  private damageArmySplash(tracer: Tracer, position: THREE.Vector3, directHit?: Fighter): void {
    for (const fighter of this.armyTargets(tracer)) {
      if (fighter === directHit || fighter.health <= 0) continue
      if (fighter.root.getWorldPosition(this.tempEnd).distanceToSquared(position) < 0.52 * 0.52) this.damageFighter(fighter, 3)
    }
  }

  private armyTargets(tracer: Tracer): Fighter[] {
    const player = this.selected
    return player && player.team !== tracer.from.team && !tracer.targets.includes(player)
      ? [...tracer.targets, player] : tracer.targets
  }

  private resetArmyFire(): void {
    for (const tracer of this.tracers) {
      tracer.active = false
      tracer.mesh.visible = false
      tracer.nextFire = this.elapsed + 0.25 + hash(tracer.from.phase) * 0.6
    }
  }

  private updateShots(frame: number): void {
    for (let index = this.shots.length - 1; index >= 0; index--) {
      const shot = this.shots[index]
      shot.life -= frame
      let impact = false
      const steps = Math.max(1, Math.ceil(frame * shot.velocity.length() / 0.12))
      const step = frame / steps
      for (let substep = 0; substep < steps && !impact; substep++) {
        const previous = shot.mesh.position.clone()
        const next = previous.clone().addScaledVector(shot.velocity, step)
        const segment = this.tempDirection.copy(next).sub(previous)
        const segmentLength = Math.max(segment.lengthSq(), 0.000001)
        for (const building of this.buildingObstacles) {
          if (!building.detail.visible) continue
          const along = THREE.MathUtils.clamp(((building.center.x - previous.x) * segment.x + (building.center.y - previous.y) * segment.y + (building.center.z - previous.z) * segment.z) / segmentLength, 0, 1)
          this.tempStart.copy(previous).addScaledVector(segment, along)
          if (this.tempStart.distanceToSquared(building.center) > building.radius * building.radius) continue
          shot.mesh.position.copy(this.tempStart)
          impact = true
          break
        }
        if (impact) break
        for (const enemy of this.fighters) {
          if (enemy.team === shot.team || enemy === this.selected || enemy.health <= 0) continue
          const position = enemy.root.getWorldPosition(this.tempEnd).addScaledVector(enemy.zone.position, 0.13 / enemy.zone.position.length())
          const along = THREE.MathUtils.clamp(((position.x - previous.x) * segment.x + (position.y - previous.y) * segment.y + (position.z - previous.z) * segment.z) / segmentLength, 0, 1)
          this.tempStart.copy(previous).addScaledVector(segment, along)
          if (this.tempStart.distanceToSquared(position) > (shot.weapon === 'rocket' ? 0.2 : shot.weapon === 'scattergun' ? 0.13 : 0.12) ** 2) continue
          shot.mesh.position.copy(this.tempStart)
          if (!this.focusedEnemy || this.elapsed > this.focusedEnemyUntil) this.focusEnemy(enemy)
          this.damageFighter(enemy, shot.weapon === 'rocket' ? 3 : 1)
          impact = true
          break
        }
        if (impact) break
        const ground = GROUND_RADIUS + 0.015
        if (next.lengthSq() <= ground * ground) {
          const oldRadius = previous.length()
          const newRadius = next.length()
          const fraction = THREE.MathUtils.clamp((oldRadius - ground) / Math.max(oldRadius - newRadius, 0.000001), 0, 1)
          shot.mesh.position.copy(previous).lerp(next, fraction)
          impact = true
          break
        }
        shot.mesh.position.copy(next)
        shot.mesh.quaternion.setFromUnitVectors(shot.weapon === 'rocket' ? UP : FORWARD, shot.velocity.clone().normalize())
      }
      shot.trailPoints.push(shot.mesh.position.clone())
      if (shot.trailPoints.length > 14) shot.trailPoints.shift()
      const trailPositions = shot.trail.geometry.getAttribute('position') as THREE.BufferAttribute
      shot.trailPoints.forEach((point, pointIndex) => trailPositions.setXYZ(pointIndex, point.x, point.y, point.z))
      trailPositions.needsUpdate = true
      shot.trail.geometry.setDrawRange(0, shot.trailPoints.length)
      if (!impact && shot.life > 0 && shot.mesh.position.lengthSq() < 40 * 40) continue
      if (impact || shot.weapon === 'rocket') {
        if (shot.weapon === 'rocket') {
          for (const enemy of this.fighters) {
            if (enemy.team === shot.team || enemy === this.selected || enemy.health <= 0) continue
            if (enemy.root.getWorldPosition(this.tempEnd).distanceToSquared(shot.mesh.position) < 0.68 * 0.68) {
              if (!this.focusedEnemy || this.elapsed > this.focusedEnemyUntil) this.focusEnemy(enemy)
              this.damageFighter(enemy, 3)
            }
          }
        }
        this.addImpact(shot.mesh.position, shot.weapon, shot.team)
      }
      this.scene.remove(shot.mesh)
      this.scene.remove(shot.trail)
      shot.mesh.geometry.dispose()
      ;(shot.mesh.material as THREE.Material).dispose()
      shot.trail.geometry.dispose()
      shot.trail.material.dispose()
      this.shots.splice(index, 1)
    }
    for (let index = this.impacts.length - 1; index >= 0; index--) {
      const impact = this.impacts[index]
      impact.life -= frame
      if (impact.life <= 0) {
        this.disposeImpact(impact)
        this.impacts.splice(index, 1)
      } else {
        const progress = 1 - impact.life / impact.duration
        impact.group.scale.setScalar(0.35 + progress * 2.5)
        impact.flash.material.opacity = (1 - progress) * 0.9
        impact.ring.material.opacity = (1 - progress) * 0.65
      }
    }
  }

  private damageFighter(fighter: Fighter, damage: number): void {
    if (fighter.health <= 0) return
    if (fighter === this.selected) {
      if (this.elapsed < this.playerInvulnerableUntil) return
      this.playerInvulnerableUntil = this.elapsed + 0.42
    }
    fighter.health -= damage
    const sound = this.soundPlacement(fighter.root.getWorldPosition(new THREE.Vector3()))
    this.audio?.playDamage(fighter === this.selected, sound.distance, sound.pan)
    fighter.stunnedUntil = this.elapsed + 0.3
    if (fighter === this.selected) {
      this.cameraShake = Math.max(this.cameraShake, 0.38)
      if (typeof navigator.vibrate === 'function') navigator.vibrate(fighter.health > 0 ? 22 : [45, 25, 70])
    }
    if (fighter.health > 0) return
    fighter.deathAt = this.elapsed
    fighter.respawnAt = this.elapsed + 3.8
    this.kills[fighter.team]++
    this.audio?.playDeath(fighter === this.selected, sound.distance, sound.pan)
    this.addImpact(fighter.root.getWorldPosition(new THREE.Vector3()), 'scattergun')
    if (fighter === this.selected) this.handoffPlayer(fighter)
  }

  private handoffPlayer(fallen: Fighter): void {
    this.scene.attach(fallen.root)
    fallen.deathPosition.copy(fallen.root.position)
    fallen.deathNormal.copy(fallen.root.position).normalize()
    const frontline = this.frontlineFighters.filter(fighter => fighter !== fallen && fighter.team === fallen.team && fighter.health > 0)
    const reserves = this.fighters.filter(fighter => fighter !== fallen && fighter.team === fallen.team && fighter.health > 0)
    let replacement = (frontline.length ? frontline : reserves)[Math.floor(Math.random() * (frontline.length || reserves.length))]
    if (!replacement) {
      fallen.zone.add(fallen.root)
      fallen.health = SOLDIER_HEALTH
      fallen.reinforcement = 0
      fallen.x = (fallen.team === 'blue' ? -1 : 1) * 1.06
      fallen.root.position.set(fallen.x, surfaceY(fallen.x, fallen.z, GROUND_RADIUS) + SOLDIER_GROUND_CLEARANCE, fallen.z)
      fallen.root.rotation.set(0, 0, 0)
      fallen.root.visible = true
      replacement = fallen
    }
    const position = replacement.root.getWorldPosition(new THREE.Vector3())
    this.selected = replacement
    this.audio?.playEnter()
    replacement.health = PLAYER_HEALTH
    this.focusedEnemy = null
    this.playerInvulnerableUntil = this.elapsed + 0.8
    this.playerAnchor.position.copy(position.normalize()).multiplyScalar(PLANET_RADIUS + PLAYER_ANCHOR_CLEARANCE)
    const heading = replacement.team === 'blue' ? Math.PI / 2 : -Math.PI / 2
    this.playerForward.set(Math.sin(heading), 0, Math.cos(heading)).applyQuaternion(replacement.zone.getWorldQuaternion(new THREE.Quaternion()))
    this.orientPlayer()
    this.playerAnchor.add(replacement.root)
    this.setFighterWeapon(replacement, this.weapon)
    replacement.root.position.set(0, SOLDIER_GROUND_CLEARANCE, 0)
    replacement.root.rotation.set(0, 0, 0)
    this.entryCamera.copy(this.camera.position)
    this.entryProgress = 0
    this.nextShot = this.elapsed + 0.4
    this.firing = false
    this.recoil = 0
  }

  private addImpact(position: THREE.Vector3, weapon: Weapon, team?: Team): void {
    const sound = this.soundPlacement(position)
    this.audio?.playImpact(weapon, sound.distance, sound.pan)
    const rocket = weapon === 'rocket'
    const color = rocket ? 0xff793e : weapon === 'scattergun' ? 0xffd581 : team === 'blue' ? 0x9deaff : team === 'red' ? 0xffa492 : 0xb6eaff
    const group = new THREE.Group()
    group.position.copy(position)
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(rocket ? 0.22 : weapon === 'scattergun' ? 0.075 : 0.055, 9, 7),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(rocket ? 0.31 : weapon === 'scattergun' ? 0.12 : 0.085, rocket ? 0.022 : 0.009, 5, 18),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    )
    ring.quaternion.setFromUnitVectors(FORWARD, position.clone().normalize())
    group.add(flash, ring)
    this.scene.add(group)
    const duration = rocket ? 0.58 : weapon === 'scattergun' ? 0.28 : 0.22
    this.impacts.push({ group, flash, ring, life: duration, duration })
    if (this.selected && position.distanceToSquared(this.camera.position) < 9) this.cameraShake = Math.max(this.cameraShake, rocket ? 0.9 : weapon === 'scattergun' ? 0.25 : 0.12)
  }

  private disposeImpact(impact: Impact): void {
    this.scene.remove(impact.group)
    impact.flash.geometry.dispose()
    impact.flash.material.dispose()
    impact.ring.geometry.dispose()
    impact.ring.material.dispose()
  }

  private clearShots(): void {
    for (const shot of this.shots) {
      this.scene.remove(shot.mesh, shot.trail)
      shot.mesh.geometry.dispose()
      ;(shot.mesh.material as THREE.Material).dispose()
      shot.trail.geometry.dispose()
      shot.trail.material.dispose()
    }
    this.shots.length = 0
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.audio = null
    this.clearShots()
    for (const impact of this.impacts) this.disposeImpact(impact)
    this.impacts.length = 0
    this.scene.clear()
    for (const geometry of this.geometries) geometry.dispose()
    for (const material of this.materials) material.dispose()
    this.geometries.clear()
    this.materials.clear()
    this.boxCache.clear()
    this.cylinderCache.clear()
    this.projectileCache.clear()
    this.fighterMaterialCache.clear()
    this.fighters.length = 0
    this.frontlineFighters.length = 0
    this.tracers.length = 0
    this.pursuers.clear()
    this.smoke.length = 0
    this.blasts.length = 0
    this.shockwaves.length = 0
    this.embers.length = 0
    this.banners.length = 0
    this.battleZones.length = 0
    this.buildingObstacles.length = 0
    this.groundAssets.length = 0
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
    this.atmosphere = new THREE.Mesh(
      this.geometry(new THREE.SphereGeometry(PLANET_RADIUS * 1.037, 40, 28)),
      this.material(new THREE.MeshBasicMaterial({ color: 0xd4573d, side: THREE.BackSide, transparent: true, opacity: 0.12, depthWrite: false })),
    )
    globe.add(this.atmosphere)
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

  private addGroundBuildings(zone: THREE.Group, zoneIndex: number): THREE.Group {
    const detail = new THREE.Group()
    detail.name = `Ground-scale ruins ${zoneIndex + 1}`
    detail.visible = false
    zone.add(detail)
    const concrete = this.fighterMaterial('ground-concrete', () => new THREE.MeshStandardMaterial({ color: 0x5d6770, roughness: 0.9, metalness: 0.11, flatShading: true }))
    const scorched = this.fighterMaterial('ground-scorched', () => new THREE.MeshStandardMaterial({ color: 0x25313b, roughness: 0.96, flatShading: true }))
    const metal = this.fighterMaterial('ground-metal', () => new THREE.MeshStandardMaterial({ color: 0x73808a, roughness: 0.6, metalness: 0.45, flatShading: true }))
    const glow = this.fighterMaterial('ground-glow', () => new THREE.MeshBasicMaterial({ color: 0xff8048 }))
    const box = (parent: THREE.Group, width: number, height: number, depth: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(this.boxGeometry(width, height, depth), material)
      mesh.position.set(x, y, z)
      parent.add(mesh)
      return mesh
    }
    for (let index = 0; index < 4; index++) {
      const angle = Math.PI / 4 + index * Math.PI / 2 + zoneIndex * 0.11
      const radius = 0.62 + hash(zoneIndex * 21 + index * 9) * 0.19
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      const height = 0.68 + hash(zoneIndex * 31 + index * 7) * 0.43
      const building = new THREE.Group()
      building.position.set(x, 0, z)
      building.rotation.y = angle + 0.6
      detail.add(building)
      this.groundAsset(zone, building, 0.002)
      const footNormal = zone.localToWorld(new THREE.Vector3(x, surfaceY(x, z) + 0.002, z)).normalize()
      const center = zone.localToWorld(new THREE.Vector3(x, surfaceY(x, z) + height * 0.48, z))
      this.buildingObstacles.push({ normal: footNormal, center, radius: 0.33, detail, group: building, height })
      box(building, 0.42, 0.045, 0.32, scorched, 0, 0.022, 0)
      box(building, 0.075, height, 0.24, concrete, -0.16, height / 2, -0.035)
      box(building, 0.075, height * 0.74, 0.24, concrete, 0.16, height * 0.37, -0.035)
      box(building, 0.28, height * 0.48, 0.055, scorched, 0, height * 0.24, -0.125)
      const brokenRoof = box(building, 0.29, 0.055, 0.24, concrete, -0.025, height * 0.86, -0.02)
      brokenRoof.rotation.z = (index % 2 ? -1 : 1) * 0.28
      box(building, 0.15, 0.03, 0.012, glow, 0, height * 0.42, -0.093)
      box(building, 0.035, 0.22, 0.035, metal, 0.13, height * 0.86, -0.08)
      for (let debris = 0; debris < 2; debris++) {
        const chunk = box(building, 0.14 + debris * 0.05, 0.08, 0.11, concrete, (debris ? 1 : -1) * 0.27, 0.045, 0.09 + debris * 0.1)
        chunk.rotation.y = angle * 0.3 + debris
      }
    }
    return detail
  }

  private addBattlefield(globe: THREE.Group, normal: THREE.Vector3, zoneIndex: number, formation: Formation): void {
    const zone = new THREE.Group()
    zone.name = `${formation === 'front' ? 'Clash line' : `${formation} army reserve`} ${zoneIndex + 1}`
    zone.position.copy(normal).multiplyScalar(PLANET_RADIUS)
    const across = new THREE.Vector3(1, 0, 0).addScaledVector(normal, -normal.x).normalize()
    zone.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, normal, across.clone().cross(normal)))
    globe.add(zone)
    const groundDetail = this.addGroundBuildings(zone, zoneIndex)
    this.battleZones.push({ root: zone, normal, groundDetail })

    const sides = formation === 'front' ? [-1, 1] : [formation === 'blue' ? -1 : 1]
    for (const side of sides) {
      const color = side < 0 ? BLUE : RED
      const signal = new THREE.Mesh(
        this.boxGeometry(0.045, 0.012, 1.05),
        this.material(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82 })),
      )
      signal.position.set(side * 0.72, 0, 0)
      zone.add(signal)
      this.groundAsset(zone, signal, 0.008)
      const banner = new THREE.Group()
      const bannerX = side * 0.86
      banner.position.set(bannerX, 0, -0.42)
      banner.add(new THREE.Mesh(this.boxGeometry(0.018, 0.68, 0.018), this.fighterMaterial('banner-pole', () => new THREE.MeshStandardMaterial({ color: 0xb2a38c, roughness: 0.68 }))))
      banner.children[0].position.y = 0.34
      const flag = new THREE.Mesh(
        this.boxGeometry(0.33, 0.21, 0.012),
        this.fighterMaterial(`banner-${side}`, () => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })),
      )
      flag.position.set(side * 0.17, 0.55, 0)
      banner.add(flag)
      zone.add(banner)
      this.groundAsset(zone, banner, 0.003)
      this.banners.push({ flag, phase: zoneIndex * 0.63 + side })
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
      wall.position.set(x, 0, z)
      wall.rotation.set((index % 2 ? 1 : -1) * 0.1, angle + 0.4, (index % 3 - 1) * 0.13)
      zone.add(wall)
      this.groundAsset(zone, wall, height / 2 + 0.004)
      if (index % 2 === 0) {
        const crackX = Math.cos(angle) * (distance - 0.08)
        const crackZ = Math.sin(angle) * (distance - 0.08)
        const crack = new THREE.Mesh(this.boxGeometry(0.16, 0.006, 0.012), scar)
        crack.position.set(crackX, 0, crackZ)
        crack.rotation.y = angle
        zone.add(crack)
        this.groundAsset(zone, crack, 0.004)
      }
    }

    for (const side of sides) {
      const x = side * 0.54
      const z = side * 0.3
      const flame = new THREE.Mesh(
        this.geometry(new THREE.ConeGeometry(0.052, 0.16, 5)),
        this.material(new THREE.MeshBasicMaterial({ color: 0xff9e45, transparent: true, opacity: 0.82, depthWrite: false })),
      )
      flame.position.set(x, 0, z)
      zone.add(flame)
      this.groundAsset(zone, flame, 0.081)
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
    const count = formation === 'front' ? 6 : 8
    for (let index = 0; index < count; index++) {
      if (formation !== 'red') blue.push(this.addFighter(zone, 'blue', index, zoneIndex, formation))
      if (formation !== 'blue') red.push(this.addFighter(zone, 'red', index, zoneIndex, formation))
    }
    if (formation === 'front') {
      for (let index = 0; index < blue.length + red.length; index++) {
        const from = index < blue.length ? blue[index] : red[index - blue.length]
        const mesh = new THREE.Mesh(this.projectileGeometry(from.weapon), this.armyBulletMaterial(from.weapon, from.team))
        mesh.visible = false
        this.scene.add(mesh)
        this.tracers.push({ mesh, from, targets: from.team === 'blue' ? red : blue, velocity: new THREE.Vector3(), nextFire: 0.35 + index * 0.15 + zoneIndex * 0.08, life: 0, active: false, weapon: from.weapon })
      }
    }
    const blast = new THREE.Mesh(
      this.geometry(new THREE.SphereGeometry(0.13, 10, 8)),
      this.material(new THREE.MeshBasicMaterial({ color: 0xff9c51, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })),
    )
    const blastZ = (zoneIndex % 2 ? 1 : -1) * 0.17
    blast.position.set(0.04, 0, blastZ)
    zone.add(blast)
    this.groundAsset(zone, blast, 0.1)
    const phase = hash(zoneIndex * 37) * 0.95
    this.blasts.push({ mesh: blast, phase })
    const wave = new THREE.Mesh(
      this.geometry(new THREE.TorusGeometry(0.09, 0.008, 4, 20)),
      this.material(new THREE.MeshBasicMaterial({ color: 0xffac65, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })),
    )
    wave.rotation.x = -Math.PI / 2
    wave.position.set(0.04, 0, blastZ)
    zone.add(wave)
    this.groundAsset(zone, wave, 0.008)
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

  private setFighterWeapon(fighter: Fighter, weapon: Weapon): void {
    let model = fighter.weaponModels[weapon]
    if (!model) {
      model = this.buildWeaponModel(weapon, fighter.team)
      fighter.weaponModels[weapon] = model
      fighter.root.add(model.root)
    }
    for (const entry of Object.values(fighter.weaponModels)) if (entry) {
      entry.root.visible = entry === model
      entry.muzzle.visible = false
    }
    fighter.weapon = weapon
    fighter.muzzle = model.muzzle
    fighter.muzzleUntil = 0
    fighter.weaponKick = 0
  }

  private buildWeaponModel(weapon: Weapon, team: Team): { root: THREE.Group; muzzle: THREE.Mesh } {
    const root = new THREE.Group()
    root.name = `${weapon} model`
    root.position.set(0.04, 0.29, 0.13)
    const metal = this.fighterMaterial('weapon-metal', () => new THREE.MeshStandardMaterial({ color: 0x2a3540, metalness: 0.72, roughness: 0.43, flatShading: true }))
    const steel = this.fighterMaterial('weapon-steel', () => new THREE.MeshStandardMaterial({ color: 0x74818a, metalness: 0.72, roughness: 0.36, flatShading: true }))
    const grip = this.fighterMaterial('weapon-grip', () => new THREE.MeshStandardMaterial({ color: 0x151d26, metalness: 0.18, roughness: 0.82 }))
    const accent = this.fighterMaterial(`weapon-accent-${team}`, () => new THREE.MeshBasicMaterial({ color: team === 'blue' ? 0x5dcfff : 0xff7865 }))
    const amber = this.fighterMaterial('weapon-amber', () => new THREE.MeshBasicMaterial({ color: 0xffbc67 }))
    const part = (width: number, height: number, depth: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(this.boxGeometry(width, height, depth), material)
      mesh.position.set(x, y, z)
      root.add(mesh)
      return mesh
    }
    const tube = (radius: number, length: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(this.cylinderGeometry(radius, length), material)
      mesh.position.set(x, y, z)
      mesh.rotation.x = Math.PI / 2
      root.add(mesh)
      return mesh
    }
    let muzzleZ = 0.48
    if (weapon === 'rifle') {
      part(0.12, 0.1, 0.26, metal, 0, 0, 0.02)
      part(0.095, 0.08, 0.19, grip, 0, -0.015, -0.2)
      part(0.075, 0.14, 0.09, steel, 0, -0.115, 0.035)
      part(0.16, 0.035, 0.15, steel, 0, 0.06, 0.11)
      part(0.085, 0.05, 0.095, grip, 0, 0.09, -0.035)
      tube(0.026, 0.32, steel, 0, 0.01, 0.31)
      tube(0.038, 0.06, metal, 0, 0.01, 0.47)
      part(0.105, 0.018, 0.055, accent, 0, 0.055, 0.015)
      muzzleZ = 0.52
    } else if (weapon === 'scattergun') {
      part(0.18, 0.115, 0.23, metal, 0, 0, 0.015)
      part(0.12, 0.09, 0.22, grip, 0, -0.02, -0.18)
      part(0.19, 0.07, 0.11, grip, 0, -0.02, 0.18)
      tube(0.038, 0.31, steel, -0.052, 0.03, 0.29)
      tube(0.038, 0.31, steel, 0.052, 0.03, 0.29)
      part(0.18, 0.028, 0.1, amber, 0, 0.095, 0.07)
      muzzleZ = 0.48
    } else {
      tube(0.11, 0.7, metal, 0, 0.035, 0.1)
      tube(0.12, 0.065, steel, 0, 0.035, 0.43)
      tube(0.095, 0.08, grip, 0, 0.035, -0.25)
      part(0.16, 0.045, 0.23, grip, 0, -0.11, 0.06)
      part(0.04, 0.09, 0.06, steel, 0, 0.17, 0.24)
      part(0.045, 0.05, 0.23, accent, 0, 0.15, -0.02)
      muzzleZ = 0.49
    }
    const muzzle = new THREE.Mesh(
      this.boxGeometry(weapon === 'rocket' ? 0.2 : weapon === 'scattergun' ? 0.17 : 0.11, weapon === 'rocket' ? 0.2 : 0.12, 0.06),
      this.fighterMaterial(`muzzle-flash-${weapon}`, () => new THREE.MeshBasicMaterial({ color: weapon === 'rocket' ? 0xff8c43 : weapon === 'scattergun' ? 0xffd789 : 0xfff2ae, blending: THREE.AdditiveBlending, depthWrite: false })),
    )
    muzzle.position.set(0, weapon === 'rocket' ? 0.035 : weapon === 'scattergun' ? 0.03 : 0.01, muzzleZ)
    muzzle.visible = false
    root.add(muzzle)
    return { root, muzzle }
  }

  private addFighter(zone: THREE.Group, team: Team, index: number, zoneIndex: number, formation: Formation): Fighter {
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
    const assignedWeapon: Weapon = (index + zoneIndex + (team === 'red' ? 1 : 0)) % 3 === 0
      ? 'rifle' : (index + zoneIndex + (team === 'red' ? 1 : 0)) % 3 === 1 ? 'scattergun' : 'rocket'
    const model = this.buildWeaponModel(assignedWeapon, team)
    root.add(model.root)

    const phase = index * 0.88 + zoneIndex * 1.3 + (team === 'red' ? 2.2 : 0)
    const side = team === 'blue' ? -1 : 1
    const columns = formation === 'front' ? 3 : 4
    const rank = Math.floor(index / columns)
    const column = index % columns
    const baseX = side * ((formation === 'front' ? 0.29 : 0.12) + rank * 0.25)
      + (hash(index * 11 + zoneIndex * 9) - 0.5) * 0.025
    const baseZ = (column - (columns - 1) / 2) * 0.29
      + (rank % 2 ? 0.055 : 0) + (hash(index * 23 + zoneIndex * 3) - 0.5) * 0.025
    const fighter: Fighter = { root, zone, leftArm, rightArm, leftLeg, rightLeg, muzzle: model.muzzle, muzzleUntil: 0, weaponKick: 0, weapon: assignedWeapon, assignedWeapon, weaponModels: { [assignedWeapon]: model }, team, baseX, baseZ, formation, rank, zoneIndex, phase, x: baseX, z: baseZ, stunnedUntil: 0, health: 3, deathAt: 0, respawnAt: 0, reinforcement: 1, deathPosition: new THREE.Vector3(), deathNormal: new THREE.Vector3() }
    this.fighters.push(fighter)
    if (formation === 'front') this.frontlineFighters.push(fighter)
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

  private cylinderGeometry(radius: number, length: number): THREE.CylinderGeometry {
    const key = `${radius}/${length}`
    let geometry = this.cylinderCache.get(key)
    if (!geometry) {
      geometry = this.geometry(new THREE.CylinderGeometry(radius, radius, length, 8))
      this.cylinderCache.set(key, geometry)
    }
    return geometry
  }

  private projectileGeometry(weapon: Weapon): THREE.BufferGeometry {
    let geometry = this.projectileCache.get(weapon)
    if (!geometry) {
      geometry = this.geometry(weapon === 'rocket' ? new THREE.ConeGeometry(0.052, 0.18, 6)
        : weapon === 'scattergun' ? new THREE.SphereGeometry(0.032, 6, 4)
          : new THREE.BoxGeometry(0.018, 0.018, 0.17))
      this.projectileCache.set(weapon, geometry)
    }
    return geometry
  }

  private armyBulletMaterial(weapon: Weapon, team: Team): THREE.Material {
    return this.fighterMaterial(`army-bullet-${weapon}-${team}`, () => new THREE.MeshBasicMaterial({
      color: weapon === 'rocket' ? 0xff9a4e : weapon === 'scattergun' ? 0xffdb91 : team === 'blue' ? 0x9deaff : 0xffa18d,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }))
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

function surfaceY(x: number, z: number, radius = PLANET_RADIUS): number {
  return Math.sqrt(Math.max(0, radius * radius - x * x - z * z)) - radius
}

function surfaceNormal(x: number, z: number, radius: number): THREE.Vector3 {
  return new THREE.Vector3(x, Math.sqrt(Math.max(0, radius * radius - x * x - z * z)), z).normalize()
}

function hash(value: number): number {
  const fraction = Math.sin(value * 127.13) * 43758.5453
  return fraction - Math.floor(fraction)
}
