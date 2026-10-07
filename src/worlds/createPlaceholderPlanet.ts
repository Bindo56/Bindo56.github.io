import {
  AmbientLight,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Material,
} from 'three'
import type {
  PlanetDefinition,
  PlanetModule,
  PlanetSession,
  PreparedPlanet,
} from '../app/PlanetContracts.ts'
import type { PlanetSlug } from './registry.ts'

interface PreparedPlaceholder extends PreparedPlanet {
  body: Group
  accents: Group
}

const up = new Vector3(0, 1, 0)

/** A lightweight arrival vignette. Gameplay is intentionally reserved for each later world plan. */
export function createPlaceholderPlanet(slug: PlanetSlug): PlanetModule {
  return {
    async prepare(definition: PlanetDefinition, signal: AbortSignal): Promise<PreparedPlanet> {
      if (signal.aborted) throw new DOMException('Planet preparation cancelled', 'AbortError')
      await Promise.resolve()
      if (signal.aborted) throw new DOMException('Planet preparation cancelled', 'AbortError')

      const scene = new Scene()
      scene.background = new Color(0x080e1c)
      const camera = new PerspectiveCamera(50, 1, 0.1, 80)
      camera.position.set(0, 2.6, 12.5)
      camera.lookAt(0, 0, 0)

      const ambient = new AmbientLight(0xffffff, 1.2)
      const sun = new DirectionalLight(0xffffff, 2.2)
      sun.position.set(5, 8, 7)
      scene.add(ambient, sun)

      const body = new Group()
      const accents = new Group()
      scene.add(body, accents)
      const baseColor = slug === 'event-horizon' ? 0x111221 : definition.color
      body.add(new Mesh(
        new IcosahedronGeometry(3.2, slug === 'pixel-farm' || slug === 'bitboard' ? 1 : 3),
        new MeshStandardMaterial({ color: baseColor, flatShading: true, metalness: 0.12, roughness: 0.76 }),
      ))
      decorate(slug, definition.color, body, accents)

      let disposed = false
      const prepared: PreparedPlaceholder = {
        scene,
        camera,
        body,
        accents,
        dispose() {
          if (disposed) return
          disposed = true
          scene.traverse((object) => {
            if (!(object instanceof Mesh)) return
            object.geometry.dispose()
            const materials: Material[] = Array.isArray(object.material) ? object.material : [object.material]
            materials.forEach((material) => material.dispose())
          })
          scene.clear()
        },
      }
      return prepared
    },
    mount(prepared: PreparedPlanet): PlanetSession {
      const placeholder = prepared as PreparedPlaceholder
      let elapsed = 0
      return {
        scene: placeholder.scene,
        camera: placeholder.camera,
        update(dt: number) {
          elapsed += Math.min(dt, 0.1)
          placeholder.body.rotation.y += dt * 0.12
          placeholder.accents.rotation.y -= dt * 0.07
          placeholder.accents.position.y = Math.sin(elapsed * 0.7) * 0.08
        },
        dispose() {
          placeholder.dispose()
        },
      }
    },
  }
}

function decorate(slug: PlanetSlug, color: number, body: Group, accents: Group): void {
  const accent = new MeshStandardMaterial({ color: 0xf4fbff, emissive: color, emissiveIntensity: 0.28, roughness: 0.46 })
  const dark = new MeshStandardMaterial({ color: 0x16253b, roughness: 0.85 })
  const accent2 = new MeshStandardMaterial({ color: color === 0xd6dc52 ? 0x253341 : color, roughness: 0.7 })

  if (slug === 'event-horizon') {
    for (const [radius, tilt] of [[4.2, 0.35], [5.1, -0.4]] as const) {
      const ring = new Mesh(new TorusGeometry(radius, 0.14, 8, 80), accent2)
      ring.rotation.set(Math.PI / 2 + tilt, 0.25, 0)
      accents.add(ring)
    }
    const horizon = new Mesh(new SphereGeometry(3.05, 24, 16), dark)
    body.add(horizon)
    return
  }

  if (slug === 'stretch-squash') {
    for (let index = 0; index < 3; index++) {
      const ring = new Mesh(new TorusGeometry(3.5 + index * 0.42, 0.09, 8, 48), index % 2 ? accent : accent2)
      ring.rotation.set(Math.PI / 2.5, index * 0.7, index * 0.4)
      accents.add(ring)
    }
    return
  }

  if (slug === 'material-forge') {
    const ring = new Mesh(new TorusGeometry(4.6, 0.04, 6, 64), accent)
    ring.rotation.x = Math.PI / 2.4
    accents.add(ring)
    for (let index = 0; index < 8; index++) {
      const swatch = new Mesh(new SphereGeometry(0.28, 10, 8), new MeshStandardMaterial({
        color: new Color().setHSL(index / 8, 0.62, 0.55), metalness: index / 10, roughness: 0.2 + index / 12,
      }))
      const angle = index * Math.PI / 4
      swatch.position.set(Math.cos(angle) * 4.6, Math.sin(angle) * 1.4, Math.sin(angle) * 4)
      accents.add(swatch)
    }
    return
  }

  const count = slug === 'bitboard' ? 32 : slug === 'voxel' ? 24 : 16
  for (let index = 0; index < count; index++) {
    const normal = surfaceNormal(index, count, slug)
    const geometry = slug === 'drone-fleet'
      ? new ConeGeometry(0.18, 0.48, 4)
      : slug === 'npc-ecs' || slug === 'warfront'
        ? new CylinderGeometry(0.13, 0.23, 0.6 + (index % 4) * 0.18, 5)
        : slug === 'pixel-farm'
          ? new ConeGeometry(0.12, 0.45, 5)
          : new BoxGeometry(slug === 'bitboard' ? 0.48 : 0.38, slug === 'voxel' ? 0.38 + (index % 3) * 0.2 : 0.15, slug === 'bitboard' ? 0.48 : 0.38)
    const material = slug === 'bitboard' && index % 2 === 0 ? dark : index % 3 === 0 ? accent : accent2
    const marker = new Mesh(geometry, material)
    marker.position.copy(normal).multiplyScalar(3.24 + (slug === 'voxel' ? 0.18 : 0))
    marker.quaternion.setFromUnitVectors(up, normal)
    body.add(marker)
  }

  if (slug === 'drone-fleet' || slug === 'warfront') {
    const orbit = new Mesh(new TorusGeometry(4.3, 0.06, 6, 64), accent)
    orbit.rotation.x = Math.PI / 2.7
    accents.add(orbit)
  }
}

function surfaceNormal(index: number, count: number, slug: PlanetSlug): Vector3 {
  if (slug === 'bitboard') {
    const row = Math.floor(index / 8)
    const column = index % 8
    return new Vector3((column - 3.5) / 4.2, (row - 1.5) / 2.4, 1).normalize()
  }
  const y = 1 - (index / Math.max(1, count - 1)) * 2
  const ring = Math.sqrt(1 - y * y)
  const angle = index * Math.PI * (3 - Math.sqrt(5))
  return new Vector3(Math.cos(angle) * ring, y, Math.sin(angle) * ring)
}
