import { CITY_CELL_SIZE, type CityBlueprint, type CityDefinition, type VoxelCell } from './types.ts'
import { buildCityDetails, CITY_ARCHITECTURE } from './cityDetails.ts'

export const CITIES: CityDefinition[] = [
  {
    id: 'neon-rift', name: 'Neon Rift', subtitle: 'The luminous canyon', inspiration: 'Tokyo',
    description: 'Stacked violet towers, light rails, and suspended streets above a glowing fault.',
    color: '#d89bff', normal: [0, 0, 1],
    palette: { ground: 0x493556, building: 0x9569be, secondary: 0xc29cde, glow: 0xf075fc, dark: 0x24233d },
  },
  {
    id: 'dune-halo', name: 'Dune Halo', subtitle: 'The crescent capital', inspiration: 'Dubai',
    description: 'Ivory spires and immense golden halos rising from a sea of rose-colored sand.',
    color: '#ffd78a', normal: [0.8, 0.3, 0.5],
    palette: { ground: 0xc68d93, building: 0xf0d4b0, secondary: 0xddb76c, glow: 0xffda74, dark: 0x88667b },
  },
  {
    id: 'tideglass', name: 'Tideglass', subtitle: 'The violet archipelago', inspiration: 'Venice',
    description: 'Blue glass domes, canal bridges, and illuminated platforms above a violet sea.',
    color: '#8eeeff', normal: [-0.75, 0.2, 0.6],
    palette: { ground: 0x67518e, building: 0x69b9cb, secondary: 0xc3e6dd, glow: 0x8cf6ff, dark: 0x304a70 },
  },
  {
    id: 'cloudstack', name: 'Cloudstack', subtitle: 'The hanging districts', inspiration: 'Hong Kong',
    description: 'Vertical neighborhoods and cable bridges cling to a towering suspended rock citadel.',
    color: '#afbaff', normal: [0, 0.85, -0.5],
    palette: { ground: 0x72758e, building: 0x909cc6, secondary: 0xd8c2b8, glow: 0xa3bfff, dark: 0x414d68 },
  },
  {
    id: 'bloom-circuit', name: 'Bloom Circuit', subtitle: 'The living network', inspiration: 'Singapore',
    description: 'Mint terraces, luminous alien gardens, and immense branching solar trees.',
    color: '#a6ffcf', normal: [-0.7, -0.5, -0.5],
    palette: { ground: 0x54836d, building: 0xe3ead5, secondary: 0x9dceb1, glow: 0x91fbb7, dark: 0x315f59 },
  },
  {
    id: 'ember-forge', name: 'Ember Forge', subtitle: 'The geothermal foundry', inspiration: 'Reykjavík',
    description: 'Basalt factories and bright industrial conduits surround an exposed geothermal core.',
    color: '#ffab74', normal: [0.7, -0.5, -0.5],
    palette: { ground: 0x70606b, building: 0x77818a, secondary: 0xc5b49a, glow: 0xff984c, dark: 0x3d4153 },
  },
]

type CellFlags = Pick<VoxelCell, 'emissive' | 'reactor' | 'anchored'>
type GridPoint = [number, number, number]

function blendColor(a: number, b: number, mix: number): number {
  const red = Math.round(((a >> 16) & 255) * (1 - mix) + ((b >> 16) & 255) * mix)
  const green = Math.round(((a >> 8) & 255) * (1 - mix) + ((b >> 8) & 255) * mix)
  const blue = Math.round((a & 255) * (1 - mix) + (b & 255) * mix)
  return (red << 16) | (green << 8) | blue
}

/** All geometry shares one integer grid, so bridges and floors share real structural cells. */
class CityBuilder {
  readonly cells = new Map<string, VoxelCell>()
  readonly traffic: CityBlueprint['traffic'] = []
  private seed: number

  constructor(readonly definition: CityDefinition) {
    this.seed = Array.from(definition.id).reduce((hash, character) => Math.imul(hash, 31) + character.charCodeAt(0), 17) >>> 0
  }

  random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0
    return this.seed / 4294967296
  }

  put(x: number, y: number, z: number, color: number, flags: CellFlags = {}): void {
    this.cells.set(`${x},${y},${z}`, { x, y, z, color, ...(y <= 0 ? { anchored: true } : {}), ...flags })
  }

  remove(x: number, y: number, z: number): void {
    this.cells.delete(`${x},${y},${z}`)
  }

  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: number, flags: CellFlags = {}): void {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) this.put(x, y, z, color, flags)
  }

  /** A staircase raster, rather than diagonal-only cells, keeps cables and curved outlines connected. */
  line(from: GridPoint, to: GridPoint, color: number, flags: CellFlags = {}): void {
    const point: GridPoint = [...from]
    this.put(...point, color, flags)
    const distance = Math.max(...point.map((value, axis) => Math.abs(value - to[axis])))
    for (let step = 1; step <= distance; step++) {
      for (let axis = 0; axis < 3; axis++) {
        const target = Math.round(from[axis] + (to[axis] - from[axis]) * step / distance)
        while (point[axis] !== target) {
          point[axis] += Math.sign(target - point[axis])
          this.put(...point, color, flags)
        }
      }
    }
  }

  ring(center: GridPoint, radius: number, plane: 'vertical' | 'horizontal', color: number, flags: CellFlags = {}): void {
    let previous: GridPoint | undefined
    for (let step = 0; step <= 64; step++) {
      const angle = step / 64 * Math.PI * 2
      const a = Math.round(Math.cos(angle) * radius)
      const b = Math.round(Math.sin(angle) * radius)
      const point: GridPoint = plane === 'vertical'
        ? [center[0] + a, center[1] + b, center[2]]
        : [center[0] + a, center[1], center[2] + b]
      if (previous) this.line(previous, point, color, flags)
      previous = point
    }
  }

  foundation(): void {
    const palette = this.definition.palette
    for (let y = -4; y <= 0; y++) {
      const radius = 14 - Math.abs(y) * 0.3
      for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) {
        if (x * x + z * z > radius * radius) continue
        const patch = Math.abs(Math.floor(x / 3) * 7 + Math.floor(z / 3) * 11) % 4
        const color = y === 0
          ? blendColor(palette.ground, patch === 0 ? palette.secondary : palette.dark, patch === 0 ? 0.15 : patch * 0.025)
          : blendColor(palette.dark, palette.ground, y === -2 ? 0.35 : 0.12)
        this.put(x, y, z, color)
      }
    }
  }

  road(axis: 'x' | 'z', offset: number, y = 0, color = this.definition.palette.dark): void {
    for (let a = -12; a <= 12; a++) {
      if (a * a + offset * offset > 183) continue
      const x = axis === 'x' ? a : offset
      const z = axis === 'z' ? a : offset
      this.put(x, y, z, color)
      if (a % 4 === 0) this.put(x, y, z, this.definition.palette.glow, { emissive: true })
    }
  }

  building(x: number, z: number, height: number, options: { base?: number; stepped?: boolean; width?: number; reactor?: boolean; color?: number } = {}): void {
    const p = this.definition.palette
    const style = CITY_ARCHITECTURE[this.definition.id]
    const variant = Math.abs(x * 7 + z * 11)
    const facade = options.color ?? style.walls[variant % style.walls.length]
    const base = options.base ?? 1
    const width = options.width ?? 1
    if (base > 1) this.box(x, x, 1, base - 1, z, z, p.dark)
    for (let y = base; y <= base + height; y++) {
      const taper = options.stepped && y > base + height * 0.72 ? Math.max(0, width - 1) : width
      const slab = (y - base) % 3 === 0 || y === base + height
      for (let dx = -taper; dx <= taper; dx++) for (let dz = -taper; dz <= taper; dz++) {
        // Clipped upper corners give selected towers a faceted crown without widening their plots.
        if (!options.stepped && variant % 3 === 1 && y > base + height * 0.78 && Math.abs(dx) === taper && Math.abs(dz) === taper && taper > 0) continue
        const wall = Math.abs(dx) === taper || Math.abs(dz) === taper
        if (!wall && !slab) continue
        const window = wall && !slab && (dx + dz + y) % 3 !== 0
        const band = (Math.floor((y - base) / 3) + variant) % 3 === 0 ? style.trim : p.secondary
        this.put(x + dx, y, z + dz, window ? style.glass[(variant + y) % style.glass.length] : (slab ? band : facade))
      }
    }
    this.put(x, base + height + 1, z, p.glow, { emissive: true, reactor: options.reactor })
  }

  dome(cx: number, floor: number, cz: number, radius: number): void {
    const p = this.definition.palette
    for (let y = 0; y <= radius; y++) for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) {
      const distance = x * x + y * y + z * z
      if (distance > radius * radius || (y > 0 && distance < (radius - 1.5) ** 2)) continue
      const rib = x === 0 || z === 0 || y === 0
      this.put(cx + x, floor + y, cz + z, rib ? p.secondary : p.glow, rib ? {} : { emissive: true })
    }
  }

  route(from: GridPoint, to: GridPoint, color = this.definition.palette.glow): void {
    const scale = ([x, y, z]: GridPoint): GridPoint => [x * CITY_CELL_SIZE, y * CITY_CELL_SIZE, z * CITY_CELL_SIZE]
    this.traffic.push({ from: scale(from), to: scale(to), color })
  }

  finish(): CityBlueprint {
    const cells = [...this.cells.values()]
    return { cells, details: buildCityDetails(this.definition, cells), traffic: this.traffic }
  }
}

/** Twenty-eight building plots surround a reserved landmark district and two broad crossing streets. */
function neighborhoods(build: (x: number, z: number, index: number) => void): void {
  let index = 0
  for (const x of [-11, -7, -3, 3, 7, 11]) for (const z of [-11, -7, -3, 3, 7, 11]) {
    if (x * x + z * z > 190 || (Math.abs(x) === 3 && Math.abs(z) === 3)) continue
    build(x, z, index++)
  }
}

function neonRift(b: CityBuilder): void {
  const p = b.definition.palette
  for (let z = -13; z <= 13; z++) for (let x = -1; x <= 1; x++) {
    b.remove(x, 0, z)
    b.remove(x, -1, z)
    b.put(x, -2, z, z % 3 === 0 ? p.glow : 0x5c3278, { emissive: true })
  }
  neighborhoods((x, z, index) => {
    const height = 7 + Math.floor(b.random() * 6)
    b.building(x, z, height, { reactor: index % 9 === 0 })
    if (index % 2 === 0) {
      b.box(x + 2, x + 2, 4, 7, z, z, p.glow, { emissive: true })
      b.put(x + 2, 5, z, 0x7cf5f1, { emissive: true })
    }
    if (index % 3 === 0) b.box(x, x, height + 2, height + 4, z, z, p.secondary)
  })
  for (const z of [-7, 0, 7]) {
    b.box(-4, 4, 2, 2, z - 1, z + 1, p.secondary)
    for (const x of [-4, 4]) b.box(x, x, 0, 2, z, z, p.dark)
    b.box(-4, 4, 3, 3, z - 1, z - 1, p.glow, { emissive: true })
  }
  for (const x of [-7, 7]) {
    b.box(x, x, 6, 6, -10, 10, p.secondary)
    b.box(x, x, 7, 7, -10, 10, 0x77ebe9, { emissive: true })
  }
  b.box(-1, 1, -1, 15, -1, 1, p.building)
  for (let y = 3; y <= 15; y += 3) b.box(-1, 1, y, y, -1, 1, p.glow, { emissive: true })
  b.box(0, 0, 16, 18, 0, 0, 0x8ef5f2, { emissive: true, reactor: true })
  for (const y of [8, 12]) {
    b.ring([0, y, 0], 4, 'horizontal', p.secondary)
    b.line([-4, y, 0], [4, y, 0], p.secondary)
    b.line([0, y, -4], [0, y, 4], p.secondary)
  }
  b.route([-11, 4, 5], [11, 4, 5], 0x7cf5f1)
  b.route([0, 4, -12], [0, 4, -3])
  b.route([0, 4, 3], [0, 4, 12], 0x7cf5f1)
}

function duneHalo(b: CityBuilder): void {
  const p = b.definition.palette
  b.road('x', -5)
  b.road('x', 5)
  b.road('z', -5)
  b.road('z', 5)
  neighborhoods((x, z, index) => {
    const height = 8 + Math.floor(b.random() * 7)
    b.building(x, z, height, { stepped: true, reactor: index % 10 === 0 })
    if (index % 3 === 0) {
      b.box(x - 1, x + 1, 4, 4, z - 1, z + 1, p.secondary)
      b.put(x, height + 3, z, p.secondary)
    }
  })
  b.box(-3, 2, 1, 2, -2, 2, p.secondary)
  // A thick, curved crescent carries the city-scale vertical halo.
  for (let y = 3; y <= 18; y++) {
    const x = Math.round(-4 + 4 * ((y - 10) / 8) ** 2)
    b.box(x - 1, x + 1, y, y, -1, 1, p.building)
    b.put(x - 1, y, 1, p.glow, { emissive: true })
  }
  for (const z of [0, 1]) b.ring([2, 10, z], 5, 'vertical', p.secondary)
  b.ring([2, 10, 1], 4, 'vertical', p.glow, { emissive: true })
  b.box(1, 2, 3, 5, 0, 1, p.secondary)
  b.box(0, 2, 3, 3, 0, 1, p.glow, { emissive: true, reactor: true })
  for (const z of [-9, 9]) {
    b.box(-4, 4, 1, 1, z, z, p.secondary)
    b.ring([0, 1, z], 2, 'horizontal', p.glow, { emissive: true })
  }
  b.route([-11, 2, 5], [11, 2, 5])
  b.route([11, 2, -5], [-11, 2, -5])
}

function tideglass(b: CityBuilder): void {
  const p = b.definition.palette
  for (let x = -13; x <= 13; x++) for (let z = -13; z <= 13; z++) {
    if (x * x + z * z <= 183) b.put(x, 0, z, (x + z) % 7 === 0 ? 0x7863a5 : 0x51467f)
  }
  neighborhoods((x, z, index) => {
    b.box(x - 1, x + 1, 1, 2, z - 1, z + 1, p.secondary)
    const height = 4 + Math.floor(b.random() * 6)
    b.building(x, z, height, { base: 3, reactor: index % 8 === 0 })
    if (index % 3 === 0) b.dome(x, height + 4, z, 1)
    if (index % 2 === 0) b.box(x - 1, x + 1, 3, 3, z + 2, z + 2, p.secondary)
  })
  for (const z of [-7, 7]) {
    b.box(-11, 11, 2, 2, z, z, p.secondary)
    for (const x of [-5, 0, 5]) b.box(x, x, 1, 2, z, z, p.building)
    for (let x = -10; x <= 10; x += 2) b.put(x, 3, z, p.glow, { emissive: true })
  }
  for (const x of [-7, 7]) b.box(x, x, 2, 2, -11, 11, p.secondary)
  b.box(-4, 4, 1, 2, -4, 4, p.secondary)
  b.dome(0, 3, 0, 4)
  b.box(0, 0, 3, 12, 0, 0, p.secondary)
  b.ring([0, 10, 0], 3, 'horizontal', p.glow, { emissive: true })
  b.line([-3, 10, 0], [3, 10, 0], p.secondary)
  b.line([0, 10, -3], [0, 10, 3], p.secondary)
  b.put(0, 13, 0, p.glow, { emissive: true, reactor: true })
  // Low boats run through clear canals outside the central dome district.
  b.route([-11, 1.5, 5], [11, 1.5, 5])
  b.route([5, 1.5, 11], [5, 1.5, -11])
  b.route([11, 1.5, -5], [-11, 1.5, -5])
}

function cloudstack(b: CityBuilder): void {
  const p = b.definition.palette
  neighborhoods((x, z, index) => {
    const base = 2 + Math.floor((14 - Math.hypot(x, z)) * 0.45)
    b.box(x - 1, x + 1, 1, base, z - 1, z + 1, p.dark)
    b.building(x, z, 5 + Math.floor(b.random() * 6), { base: base + 1, reactor: index % 7 === 0 })
    if (index % 3 === 0) b.box(x - 2, x + 2, base + 3, base + 3, z - 1, z + 1, p.secondary)
  })
  // The central rock has a narrow neck; severing it releases the upper citadel.
  b.box(-1, 1, 1, 4, -1, 1, p.dark)
  for (let y = 5; y <= 9; y++) {
    const radius = Math.min(4, y - 3)
    for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) {
      if (x * x + z * z <= radius * radius) b.put(x, y, z, y === 9 ? p.secondary : p.ground)
    }
  }
  b.building(0, 0, 6, { base: 10, width: 2, stepped: true, reactor: true })
  for (const axis of ['x', 'z'] as const) {
    for (const direction of [-1, 1]) {
      const start: GridPoint = axis === 'x' ? [direction * 4, 9, 0] : [0, 9, direction * 4]
      const end: GridPoint = axis === 'x' ? [direction * 11, 5, 0] : [0, 5, direction * 11]
      b.line(start, end, p.secondary)
      const foot: GridPoint = [end[0], 0, end[2]]
      b.line(foot, end, p.dark)
      b.line([0, 15, 0], [end[0], end[1] + 1, end[2]], p.glow, { emissive: true })
    }
  }
  for (const z of [-7, 7]) {
    b.box(-11, 11, 5, 5, z, z, p.secondary)
    b.box(-11, 11, 6, 6, z, z, p.glow, { emissive: true })
  }
  b.route([-11, 3, -5], [11, 3, -5])
  b.route([11, 3, 5], [-11, 3, 5])
}

function bloomCircuit(b: CityBuilder): void {
  const p = b.definition.palette
  for (const offset of [-5, 5]) {
    b.road('x', offset, 0, 0x6f9a7b)
    b.road('z', offset, 0, 0x6f9a7b)
  }
  neighborhoods((x, z, index) => {
    const height = 6 + Math.floor(b.random() * 6)
    b.building(x, z, height, { reactor: index % 9 === 0 })
    for (let y = 3; y < height; y += 4) {
      b.box(x - 1, x + 1, y, y, z - 1, z + 1, p.secondary)
      b.put(x + 1, y + 1, z + 1, 0x76bb8b)
    }
    b.box(x - 1, x + 1, height + 2, height + 2, z - 1, z + 1, 0x659f7b)
    b.put(x, height + 3, z, p.glow, { emissive: true })
  })
  b.box(-1, 1, 1, 10, -1, 1, p.building)
  b.box(0, 0, 1, 13, 0, 0, p.glow, { emissive: true, reactor: true })
  for (const [x, z] of [[-4, -3], [4, -3], [-4, 3], [4, 3], [0, 5]]) {
    b.line([0, 7, 0], [x, 12, z], p.secondary)
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (dx * dx + dz * dz > 5) continue
      b.put(x + dx, 12, z + dz, (dx + dz) % 2 === 0 ? p.glow : 0x72aa86, { emissive: true })
      if (Math.abs(dx) + Math.abs(dz) <= 1) b.put(x + dx, 13, z + dz, p.glow, { emissive: true })
    }
  }
  b.ring([0, 1, 0], 4, 'horizontal', p.secondary)
  for (const z of [-9, 9]) {
    b.box(-1, 1, 1, 4, z, z, 0x77a582)
    b.box(-2, 2, 5, 5, z - 1, z + 1, p.glow, { emissive: true })
    b.box(-1, 1, 6, 6, z - 1, z + 1, 0x9be2a7)
  }
  b.route([-11, 2, -5], [11, 2, -5])
  b.route([-5, 2, 11], [-5, 2, -11])
  b.route([11, 2, 5], [-11, 2, 5])
}

function emberForge(b: CityBuilder): void {
  const p = b.definition.palette
  for (const offset of [-5, 5]) for (let a = -11; a <= 11; a++) {
    b.put(a, 0, offset, p.glow, { emissive: true })
    b.put(offset, 0, a, p.glow, { emissive: true })
  }
  neighborhoods((x, z, index) => {
    const height = 5 + Math.floor(b.random() * 5)
    b.building(x, z, height, { reactor: index % 5 === 0 })
    b.box(x - 1, x + 1, 2, 2, z - 1, z + 1, p.building)
    b.box(x - 1, x + 1, height + 1, height + 1, z - 1, z + 1, p.secondary)
    b.box(x, x, height + 2, height + 5, z, z, p.dark)
    b.put(x, height + 6, z, p.glow, { emissive: true })
    if (index % 2 === 0) {
      b.box(x + 2, x + 2, 1, 4, z, z, p.secondary)
      b.put(x + 2, 4, z, p.glow, { emissive: true, reactor: true })
    }
  })
  b.box(-3, 3, 1, 2, -3, 3, p.dark)
  b.box(-1, 1, 3, 13, -1, 1, p.glow, { emissive: true, reactor: true })
  for (const x of [-3, 3]) for (const z of [-3, 3]) b.box(x, x, 2, 15, z, z, p.secondary)
  for (const y of [4, 8, 12, 15]) {
    b.box(-3, 3, y, y, -3, -3, p.building)
    b.box(-3, 3, y, y, 3, 3, p.building)
    b.box(-3, -3, y, y, -3, 3, p.building)
    b.box(3, 3, y, y, -3, 3, p.building)
  }
  b.box(-3, 3, 15, 15, -1, 1, p.secondary)
  b.box(-1, 1, 14, 17, -1, 1, p.dark)
  b.box(-1, 1, 18, 18, -1, 1, p.glow, { emissive: true })
  for (const x of [-7, 7]) {
    b.box(x, x, 3, 3, -11, 11, p.secondary)
    b.box(x, x, 4, 4, -11, 11, p.glow, { emissive: true })
  }
  b.route([-11, 2, 5], [11, 2, 5])
  b.route([11, 2, -5], [-11, 2, -5])
}

export function buildCity(definition: CityDefinition): CityBlueprint {
  const builder = new CityBuilder(definition)
  builder.foundation()
  switch (definition.id) {
    case 'neon-rift': neonRift(builder); break
    case 'dune-halo': duneHalo(builder); break
    case 'tideglass': tideglass(builder); break
    case 'cloudstack': cloudstack(builder); break
    case 'bloom-circuit': bloomCircuit(builder); break
    case 'ember-forge': emberForge(builder); break
  }
  return builder.finish()
}
