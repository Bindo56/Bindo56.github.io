import * as THREE from 'three'
import type { PlanetDefinition } from '../app/PlanetContracts.ts'
import { createSpaceToonMaterial, planetToonPalette } from './SpaceToonShader.ts'

export type PlanetDetail = 'far' | 'mid' | 'near'

export interface PlanetMotif {
  /** Centered on the world origin, in the same units as definition.radius. */
  group: THREE.Group
  update(elapsedSeconds: number, reducedMotion: boolean, detail: PlanetDetail): void
  dispose(): void
}

interface MotifParts {
  group: THREE.Group
  mid: THREE.Group
  near: THREE.Group
  animate: (time: number, detail: PlanetDetail) => void
}

const INK = 0x020715
const UP = new THREE.Vector3(0, 1, 0)

/** Each destination keeps a readable silhouette even when secondary details are culled. */
export function createPlanetMotif(definition: PlanetDefinition): PlanetMotif {
  const radius = Math.max(12, Math.min(55, definition.radius))
  let parts: MotifParts

  switch (definition.slug) {
    case 'voxel': parts = voxelMotif(radius, definition.color); break
    case 'npc-ecs': parts = npcMotif(radius, definition.color); break
    case 'stretch-squash': parts = elasticMotif(radius, definition.color); break
    case 'drone-fleet': parts = droneMotif(radius, definition.color); break
    case 'event-horizon': parts = gravityMotif(radius); break
    case 'warfront': parts = warfrontMotif(radius, definition.color); break
    case 'bitboard': parts = bitboardMotif(radius, definition.color); break
    case 'pixel-farm': parts = farmMotif(radius, definition.color); break
    case 'material-forge': parts = materialMotif(radius, definition.color); break
    default: parts = plainMotif(radius, definition.color)
  }

  parts.group.add(parts.mid, parts.near)
  let disposed = false
  return {
    group: parts.group,
    update(elapsedSeconds, reducedMotion, detail) {
      if (disposed) return
      parts.mid.visible = detail !== 'far'
      parts.near.visible = detail === 'near'
      parts.animate(reducedMotion ? 0 : elapsedSeconds, detail)
    },
    dispose() {
      if (disposed) return
      disposed = true
      disposeGraph(parts.group)
      parts.group.clear()
    },
  }
}

function baseParts(radius: number, color: number, geometry?: THREE.BufferGeometry): MotifParts {
  const group = new THREE.Group()
  const mid = new THREE.Group()
  const near = new THREE.Group()
  const body = new THREE.Mesh(
    geometry ?? new THREE.SphereGeometry(radius, 28, 18),
    createSpaceToonMaterial(planetToonPalette(color)),
  )
  outline(body, 0.045)
  group.add(body)
  group.userData.body = body
  return { group, mid, near, animate: () => undefined }
}

function plainMotif(radius: number, color: number): MotifParts {
  return baseParts(radius, color)
}

function voxelMotif(radius: number, color: number): MotifParts {
  const parts = baseParts(radius, color, new THREE.IcosahedronGeometry(radius * 0.9, 1))
  const fragments: THREE.Mesh[] = []
  const blockGeometry = new THREE.BoxGeometry(radius * 0.23, radius * 0.23, radius * 0.23)
  const amber = createSpaceToonMaterial(planetToonPalette(color))
  const pale = createSpaceToonMaterial(planetToonPalette(0xffd07c))

  for (let i = 0; i < 9; i++) {
    const block = new THREE.Mesh(blockGeometry, i % 3 ? amber : pale)
    block.name = 'Breakaway voxel'
    block.scale.setScalar(i < 5 ? 1 : 0.65)
    block.rotation.set(i * 0.27, i * 0.61, i * 0.19)
    outline(block, 0.08)
    ;(i < 5 ? parts.group : parts.mid).add(block)
    fragments.push(block)
  }

  const fracture = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(radius * 0.93, 1)),
    new THREE.LineBasicMaterial({ color: 0x7d3615, transparent: true, opacity: 0.62 }),
  )
  parts.mid.add(fracture)
  parts.animate = time => {
    fragments.forEach((block, i) => {
      const angle = (i / fragments.length) * Math.PI * 2
      const burst = Math.pow(Math.max(0, Math.sin(time * 1.2 + i * 0.56)), 3)
      const distance = radius * (0.94 + burst * (i < 5 ? 0.4 : 0.6))
      block.position.set(
        Math.cos(angle) * distance,
        Math.sin(i * 2.4) * radius * 0.38 + burst * radius * 0.11,
        Math.sin(angle) * distance,
      )
      block.rotation.y = i * 0.61 + time * (i % 2 ? 0.09 : -0.07)
    })
    fracture.rotation.y = time * 0.06
  }
  return parts
}

function npcMotif(radius: number, color: number): MotifParts {
  const parts = baseParts(radius, color)
  const city = new THREE.Group()
  const buildings = new THREE.BoxGeometry(radius * 0.13, radius * 0.34, radius * 0.13)
  const towerMaterial = createSpaceToonMaterial(planetToonPalette(0x196b7b))
  for (let i = 0; i < 11; i++) {
    const longitude = (i / 11) * Math.PI * 2
    const latitude = Math.sin(i * 2.1) * 0.28
    const tower = new THREE.Mesh(buildings, towerMaterial)
    tower.scale.y = 0.65 + (i % 4) * 0.24
    attachToSurface(tower, radius * 0.98, latitude, longitude)
    city.add(tower)
  }
  parts.group.add(city)

  const route = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(latitudeRing(radius * 1.035, 0.1, 64)),
    new THREE.LineBasicMaterial({ color: 0xb1fff4, transparent: true, opacity: 0.55 }),
  )
  parts.mid.add(route)
  const walkers = Array.from({ length: 5 }, (_, i) => {
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.035, 7, 5),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffffff : 0x62f3df }),
    )
    parts.mid.add(light)
    return light
  })
  parts.animate = time => {
    city.rotation.y = time * 0.055
    walkers.forEach((light, i) => {
      // Their routes vary in pace without a visible position jump.
      const angle = time * (0.16 + (i % 2) * 0.08) + i * Math.PI * 0.4
        + Math.sin(time * 0.67 + i) * 0.11
      const point = spherePoint(radius * 1.045, 0.1, angle)
      light.position.copy(point)
    })
  }
  return parts
}

function elasticMotif(radius: number, color: number): MotifParts {
  const geometry = new THREE.SphereGeometry(radius, 30, 20)
  const original = new Float32Array(geometry.attributes.position.array)
  const parts = baseParts(radius, color, geometry)
  const body = parts.group.userData.body as THREE.Mesh
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.1, 24, 14),
    new THREE.MeshBasicMaterial({ color: 0xffa1dc, transparent: true, opacity: 0.11, depthWrite: false, side: THREE.BackSide }),
  )
  parts.group.add(atmosphere)

  const seam = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 1.025, radius * 0.018, 5, 56),
    new THREE.MeshBasicMaterial({ color: 0xffddf0 }),
  )
  seam.rotation.x = Math.PI / 2
  parts.mid.add(seam)
  const softBands = new THREE.Group()
  for (const latitude of [-0.45, 0.45]) {
    const band = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(latitudeRing(radius * 1.03, latitude, 48)),
      new THREE.LineBasicMaterial({ color: 0x6e235c, transparent: true, opacity: 0.62 }),
    )
    softBands.add(band)
  }
  parts.near.add(softBands)

  parts.animate = (time, detail) => {
    const phase = (time % 4.8) / 4.8
    let height = 1
    if (phase < 0.14) height = 1 + 0.09 * ease(phase / 0.14) // anticipation
    else if (phase < 0.36) height = 1.09 - 0.48 * ease((phase - 0.14) / 0.22)
    else if (phase < 0.59) height = 0.61 + 0.72 * ease((phase - 0.36) / 0.23)
    else {
      const settle = (phase - 0.59) / 0.41
      height = 1 + 0.33 * Math.exp(-4 * settle) * Math.cos(settle * 9)
    }
    const width = 1 / Math.sqrt(height)
    const position = geometry.attributes.position as THREE.BufferAttribute
    // The surface and its backface outline share this geometry, so the ink follows deformation.
    for (let i = 0; i < position.count; i++) {
      const offset = i * 3
      const x = original[offset]
      const y = original[offset + 1]
      const z = original[offset + 2]
      const wobble = 1 + 0.026 * Math.sin(time * 6 + y * 0.11 + x * 0.07) * (1 - Math.abs(y) / radius)
      position.setXYZ(i, x * width * wobble, y * height, z * width * wobble)
    }
    position.needsUpdate = true
    if (detail !== 'far') geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
    atmosphere.scale.set(width, height, width)
    seam.scale.set(width, width, height)
    softBands.scale.set(width, height, width)
    body.rotation.z = Math.sin(time * 1.7) * 0.035
  }
  return parts
}

function droneMotif(radius: number, color: number): MotifParts {
  const parts = baseParts(radius, color)
  const patrolRing = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 1.45, radius * 0.018, 5, 56),
    new THREE.MeshBasicMaterial({ color: 0xffd0a3, transparent: true, opacity: 0.7 }),
  )
  patrolRing.rotation.x = 1.1
  parts.group.add(patrolRing)
  const drones: THREE.Group[] = []
  for (let i = 0; i < 5; i++) {
    const drone = new THREE.Group()
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.075, 8, 6),
      createSpaceToonMaterial(planetToonPalette(0xfce4c8)),
    )
    const wing = new THREE.Mesh(
      new THREE.BoxGeometry(radius * 0.25, radius * 0.02, radius * 0.045),
      new THREE.MeshBasicMaterial({ color: 0x33213d }),
    )
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.027, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0x6cecff }),
    )
    beacon.position.z = radius * 0.08
    drone.add(shell, wing, beacon)
    ;(i < 3 ? parts.group : parts.mid).add(drone)
    drones.push(drone)
  }
  parts.animate = time => {
    patrolRing.rotation.z = time * 0.09
    const formation = (1 + Math.sin(time * 0.4)) * 0.5
    drones.forEach((drone, i) => {
      const angle = time * 0.2 + i * Math.PI * 0.4
      const orbit = new THREE.Vector3(
        Math.cos(angle) * radius * 1.5,
        Math.sin(angle * 0.7) * radius * 0.42,
        Math.sin(angle) * radius * 1.5,
      )
      const vShape = new THREE.Vector3(
        (i - 2) * radius * 0.38,
        (2 - Math.abs(i - 2)) * radius * 0.18,
        radius * (1.25 + Math.abs(i - 2) * 0.3),
      )
      drone.position.copy(orbit.lerp(vShape, formation * 0.65))
      drone.rotation.y = -angle + Math.PI / 2
    })
  }
  return parts
}

function gravityMotif(radius: number): MotifParts {
  const parts: MotifParts = {
    group: new THREE.Group(),
    mid: new THREE.Group(),
    near: new THREE.Group(),
    animate: () => undefined,
  }

  // Keep the event horizon truly black. The disk sits on a tilted plane, so its
  // far half disappears behind the sphere while the near half crosses in front.
  const darkCore = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.84, 32, 20),
    new THREE.MeshBasicMaterial({ color: 0x01030a, toneMapped: false }),
  )
  darkCore.frustumCulled = false
  parts.group.add(darkCore)

  // A facing frame makes the silhouette legible from every flight direction.
  // The disk still has real depth inside that frame and is occluded by the core.
  const facing = new THREE.Group()
  parts.group.add(facing)
  darkCore.onBeforeRender = (_renderer, _scene, camera) => {
    facing.quaternion.copy(camera.quaternion)
    facing.updateMatrixWorld(true)
  }

  const accretion = new THREE.Group()
  accretion.rotation.x = -1.2
  facing.add(accretion)

  const diskGeometry = new THREE.RingGeometry(radius * 0.9, radius * 2.15, 128, 8)
  const positions = diskGeometry.getAttribute('position')
  const colors = new Float32Array(positions.count * 3)
  const hot = new THREE.Color(0xffeac0)
  const amber = new THREE.Color(0xffa553)
  const ember = new THREE.Color(0x913a40)
  const tint = new THREE.Color()
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i)
    const y = positions.getY(i)
    const distance = Math.hypot(x, y) / radius
    const radial = THREE.MathUtils.clamp((distance - 0.9) / 1.25, 0, 1)
    if (radial < 0.42) tint.copy(hot).lerp(amber, radial / 0.42)
    else tint.copy(amber).lerp(ember, (radial - 0.42) / 0.58)
    const angle = Math.atan2(y, x)
    const streak = 0.83 + 0.17 * Math.sin(angle * 9 + radial * 17)
    const brightSide = 0.75 + 0.25 * Math.cos(angle - 0.55)
    tint.multiplyScalar(streak * brightSide)
    colors[i * 3] = tint.r
    colors[i * 3 + 1] = tint.g
    colors[i * 3 + 2] = tint.b
  }
  diskGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  const disk = new THREE.Mesh(
    diskGeometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  )
  accretion.add(disk)

  const streamers = new THREE.Group()
  for (let i = 0; i < 4; i++) {
    const filament = new THREE.Mesh(
      new THREE.TorusGeometry(radius * (1.09 + i * 0.21), radius * (i === 0 ? 0.026 : 0.013), 5, 54, Math.PI * (0.62 + i * 0.12)),
      new THREE.MeshBasicMaterial({
        color: i === 0 ? 0xffe9bd : 0xffa55a,
        transparent: true,
        opacity: i === 0 ? 0.9 : 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    )
    filament.rotation.z = i * 1.67
    streamers.add(filament)
  }
  accretion.add(streamers)

  // The two lifted arcs suggest light bent above and below the horizon. Their
  // broad translucent underlay supplies a soft glow without a postprocess pass.
  for (const upper of [true, false]) {
    const sign = upper ? 1 : -1
    const curve = new THREE.CubicBezierCurve3(
      new THREE.Vector3(-radius * 1.58, sign * radius * 0.16, radius * 0.16),
      new THREE.Vector3(-radius * 0.94, sign * radius * 1.48, radius * 0.16),
      new THREE.Vector3(radius * 0.94, sign * radius * 1.48, radius * 0.16),
      new THREE.Vector3(radius * 1.58, sign * radius * 0.16, radius * 0.16),
    )
    const arcGeometry = new THREE.TubeGeometry(curve, 64, radius * (upper ? 0.045 : 0.035), 6, false)
    const glow = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 64, radius * 0.12, 6, false),
      new THREE.MeshBasicMaterial({
        color: upper ? 0xffaa60 : 0xff7848,
        transparent: true,
        opacity: 0.19,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    )
    const arc = new THREE.Mesh(
      arcGeometry,
      new THREE.MeshBasicMaterial({
        color: upper ? 0xffe1a0 : 0xffa260,
        transparent: true,
        opacity: upper ? 0.86 : 0.66,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    )
    facing.add(glow, arc)
  }

  const photonGlow = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.9, radius * 0.105, 8, 96),
    new THREE.MeshBasicMaterial({
      color: 0xff8b4e,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  )
  const photonRing = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.9, radius * 0.025, 6, 96),
    new THREE.MeshBasicMaterial({
      color: 0xffcd82,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  )
  photonGlow.position.z = radius * 0.08
  photonRing.position.z = radius * 0.09
  facing.add(photonGlow, photonRing)
  facing.traverse(object => {
    // The facing transform is refreshed at draw time, after frustum collection.
    if (object instanceof THREE.Mesh) object.frustumCulled = false
  })

  const stones = new THREE.Group()
  const rockGeometry = new THREE.IcosahedronGeometry(radius * 0.045, 0)
  const rockMaterial = createSpaceToonMaterial(planetToonPalette(0x9c8290))
  for (let i = 0; i < 8; i++) {
    const rock = new THREE.Mesh(rockGeometry, rockMaterial)
    const angle = i * 2.39996
    const distance = radius * (2.24 + (i % 3) * 0.13)
    rock.position.set(Math.cos(angle) * distance, Math.sin(i * 1.4) * radius * 0.12, Math.sin(angle) * distance)
    stones.add(rock)
  }
  parts.mid.add(stones)
  parts.animate = time => {
    streamers.rotation.z = time * 0.11
    stones.rotation.y = -time * 0.045
  }
  return parts
}

function warfrontMotif(radius: number, color: number): MotifParts {
  const parts = baseParts(radius, color, new THREE.IcosahedronGeometry(radius, 2))
  const shield = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(radius * 1.08, 1)),
    new THREE.LineBasicMaterial({ color: 0x93d9ff, transparent: true, opacity: 0.58 }),
  )
  parts.group.add(shield)
  const shieldNodes = new THREE.Group()
  for (let i = 0; i < 8; i++) {
    const node = new THREE.Mesh(
      new THREE.TetrahedronGeometry(radius * 0.075),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0xb9efff : 0x5fa3ff }),
    )
    node.position.copy(spherePoint(radius * 1.1, Math.sin(i * 2.1) * 0.5, i * 2.4))
    shieldNodes.add(node)
  }
  parts.mid.add(shieldNodes)
  const tracers = Array.from({ length: 3 }, (_, i) => {
    const tracer = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.028, 6, 5),
      new THREE.MeshBasicMaterial({ color: i === 0 ? 0xffbd69 : 0xa9eaff }),
    )
    parts.near.add(tracer)
    return tracer
  })
  const tracerArcs = Array.from({ length: 3 }, (_, i) => {
    const points = Array.from({ length: 14 }, (_, step) => {
      const angle = -0.27 + step * (0.54 / 13)
      return spherePoint(radius * 1.145, (i - 1) * 0.33 + Math.sin(angle * 2) * 0.05, angle)
    })
    const arc = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: i === 0 ? 0xffbd69 : 0xa9eaff, transparent: true, opacity: 0.74 }),
    )
    parts.near.add(arc)
    return arc
  })
  parts.animate = time => {
    shield.rotation.y = time * 0.04
    shieldNodes.rotation.y = time * 0.04
    tracers.forEach((tracer, i) => {
      const angle = time * (0.5 + i * 0.12) + i * 2.1
      tracer.position.copy(spherePoint(radius * 1.14, Math.sin(angle * 0.7) * 0.43, angle))
      tracerArcs[i].rotation.y = angle
    })
  }
  return parts
}

function bitboardMotif(radius: number, color: number): MotifParts {
  const parts = baseParts(radius, color, new THREE.IcosahedronGeometry(radius, 1))
  const grid = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(radius * 1.045, 1)),
    new THREE.LineBasicMaterial({ color: 0xf8ffc8, transparent: true, opacity: 0.68 }),
  )
  parts.group.add(grid)
  const tileGeometry = new THREE.BoxGeometry(radius * 0.16, radius * 0.025, radius * 0.16)
  const tileMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
  const tiles = new THREE.InstancedMesh(tileGeometry, tileMaterial, 40)
  const dummy = new THREE.Object3D()
  for (let i = 0; i < 40; i++) {
    const lat = -0.9 + Math.floor(i / 8) * 0.45
    const lon = (i % 8) * Math.PI * 0.25 + (Math.floor(i / 8) % 2) * 0.11
    dummy.position.copy(spherePoint(radius * 1.025, lat, lon))
    dummy.quaternion.setFromUnitVectors(UP, dummy.position.clone().normalize())
    dummy.updateMatrix()
    tiles.setMatrixAt(i, dummy.matrix)
    tiles.setColorAt(i, (i + Math.floor(i / 8)) % 2 ? new THREE.Color(0x202a32) : new THREE.Color(0xf5f99b))
  }
  parts.mid.add(tiles)
  const binaryGlyphs: THREE.Object3D[] = []
  for (let i = 0; i < 8; i++) {
    const glyph = i % 2
      ? new THREE.Mesh(
        new THREE.BoxGeometry(radius * 0.025, radius * 0.14, radius * 0.025),
        new THREE.MeshBasicMaterial({ color: 0xf6ffc1 }),
      )
      : new THREE.Mesh(
        new THREE.TorusGeometry(radius * 0.07, radius * 0.014, 4, 12),
        new THREE.MeshBasicMaterial({ color: 0xf6ffc1 }),
      )
    const normal = spherePoint(1, 0.65, (i / 8) * Math.PI * 2)
    glyph.position.copy(normal).multiplyScalar(radius * 1.13)
    glyph.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
    parts.near.add(glyph)
    binaryGlyphs.push(glyph)
  }
  let lastFrame = -1
  parts.animate = time => {
    grid.rotation.y = time * 0.035
    const frame = Math.floor(time * 0.6)
    if (frame !== lastFrame) {
      lastFrame = frame
      for (let i = 0; i < 40; i += 5) {
        const on = ((frame + i / 5) % 3) !== 0
        tiles.setColorAt(i, new THREE.Color(on ? 0xf5f99b : 0x202a32))
      }
      if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true
      binaryGlyphs.forEach((glyph, i) => { glyph.visible = (frame + i) % 4 !== 0 })
    }
  }
  return parts
}

function farmMotif(radius: number, color: number): MotifParts {
  const parts = baseParts(radius, color, new THREE.SphereGeometry(radius, 16, 10))
  const fields = new THREE.Group()
  const fieldGeometry = new THREE.BoxGeometry(radius * 0.2, radius * 0.022, radius * 0.17)
  const fieldColors = [0x155b46, 0x77d988, 0xc5da64, 0x6c9b55]
  const materials = fieldColors.map(value => new THREE.MeshBasicMaterial({ color: value }))
  for (let i = 0; i < 32; i++) {
    const patch = new THREE.Mesh(fieldGeometry, materials[(i + Math.floor(i / 8)) % materials.length])
    const latitude = -0.82 + Math.floor(i / 8) * 0.54
    const longitude = (i % 8) * Math.PI * 0.25
    attachToSurface(patch, radius * 1.01, latitude, longitude)
    fields.add(patch)
  }
  parts.group.add(fields)
  const farms = new THREE.Group()
  const cropGeometry = new THREE.BoxGeometry(radius * 0.1, radius * 0.11, radius * 0.1)
  const cropMaterial = new THREE.MeshBasicMaterial({ color: 0xf7d88c })
  for (let i = 0; i < 7; i++) {
    const crop = new THREE.Mesh(cropGeometry, cropMaterial)
    attachToSurface(crop, radius * 1.08, Math.sin(i * 2.2) * 0.42, i * 2.6)
    farms.add(crop)
  }
  parts.mid.add(farms)
  const terminator = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.032, 16, 10, 0, Math.PI),
    new THREE.MeshBasicMaterial({ color: 0x061b29, transparent: true, opacity: 0.36, depthWrite: false, side: THREE.DoubleSide }),
  )
  parts.mid.add(terminator)
  parts.animate = time => {
    fields.rotation.y = time * 0.035
    farms.rotation.y = time * 0.035
    terminator.rotation.y = -time * 0.12
  }
  return parts
}

function materialMotif(radius: number, color: number): MotifParts {
  const parts = baseParts(radius, 0xb3e4df)
  const seamPoints: THREE.Vector3[] = []
  for (let i = 0; i <= 40; i++) {
    const lat = -Math.PI * 0.48 + (i / 40) * Math.PI * 0.96
    seamPoints.push(spherePoint(radius * 1.028, lat, 0.5))
  }
  const seam = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(seamPoints),
    new THREE.LineBasicMaterial({ color: 0x15a99d, linewidth: 2 }),
  )
  parts.group.add(seam)
  const linking = new THREE.Group()
  const nodePositions = [
    [-0.58, -0.1], [-0.27, 0.48], [0.1, 0.02], [0.46, 0.63], [0.72, -0.2],
  ] as const
  const points = nodePositions.map(([lat, lon]) => spherePoint(radius * 1.085, lat, lon))
  for (let i = 0; i < points.length; i++) {
    const node = new THREE.Mesh(
      new THREE.SphereGeometry(radius * (i === 2 ? 0.073 : 0.05), 8, 6),
      new THREE.MeshBasicMaterial({ color: i === 2 ? 0xffdb93 : 0x50efde }),
    )
    node.position.copy(points[i])
    linking.add(node)
    if (i > 0) {
      const link = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([points[i - 1], points[i]]),
        new THREE.LineBasicMaterial({ color: 0xffdfad, transparent: true, opacity: 0.77 }),
      )
      linking.add(link)
    }
  }
  parts.mid.add(linking)
  const uvRing = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 1.38, radius * 0.025, 5, 56),
    new THREE.MeshBasicMaterial({ color }),
  )
  uvRing.rotation.x = 1.0
  parts.group.add(uvRing)
  parts.animate = time => {
    linking.rotation.y = time * 0.045
    uvRing.rotation.z = time * 0.07
  }
  return parts
}

function outline(mesh: THREE.Mesh, width: number): void {
  const shell = new THREE.Mesh(
    mesh.geometry,
    new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide, toneMapped: false }),
  )
  shell.name = 'Ink silhouette'
  shell.scale.setScalar(1 + width)
  shell.renderOrder = -1
  mesh.add(shell)
}

function attachToSurface(mesh: THREE.Mesh, radius: number, latitude: number, longitude: number): void {
  mesh.position.copy(spherePoint(radius, latitude, longitude))
  mesh.quaternion.setFromUnitVectors(UP, mesh.position.clone().normalize())
}

function spherePoint(radius: number, latitude: number, longitude: number): THREE.Vector3 {
  const ring = Math.cos(latitude) * radius
  return new THREE.Vector3(
    Math.cos(longitude) * ring,
    Math.sin(latitude) * radius,
    Math.sin(longitude) * ring,
  )
}

function latitudeRing(radius: number, latitude: number, segments: number): THREE.Vector3[] {
  return Array.from({ length: segments }, (_, i) => spherePoint(radius, latitude, (i / segments) * Math.PI * 2))
}

function ease(value: number): number {
  const t = THREE.MathUtils.clamp(value, 0, 1)
  return t * t * (3 - 2 * t)
}

function disposeGraph(group: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  group.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
      geometries.add(object.geometry)
      const list = Array.isArray(object.material) ? object.material : [object.material]
      list.forEach(material => materials.add(material))
    }
  })
  geometries.forEach(geometry => geometry.dispose())
  materials.forEach(material => material.dispose())
}
