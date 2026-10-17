import { CITY_CELL_SIZE, CITY_DETAIL_CELL_SIZE, CITY_TRIM_CELL_SIZE, type CityBlueprint, type CityDefinition, type CityId, type VoxelCell } from './types.ts'

type Point = [number, number, number]
type Architecture = { walls: number[]; glass: number[]; lights: number[]; trim: number; plants: number[] }

/** Color families preserve a city's identity while giving every neighboring block its own facade. */
export const CITY_ARCHITECTURE: Record<CityId, Architecture> = {
  'neon-rift': { walls: [0x7055aa, 0xa2539a, 0x425f99, 0x9569be, 0x516f96], glass: [0x263858, 0x403454], lights: [0xff6fce, 0x76f1e7, 0xffcf72], trim: 0xd5a6ed, plants: [0x5e92b0, 0xb774d5] },
  'dune-halo': { walls: [0xf0d4b0, 0xe7b9a4, 0xd8d8cc, 0xc89790, 0xe9dcae], glass: [0x467d87, 0x5d657f], lights: [0xffd47e, 0xa4e1d5, 0xffa979], trim: 0xcf9b52, plants: [0x58a58a, 0x8fbb83] },
  tideglass: { walls: [0x62b4c4, 0x8ca8da, 0xb9dcd0, 0x6999b9, 0xb2c7e6], glass: [0x385e90, 0x474c84], lights: [0x8ef6e8, 0xc8b4ff, 0xffc7a3], trim: 0xd5e8df, plants: [0x70bda4, 0xa88acb] },
  cloudstack: { walls: [0x8296bf, 0xc58890, 0xbab4cb, 0x799d9a, 0xaaa0cf], glass: [0x3b506a, 0x465876], lights: [0xffd890, 0x9ed5ff, 0xffa7c9], trim: 0xd8c2a6, plants: [0x81b997, 0xa5b679] },
  'bloom-circuit': { walls: [0xe1ead2, 0xa4cdb8, 0xd6d4b5, 0x85b8b2, 0xc6ddc2], glass: [0x325c64, 0x45677b], lights: [0xa2ffc4, 0xffdc9e, 0xb9d5ff], trim: 0x79ae91, plants: [0x4d9e82, 0x79c388, 0xafd58a, 0xe994b9] },
  'ember-forge': { walls: [0x626c80, 0x8c645c, 0x77837f, 0x9c7b62, 0x4f5c70], glass: [0x323f50, 0x484659], lights: [0xffad5b, 0xff7259, 0x9bded1], trim: 0xc5b49a, plants: [0x9e7d8e, 0xc58d6d] },
}

const key = (x: number, y: number, z: number): string => `${x},${y},${z}`
const hash = (x: number, y: number, z: number): number => Math.abs((Math.imul(x + 37, 73856093) ^ Math.imul(y + 71, 19349663) ^ Math.imul(z + 13, 83492791)) >>> 0)
const point = (cell: VoxelCell): Point => [cell.x, cell.y, cell.z]

/** Details use smaller integer grids, but their parents always remain on the structural grid. */
class DetailLayer {
  readonly cells = new Map<string, VoxelCell>()
  readonly scale: number

  constructor(readonly cellSize: number, readonly budget: number) {
    this.scale = CITY_CELL_SIZE / cellSize
  }

  put(x: number, y: number, z: number, color: number, parent: VoxelCell, emissive = false): void {
    const gx = Math.round(x * this.scale)
    const gy = Math.round(y * this.scale)
    const gz = Math.round(z * this.scale)
    const id = key(gx, gy, gz)
    if (this.cells.size >= this.budget && !this.cells.has(id)) return
    this.cells.set(id, { x: gx, y: gy, z: gz, color, anchored: true, parent: point(parent), ...(emissive ? { emissive: true } : {}) })
  }

  box(from: Point, to: Point, color: number, parent: VoxelCell, emissive = false): void {
    const lo = from.map(value => Math.round(value * this.scale))
    const hi = to.map(value => Math.round(value * this.scale))
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      this.put(x / this.scale, y / this.scale, z / this.scale, color, parent, emissive)
    }
  }

  line(from: Point, to: Point, color: number, parent: VoxelCell, emissive = false): void {
    const steps = Math.max(1, ...from.map((value, axis) => Math.ceil(Math.abs(value - to[axis]) * this.scale)))
    for (let index = 0; index <= steps; index++) {
      const t = index / steps
      this.put(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t, color, parent, emissive)
    }
  }
}

export function buildCityDetails(definition: CityDefinition, coarse: VoxelCell[]): NonNullable<CityBlueprint['details']> {
  const fine = new DetailLayer(CITY_DETAIL_CELL_SIZE, 4900)
  const trim = new DetailLayer(CITY_TRIM_CELL_SIZE, 1450)
  const blocks = new Map(coarse.map(cell => [key(cell.x, cell.y, cell.z), cell]))
  const style = CITY_ARCHITECTURE[definition.id]
  const p = definition.palette
  const at = (x: number, y: number, z: number): VoxelCell | undefined => blocks.get(key(x, y, z))
  const highest = (x: number, z: number): VoxelCell | undefined => {
    for (let y = 24; y >= 0; y--) {
      const cell = at(x, y, z)
      if (cell) return cell
    }
    return undefined
  }

  const plant = (x: number, y: number, z: number, parent: VoxelCell, variant: number): void => {
    trim.box([x - 0.5, y, z - 0.5], [x + 0.5, y, z + 0.5], style.trim, parent)
    fine.line([x, y + 0.25, z], [x, y + 1.25, z], p.secondary, parent)
    for (const [dx, dz] of [[-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5]]) {
      fine.line([x, y + 1, z], [x + dx, y + 1.5, z + dz], style.plants[variant % style.plants.length], parent)
      fine.put(x + dx, y + 1.75, z + dz, style.lights[variant % style.lights.length], parent, true)
    }
    trim.put(x, y + 1.5, z, style.plants[(variant + 1) % style.plants.length], parent)
  }

  // Roof equipment is intentionally asymmetric, making each building readable as a small place.
  let plot = 0
  for (const x of [-11, -7, -3, 3, 7, 11]) for (const z of [-11, -7, -3, 3, 7, 11]) {
    if (x * x + z * z > 190 || (Math.abs(x) === 3 && Math.abs(z) === 3)) continue
    const parent = highest(x + 1, z) ?? highest(x, z)
    if (!parent || parent.y < 3) continue
    const y = parent.y + 0.5
    const mode = plot++ % 3
    if (definition.id === 'bloom-circuit' || (definition.id === 'cloudstack' && mode === 1)) {
      plant(parent.x, y, z, parent, plot)
      plant(parent.x - 1, y, z + 0.5, parent, plot + 1)
    } else if (definition.id === 'ember-forge' || mode === 0) {
      trim.box([parent.x - 0.5, y, z - 0.5], [parent.x + 0.5, y + 0.5, z + 0.5], p.dark, parent)
      for (const dz of [-0.25, 0.25]) fine.line([parent.x - 0.5, y + 0.75, z + dz], [parent.x + 0.5, y + 0.75, z + dz], style.trim, parent)
      fine.line([parent.x - 0.75, y, z + 0.75], [parent.x - 0.75, y + 2, z + 0.75], style.trim, parent)
      fine.put(parent.x - 0.75, y + 2.25, z + 0.75, style.lights[0], parent, true)
    } else {
      // Solar tiles with bright bus bars and separate little support feet.
      fine.box([parent.x - 0.5, y + 0.25, z - 0.75], [parent.x + 0.5, y + 0.25, z + 0.5], style.glass[0], parent)
      for (const dx of [-0.5, 0, 0.5]) fine.line([parent.x + dx, y + 0.5, z - 0.75], [parent.x + dx, y + 0.5, z + 0.5], style.lights[1], parent, true)
      trim.put(parent.x, y - 0.25, z, style.trim, parent)
    }
    if (definition.id === 'dune-halo') {
      fine.line([x - 0.5, y, z - 0.5], [x - 0.5, y + 2.5, z - 0.5], style.trim, parent)
      for (const dx of [-0.25, 0.25]) fine.put(x - 0.5 + dx, y + 2, z - 0.5, p.glow, parent, true)
    }
    if (definition.id === 'tideglass') {
      for (const dz of [-0.75, 0.75]) fine.line([parent.x - 0.5, y + 0.25, z + dz], [parent.x + 0.5, y + 0.25, z + dz], style.lights[1], parent, true)
    }
  }

  // Clear streets receive fine lamp stems, bench seats, bollards, and planted pockets.
  for (const x of [-9, -5, 5, 9]) for (const z of [-9, -5, 5, 9]) {
    const parent = at(x, 0, z)
    if (!parent || at(x, 1, z)) continue
    const lamp = hash(x, 0, z) % 3
    fine.line([x, 0.75, z], [x, 2.75, z], style.trim, parent)
    fine.line([x, 2.75, z], [x + 0.75, 2.75, z], style.trim, parent)
    trim.put(x + 0.5, 2.5, z, style.lights[lamp], parent, true)
    trim.line([x - 0.75, 0.75, z + 0.75], [x + 0.25, 0.75, z + 0.75], style.walls[lamp], parent)
    if ((x + z) % 4 === 0) plant(x - 0.75, 0.75, z - 0.75, parent, lamp)
  }

  if (definition.id === 'neon-rift') {
    // Backlit alien shop signs and hanging noodle-market awnings.
    for (const x of [-11, -7, 7, 11]) for (const z of [-7, 7]) {
      const parent = at(x + 1, 5, z) ?? highest(x + 1, z)
      if (!parent) continue
      fine.box([x + 1.5, 3.5, z - 0.5], [x + 1.5, 7.5, z + 0.5], p.dark, parent)
      for (let row = 0; row < 4; row++) {
        const y = 4 + row * 0.75
        const light = style.lights[row % 3]
        fine.line([x + 1.75, y, z - 0.25], [x + 1.75, y + 0.5, z - 0.25], light, parent, true)
        fine.line([x + 1.75, y + (row % 2) * 0.5, z - 0.25], [x + 1.75, y + (row % 2) * 0.5, z + 0.25], light, parent, true)
      }
      for (let stripe = -2; stripe <= 2; stripe++) {
        trim.line([x - 1, 2.5, z + 1.5 + stripe * 0.5], [x + 1, 2.5, z + 1.5 + stripe * 0.5], stripe % 2 === 0 ? 0xe773a8 : 0x617db6, parent)
      }
    }
    for (const z of [-7, 0, 7]) for (const x of [-3, -1, 1, 3]) {
      const parent = at(x, 2, z)
      if (parent) fine.line([x, 2.75, z + 1.25], [x, 3.5, z + 1.25], 0x7ef0ea, parent, true)
    }
  } else if (definition.id === 'dune-halo') {
    // Golden filigree on the halo plus patterned bazaar canopies and turquoise oasis gardens.
    for (let step = 0; step < 32; step++) {
      const angle = step / 32 * Math.PI * 2
      const x = Math.round(2 + Math.cos(angle) * 5)
      const y = Math.round(10 + Math.sin(angle) * 5)
      const parent = at(x, y, 1)
      if (parent) {
        fine.put(x, y, 1.75, step % 2 === 0 ? 0xffd985 : 0x72d0c5, parent, true)
        fine.line([x - 0.25, y, 1.5], [x + 0.25, y, 1.5], style.trim, parent)
      }
    }
    for (const x of [-9, -1, 1, 9]) for (const z of [-5, 5]) {
      const parent = at(x, 0, z)
      if (!parent) continue
      for (const dx of [-0.75, 0.75]) fine.line([x + dx, 0.5, z], [x + dx, 2, z], style.trim, parent)
      for (let dx = -1; dx <= 1; dx += 0.5) trim.line([x + dx, 2.25, z - 0.5], [x + dx, 2.25, z + 0.5], dx % 1 === 0 ? 0xc66d89 : 0xf1c7a0, parent)
    }
  } else if (definition.id === 'tideglass') {
    // Mooring posts, dock ladders, small cargo stacks, and pearl rails identify the canal city.
    for (const x of [-9, -5, 5, 9]) for (const z of [-7, 7]) {
      const parent = at(x, 2, z)
      if (!parent) continue
      trim.box([x - 0.5, 2, z - 1.5], [x + 0.5, 2, z - 0.5], 0xb38eab, parent)
      for (const dx of [-0.5, 0.5]) fine.line([x + dx, 1.25, z - 1.5], [x + dx, 3, z - 1.5], style.trim, parent)
      fine.line([x - 0.5, 2.75, z - 1.5], [x + 0.5, 2.75, z - 1.5], style.lights[0], parent, true)
      for (const y of [0.75, 1.25, 1.75]) fine.line([x - 0.25, y, z - 1.75], [x + 0.25, y, z - 1.75], p.secondary, parent)
      trim.put(x, 2.75, z - 0.75, x < 0 ? 0xdeaa98 : 0x8c8fc8, parent)
    }
  } else if (definition.id === 'cloudstack') {
    // Cantilever balconies with laundry lights and suspended lift cages.
    for (const x of [-11, -7, 7, 11]) for (const z of [-7, 7]) {
      const parent = at(x + 1, 7, z) ?? at(x + 1, 6, z)
      if (!parent) continue
      const y = parent.y
      trim.box([x + 1.5, y, z - 0.5], [x + 2.5, y, z + 0.5], style.trim, parent)
      fine.line([x + 2.75, y + 0.25, z - 0.5], [x + 2.75, y + 0.25, z + 0.5], p.secondary, parent)
      fine.line([x + 2.75, y + 1, z - 0.5], [x + 2.75, y + 1, z + 0.5], style.lights[0], parent, true)
      for (const dz of [-0.5, 0.5]) fine.line([x + 2.75, y, z + dz], [x + 2.75, y + 1, z + dz], p.secondary, parent)
      fine.line([x + 1.5, y + 1.75, z - 0.5], [x + 2.5, y + 1.75, z + 0.5], p.dark, parent)
      for (const offset of [0, 0.5, 1]) fine.put(x + 1.5 + offset, y + 1.5, z - 0.5 + offset, style.lights[Math.round(offset * 2)], parent, true)
    }
    for (const x of [-10, 10]) {
      const parent = at(x, 5, -7)
      if (!parent) continue
      fine.line([x, 1.5, -7.75], [x, 5.25, -7.75], style.trim, parent)
      trim.box([x - 0.5, 1.5, -8], [x + 0.5, 2.5, -7.5], 0xbf8f92, parent)
      fine.line([x - 0.5, 2.5, -8.25], [x + 0.5, 2.5, -8.25], style.lights[1], parent, true)
    }
  } else if (definition.id === 'bloom-circuit') {
    // Flower plazas, vine curtains, and segmented solar-tree leaf veins.
    for (const x of [-9, -1, 1, 9]) for (const z of [-5, 5]) {
      const parent = at(x, 0, z)
      if (parent) plant(x, 0.75, z, parent, hash(x, 0, z))
    }
    for (const x of [-7, 7]) for (const z of [-11, -7, 7, 11]) {
      const parent = at(x + 1, 7, z) ?? highest(x + 1, z)
      if (!parent) continue
      for (let y = 3; y <= parent.y; y += 0.5) {
        const dx = y % 1 === 0 ? 1.5 : 1.75
        fine.put(x + dx, y, z + 0.25, style.plants[Math.floor(y) % 3], parent)
        if (y % 2 === 0) fine.put(x + dx + 0.25, y, z + 0.5, 0xf5a9cb, parent, true)
      }
    }
    for (const cell of coarse) if (cell.y === 12 && cell.emissive && Math.abs(cell.x) < 7 && Math.abs(cell.z) < 7) {
      fine.line([cell.x - 0.25, 12.5, cell.z], [cell.x + 0.25, 12.5, cell.z], 0xd9f7a8, cell, true)
    }
  } else {
    // Exposed copper service pipes, hazard-striped gantries, and reactor instrumentation.
    for (const x of [-11, -7, 7, 11]) for (const z of [-7, 7]) {
      const parent = at(x + 1, 3, z)
      if (!parent) continue
      trim.line([x + 1.5, 1, z - 0.5], [x + 1.5, 6, z - 0.5], 0xc4875d, parent)
      trim.line([x + 1.5, 6, z - 0.5], [x + 1.5, 6, z + 1.5], 0xc4875d, parent)
      for (const y of [1, 3, 5]) fine.box([x + 1.75, y, z - 0.75], [x + 1.75, y + 0.25, z - 0.25], style.trim, parent)
      fine.put(x + 1.75, 3.5, z - 0.5, 0x8be9d3, parent, true)
    }
    for (const x of [-7, 7]) for (let z = -10; z <= 10; z++) {
      const parent = at(x, 3, z)
      if (!parent) continue
      fine.put(x + 0.5, 3, z - 0.25, z % 2 === 0 ? 0xffcf75 : 0x302f3f, parent)
      fine.put(x + 0.5, 3.25, z + 0.25, z % 2 === 0 ? 0x302f3f : 0xffcf75, parent)
    }
  }

  // Split broad structural window blocks into small lit panes, mullions, and dark gaps.
  // Sort by a stable spatial hash so a detail budget never favors one side of the skyline.
  const facades = coarse.filter(cell => cell.y > 1 && style.glass.includes(cell.color)).sort((a, b) => hash(a.x, a.y, a.z) - hash(b.x, b.y, b.z))
  for (const cell of facades) {
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if (at(cell.x + dx, cell.y, cell.z + dz)) continue
      const tone = hash(cell.x, cell.y, cell.z)
      const light = style.lights[tone % style.lights.length]
      // Each pane sits just proud of the coarse facade and follows that exact block when cut.
      for (const side of [-0.25, 0.25]) {
        const x = cell.x + dx * 0.5 + (dx === 0 ? side : 0)
        const z = cell.z + dz * 0.5 + (dz === 0 ? side : 0)
        fine.put(x, cell.y, z, tone % 7 === 0 ? style.glass[1] : light, cell, tone % 7 !== 0)
        fine.put(x, cell.y + 0.25, z, tone % 5 === 0 ? style.trim : light, cell, tone % 5 !== 0)
      }
      fine.put(cell.x + dx * 0.5, cell.y, cell.z + dz * 0.5, style.trim, cell)
      if (tone % 4 === 0) trim.put(cell.x + dx * 0.5, cell.y - 0.5, cell.z + dz * 0.5, style.trim, cell)
    }
  }

  return [fine, trim].filter(layer => layer.cells.size > 0).map(layer => ({ cellSize: layer.cellSize, cells: [...layer.cells.values()] }))
}
