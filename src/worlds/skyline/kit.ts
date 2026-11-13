import * as THREE from 'three'

// Shared building kit for hand-modelled Nju Jork landmarks. World units are blocks
// (3 m each); y = 0 is street level; Manhattan avenues run along the world Z axis.
// Every box is collected into one InstancedMesh per facade style, so the whole
// skyline costs a handful of draw calls however many towers are modelled.

/** Facade looks. Textured styles map windows in world space, so floors line up across boxes. */
export type Style =
  | 'plain' // flat colour, shaded by face (roofs, trims, spires, frames)
  | 'stone' // masonry wall with faint coursing, no windows
  | 'masonry' // stone or brick wall with punched windows (historic towers)
  | 'glass' // curtain wall: glass panes with thin mullions and spandrels
  | 'grid' // square punched grid (432 Park Avenue, concrete frames)
  | 'ribbon' // horizontal strip windows between solid spandrels
  | 'lit' // unshaded bright colour (crown lights, neon, screen frames)

/** World rectangle [minX, minZ, maxX, maxZ] in blocks. */
export type Rect = [number, number, number, number]

/** A rectangle inside an ad texture atlas, in UV space (origin bottom-left). */
export type AdSlot = { u: number; v: number; w: number; h: number; aspect: number }

type Instance = { style: Style; color: THREE.Color; matrix: THREE.Matrix4 }

const BLOCK_METRES = 3
/** Blocks per metre: divide real-world metres by 3. */
export const m = (metres: number) => metres / BLOCK_METRES

const scratchPosition = new THREE.Vector3()
const scratchQuaternion = new THREE.Quaternion()
const scratchScale = new THREE.Vector3()
const yAxis = new THREE.Vector3(0, 1, 0)

/** Collects boxes. Use `frame()` to work in a tower's own (optionally rotated) coordinates. */
export class SkylineBuilder {
  readonly instances: Instance[] = []

  /** Box centred on (x, z), from y0 up h blocks, size w (x) × d (z), turned `rotation` radians about Y. */
  box(style: Style, color: number, x: number, y0: number, z: number, w: number, h: number, d: number, rotation = 0) {
    if (w <= 0 || h <= 0 || d <= 0) return
    scratchPosition.set(x, y0 + h / 2, z)
    scratchQuaternion.setFromAxisAngle(yAxis, rotation)
    scratchScale.set(w, h, d)
    this.instances.push({
      style,
      color: new THREE.Color(color),
      matrix: new THREE.Matrix4().compose(scratchPosition, scratchQuaternion, scratchScale),
    })
  }

  /** Local coordinates centred on (cx, cz), turned `rotation` radians about Y (same sense as Object3D.rotation.y). */
  frame(cx: number, cz: number, rotation = 0) {
    return new Frame(this, cx, cz, rotation)
  }

  get count() {
    return this.instances.length
  }
}

/** Tower-local helper: x/z are local, y is world height. */
export class Frame {
  readonly builder: SkylineBuilder
  readonly cx: number
  readonly cz: number
  readonly rotation: number
  private readonly cos: number
  private readonly sin: number

  constructor(builder: SkylineBuilder, cx: number, cz: number, rotation: number) {
    this.builder = builder
    this.cx = cx
    this.cz = cz
    this.rotation = rotation
    this.cos = Math.cos(rotation)
    this.sin = Math.sin(rotation)
  }

  /** Local point → world [x, z]. */
  world(x: number, z: number): [number, number] {
    return [this.cx + x * this.cos + z * this.sin, this.cz - x * this.sin + z * this.cos]
  }

  /** Nested frame, e.g. a wing or a rotated crown. */
  frame(x: number, z: number, rotation = 0) {
    const [wx, wz] = this.world(x, z)
    return new Frame(this.builder, wx, wz, this.rotation + rotation)
  }

  box(style: Style, color: number, x: number, y0: number, z: number, w: number, h: number, d: number, rotation = 0) {
    const [wx, wz] = this.world(x, z)
    this.builder.box(style, color, wx, y0, wz, w, h, d, this.rotation + rotation)
  }

  /** A centred block from y0 to y1. */
  tier(style: Style, color: number, w: number, d: number, y0: number, y1: number, x = 0, z = 0) {
    this.box(style, color, x, y0, z, w, y1 - y0, d)
  }

  /** Wedding-cake setbacks: each [width, depth, topY] starts where the previous one ended. Returns the top. */
  setbacks(style: Style, color: number, tiers: [number, number, number][], y0 = 0) {
    let base = y0
    for (const [w, d, top] of tiers) {
      this.tier(style, color, w, d, base, top)
      base = top
    }
    return base
  }

  /** Linear taper from (w0, d0) at y0 to (w1, d1) at y1 in `steps` stacked boxes. */
  taper(style: Style, color: number, w0: number, d0: number, w1: number, d1: number, y0: number, y1: number, steps: number) {
    const count = Math.max(1, Math.round(steps))
    for (let i = 0; i < count; i++) {
      const t = (i + .5) / count
      this.tier(style, color, w0 + (w1 - w0) * t, d0 + (d1 - d0) * t, y0 + (y1 - y0) * i / count, y0 + (y1 - y0) * (i + 1) / count)
    }
  }

  /** Vertical piers standing proud of all four faces of a w × d block (Art Deco ribs, mullion fins). */
  piers(style: Style, color: number, w: number, d: number, y0: number, y1: number, spacing: number, depth = .25, width = .3) {
    const h = y1 - y0
    for (const [length, along] of [[w, 'x'], [d, 'z']] as const) {
      const count = Math.max(1, Math.floor(length / spacing))
      for (let i = 0; i <= count; i++) {
        const offset = -length / 2 + (length * i) / count
        if (along === 'x') {
          this.box(style, color, offset, y0, d / 2 + depth / 2, width, h, depth)
          this.box(style, color, offset, y0, -d / 2 - depth / 2, width, h, depth)
        } else {
          this.box(style, color, w / 2 + depth / 2, y0, offset, depth, h, width)
          this.box(style, color, -w / 2 - depth / 2, y0, offset, depth, h, width)
        }
      }
    }
  }

  /** A cornice or belt course: a slightly larger slab around a w × d block. */
  band(style: Style, color: number, w: number, d: number, y: number, h: number, overhang = .2) {
    this.tier(style, color, w + overhang * 2, d + overhang * 2, y, y + h)
  }

  /** Stepped spire: `steps` shrinking boxes from base width w0, then a thin mast to y0 + h. */
  spire(color: number, y0: number, h: number, w0: number, steps = 5, x = 0, z = 0, style: Style = 'plain') {
    const body = h * .55
    for (let i = 0; i < steps; i++) {
      const width = w0 * (1 - i / (steps + 1))
      this.box(style, color, x, y0 + (body * i) / steps, z, width, body / steps, width)
    }
    const mast = Math.max(.12, w0 * .12)
    this.box(style, color, x, y0 + body, z, mast, h - body, mast)
  }
}

/** One modelled landmark. `far` holds massing visible across the city; `near` holds detail for close views. */
export type TowerDef = {
  id: string
  name: string
  /** road-network.json building id this model replaces, when there is one */
  buildingId?: string
  /** World centre (blocks) used for markers and camera jumps */
  x: number
  z: number
  /** Highest point in blocks (roof, crown or spire) */
  height: number
  /** Footprint rectangles whose raster blocks are flattened so the model replaces them */
  cutouts: Rect[]
  build(far: SkylineBuilder, near: SkylineBuilder): void
}

// ---------------------------------------------------------------- materials

function canvasTexture(size: number, draw: (context: CanvasRenderingContext2D, size: number) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')!
  draw(context, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.NearestFilter
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

// Each texture is white where the instance colour should show and darker where glass is,
// so one texture serves every tint. `repeat` is texture tiles per block (u along the wall, v up it).
const TEXTURES: Partial<Record<Style, { repeat: [number, number]; draw: (c: CanvasRenderingContext2D, s: number) => void }>> = {
  stone: {
    repeat: [1 / 2, 1 / 1.2],
    draw: (c, s) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, s, s)
      c.fillStyle = '#e4e4e4'; c.fillRect(0, s - 1, s, 1); c.fillRect(s / 2, 0, 1, s)
    },
  },
  masonry: {
    // one floor (1.2 blocks) × two bays (1.5 blocks): two tall punched windows
    repeat: [1 / 1.5, 1 / 1.2],
    draw: (c, s) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, s, s)
      c.fillStyle = '#4a5866'; c.fillRect(s * .14, s * .2, s * .26, s * .58); c.fillRect(s * .6, s * .2, s * .26, s * .58)
      c.fillStyle = '#6f8090'; c.fillRect(s * .14, s * .2, s * .26, s * .12); c.fillRect(s * .6, s * .2, s * .26, s * .12)
    },
  },
  glass: {
    // one floor × one 1-block module: pane, thin mullion, darker spandrel band
    repeat: [1, 1 / 1.2],
    draw: (c, s) => {
      c.fillStyle = '#c9d4de'; c.fillRect(0, 0, s, s)
      c.fillStyle = '#a7b6c4'; c.fillRect(0, s * .8, s, s * .2)
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, 1, s); c.fillRect(0, s * .8, s, 1)
      c.fillStyle = '#e3ebf2'; c.fillRect(s * .1, s * .08, s * .35, s * .1)
    },
  },
  grid: {
    // square punched openings in a white frame, 1 × 1 block
    repeat: [1, 1],
    draw: (c, s) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, s, s)
      c.fillStyle = '#3e4c58'; c.fillRect(s * .16, s * .16, s * .68, s * .68)
      c.fillStyle = '#5d6f7f'; c.fillRect(s * .16, s * .16, s * .68, s * .14)
    },
  },
  ribbon: {
    repeat: [1, 1 / 1.2],
    draw: (c, s) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, s, s)
      c.fillStyle = '#44525e'; c.fillRect(0, s * .1, s, s * .55)
      c.fillStyle = '#5c6c7a'; c.fillRect(0, s * .1, s, s * .1)
    },
  },
}

const SHADE_TOP = 1
const SHADE_BOTTOM = .55
const SHADE_SIDE_X = .74
const SHADE_SIDE_Z = .88

function shadedBox(lit: boolean) {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const normals = geometry.getAttribute('normal')
  const colors: number[] = []
  for (let i = 0; i < normals.count; i++) {
    const ny = normals.getY(i)
    const shade = lit ? 1 : ny > .5 ? SHADE_TOP : ny < -.5 ? SHADE_BOTTOM : Math.abs(normals.getX(i)) > .5 ? SHADE_SIDE_X : SHADE_SIDE_Z
    colors.push(shade, shade, shade)
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geometry
}

let solidBox: THREE.BoxGeometry | null = null
let litBox: THREE.BoxGeometry | null = null
const materials = new Map<Style, THREE.MeshBasicMaterial>()

/** Replaces the map UV with world-space coordinates: along the wall and up it for sides, x/z for roofs. */
function useWorldUv(material: THREE.MeshBasicMaterial, repeat: [number, number], key: string) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
#ifdef USE_MAP
  #ifdef USE_INSTANCING
    mat4 skylineModel = modelMatrix * instanceMatrix;
  #else
    mat4 skylineModel = modelMatrix;
  #endif
  vec3 skylineWorld = ( skylineModel * vec4( position, 1.0 ) ).xyz;
  vec3 skylineNormal = normalize( mat3( skylineModel ) * normal );
  vec2 skylineUv;
  if ( abs( skylineNormal.y ) > 0.5 ) {
    skylineUv = skylineWorld.xz;
  } else {
    vec3 skylineAlong = normalize( vec3( -skylineNormal.z, 0.0, skylineNormal.x ) );
    skylineUv = vec2( dot( skylineWorld, skylineAlong ), skylineWorld.y );
  }
  vMapUv = skylineUv * vec2( ${repeat[0].toFixed(5)}, ${repeat[1].toFixed(5)} );
#endif`)
  }
  material.customProgramCacheKey = () => `skyline-world-uv-${key}`
}

function materialFor(style: Style) {
  let material = materials.get(style)
  if (material) return material
  const spec = TEXTURES[style]
  material = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true })
  if (spec) {
    material.map = canvasTexture(16, spec.draw)
    useWorldUv(material, spec.repeat, style)
  }
  materials.set(style, material)
  return material
}

/** One InstancedMesh per style for everything the builder collected. */
export function buildInstances(builder: SkylineBuilder, name: string): THREE.Group {
  solidBox ??= shadedBox(false)
  litBox ??= shadedBox(true)
  const group = new THREE.Group()
  group.name = name
  const byStyle = new Map<Style, Instance[]>()
  for (const instance of builder.instances) {
    const list = byStyle.get(instance.style) ?? []
    list.push(instance)
    byStyle.set(instance.style, list)
  }
  for (const [style, list] of byStyle) {
    const mesh = new THREE.InstancedMesh(style === 'lit' ? litBox : solidBox, materialFor(style), list.length)
    mesh.name = `${name} · ${style}`
    list.forEach((instance, index) => {
      mesh.setMatrixAt(index, instance.matrix)
      mesh.setColorAt(index, instance.color)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    group.add(mesh)
  }
  return group
}

// ---------------------------------------------------------------- ad panels

/** A flat ad or screen: centre (x, y, z), size w × h, facing +Z turned `rotation` radians about Y. */
export type AdPanel = { x: number; y: number; z: number; w: number; h: number; rotation: number; slot: AdSlot }

const panelMaterials = new WeakMap<THREE.Texture, THREE.MeshBasicMaterial>()

/** Unlit textured material that reads each instance's atlas rectangle from the `adRect` attribute. */
export function adPanelMaterial(texture: THREE.Texture) {
  let material = panelMaterials.get(texture)
  if (material) return material
  material = new THREE.MeshBasicMaterial({ map: texture, fog: true, side: THREE.FrontSide })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'attribute vec4 adRect;\nvoid main() {')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = adRect.xy + uv * adRect.zw;\n#endif')
  }
  material.customProgramCacheKey = () => 'skyline-ad-panel'
  panelMaterials.set(texture, material)
  return material
}

/** Instanced ad panels sharing one atlas texture. Returns null for an empty list. */
export function buildAdPanels(panels: AdPanel[], texture: THREE.Texture, name: string): THREE.InstancedMesh | null {
  if (!panels.length) return null
  const geometry = new THREE.PlaneGeometry(1, 1)
  const rects = new Float32Array(panels.length * 4)
  const mesh = new THREE.InstancedMesh(geometry, adPanelMaterial(texture), panels.length)
  mesh.name = name
  panels.forEach((panel, index) => {
    scratchPosition.set(panel.x, panel.y, panel.z)
    scratchQuaternion.setFromAxisAngle(yAxis, panel.rotation)
    scratchScale.set(panel.w, panel.h, 1)
    mesh.setMatrixAt(index, new THREE.Matrix4().compose(scratchPosition, scratchQuaternion, scratchScale))
    rects.set([panel.slot.u, panel.slot.v, panel.slot.w, panel.slot.h], index * 4)
  })
  geometry.setAttribute('adRect', new THREE.InstancedBufferAttribute(rects, 4))
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
  return mesh
}

/** Frees per-group geometry; shared materials and textures stay cached. */
export function disposeSkylineGroup(group: THREE.Object3D) {
  group.traverse((item) => {
    if (item instanceof THREE.InstancedMesh) {
      if (item.geometry !== solidBox && item.geometry !== litBox) item.geometry.dispose()
      item.dispose()
    }
  })
}
