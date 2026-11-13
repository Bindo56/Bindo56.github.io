// Converts Nju Jork world blocks (x, z) to real New York lat/lon and back.
// The model is Manhattan at roughly 3 m per block, rotated about 30°, with local
// distortion, so a thin-plate spline through matched control points is used:
// exact at every control point, smooth in between. More points, better fit.

export type GeoPoint = { lat: number; lon: number }
export type WorldPoint = { x: number; z: number }

export type ControlPoint = {
  id: string
  label: string
  /** world block coordinates [x, z] */
  world: [number, number]
  /** real coordinates [lat, lon] */
  geo: [number, number]
  source: string
}

export type GeorefData = { version: 1; zone: string; note?: string; points: ControlPoint[] }

export type CheckResult = { id: string; label: string; errorM: number }

export type Georef = {
  toGeo(world: WorldPoint): GeoPoint
  toWorld(geo: GeoPoint): WorldPoint
  /** Overall fit: meters per world block and rotation from world axes to true north. */
  metersPerBlock: number
  rotationDeg: number
  /** Leave-one-out error for each control point; large values usually mean a bad match. */
  check(): CheckResult[]
}

type Vec = [number, number]
type Mapping = (point: Vec) => Vec

const METERS_PER_DEG_LAT = 110_574
const METERS_PER_DEG_LON_EQUATOR = 111_320

export function createGeoref(points: ControlPoint[], smoothing = 0): Georef {
  if (points.length < 2) throw new Error('Georeferencing needs at least two control points.')
  const lat0 = points.reduce((sum, point) => sum + point.geo[0], 0) / points.length
  const lon0 = points.reduce((sum, point) => sum + point.geo[1], 0) / points.length
  const lonScale = Math.cos((lat0 * Math.PI) / 180) * METERS_PER_DEG_LON_EQUATOR

  // World z grows southward; flip it so both planes are right-handed with north up.
  const worldPlane = (x: number, z: number): Vec => [x, -z]
  const geoPlane = (lat: number, lon: number): Vec => [(lon - lon0) * lonScale, (lat - lat0) * METERS_PER_DEG_LAT]
  const fromGeoPlane = ([east, north]: Vec): GeoPoint => ({ lat: lat0 + north / METERS_PER_DEG_LAT, lon: lon0 + east / lonScale })

  const fitBoth = (subset: ControlPoint[]) => {
    const world = subset.map((point) => worldPlane(...point.world))
    const geo = subset.map((point) => geoPlane(...point.geo))
    return { forward: fitMapping(world, geo, smoothing), inverse: fitMapping(geo, world, smoothing) }
  }

  const { forward, inverse } = fitBoth(points)
  const similarity = fitSimilarity(
    points.map((point) => worldPlane(...point.world)),
    points.map((point) => geoPlane(...point.geo)),
  )

  return {
    toGeo: ({ x, z }) => fromGeoPlane(forward(worldPlane(x, z))),
    toWorld: ({ lat, lon }) => {
      const [x, y] = inverse(geoPlane(lat, lon))
      return { x, z: -y }
    },
    metersPerBlock: Math.hypot(similarity.a, similarity.b),
    // Positive = world "up" (−z) points this many degrees clockwise of true north.
    rotationDeg: (-Math.atan2(similarity.b, similarity.a) * 180) / Math.PI,
    check: () => {
      if (points.length < 3) return points.map((point) => ({ id: point.id, label: point.label, errorM: 0 }))
      return points.map((point, index) => {
        const others = points.filter((_, other) => other !== index)
        const predicted = fitBoth(others).forward(worldPlane(...point.world))
        const actual = geoPlane(...point.geo)
        return { id: point.id, label: point.label, errorM: Math.hypot(predicted[0] - actual[0], predicted[1] - actual[1]) }
      })
    },
  }
}

export const googleMapsUrl = ({ lat, lon }: GeoPoint) =>
  `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`

/** Thin-plate spline for 3+ well-spread points, least-squares similarity otherwise. */
function fitMapping(source: Vec[], target: Vec[], smoothing: number): Mapping {
  if (source.length >= 3) {
    try {
      return fitThinPlate(source, target, smoothing)
    } catch {
      // Collinear or duplicate points: fall back to the rigid fit.
    }
  }
  const { a, b, tx, ty } = fitSimilarity(source, target)
  return ([x, y]) => [a * x - b * y + tx, b * x + a * y + ty]
}

/** Least-squares scale + rotation + translation: E = a·x − b·y + tx, N = b·x + a·y + ty. */
function fitSimilarity(source: Vec[], target: Vec[]) {
  const rows: number[][] = []
  const values: number[] = []
  source.forEach(([x, y], index) => {
    rows.push([x, -y, 1, 0], [y, x, 0, 1])
    values.push(target[index][0], target[index][1])
  })
  const normal = Array.from({ length: 4 }, () => new Array<number>(4).fill(0))
  const rhs = new Array<number>(4).fill(0)
  rows.forEach((row, index) => {
    for (let r = 0; r < 4; r += 1) {
      rhs[r] += row[r] * values[index]
      for (let c = 0; c < 4; c += 1) normal[r][c] += row[r] * row[c]
    }
  })
  const [a, b, tx, ty] = solve(normal, [rhs])[0]
  return { a, b, tx, ty }
}

function fitThinPlate(source: Vec[], target: Vec[], smoothing: number): Mapping {
  // Normalise inputs so the kernel matrix stays well conditioned.
  const n = source.length
  const cx = source.reduce((sum, point) => sum + point[0], 0) / n
  const cy = source.reduce((sum, point) => sum + point[1], 0) / n
  const spread = Math.sqrt(source.reduce((sum, [x, y]) => sum + (x - cx) ** 2 + (y - cy) ** 2, 0) / n) || 1
  const norm = ([x, y]: Vec): Vec => [(x - cx) / spread, (y - cy) / spread]
  const points = source.map(norm)

  const size = n + 3
  const matrix = Array.from({ length: size }, () => new Array<number>(size).fill(0))
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) matrix[i][j] = kernel(points[i], points[j])
    matrix[i][i] += smoothing
    matrix[i][n] = matrix[n][i] = 1
    matrix[i][n + 1] = matrix[n + 1][i] = points[i][0]
    matrix[i][n + 2] = matrix[n + 2][i] = points[i][1]
  }
  const rhsX = [...target.map((point) => point[0]), 0, 0, 0]
  const rhsY = [...target.map((point) => point[1]), 0, 0, 0]
  const [weightsX, weightsY] = solve(matrix, [rhsX, rhsY])

  return (input) => {
    const point = norm(input)
    let x = weightsX[n] + weightsX[n + 1] * point[0] + weightsX[n + 2] * point[1]
    let y = weightsY[n] + weightsY[n + 1] * point[0] + weightsY[n + 2] * point[1]
    for (let i = 0; i < n; i += 1) {
      const u = kernel(point, points[i])
      x += weightsX[i] * u
      y += weightsY[i] * u
    }
    return [x, y]
  }
}

function kernel(a: Vec, b: Vec) {
  const r2 = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
  return r2 === 0 ? 0 : r2 * Math.log(r2)
}

/** Gaussian elimination with partial pivoting; solves one matrix for several right-hand sides. */
function solve(matrix: number[][], rightHandSides: number[][]): number[][] {
  const size = matrix.length
  const a = matrix.map((row, index) => [...row, ...rightHandSides.map((rhs) => rhs[index])])
  for (let col = 0; col < size; col += 1) {
    let pivot = col
    for (let row = col + 1; row < size; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row
    if (Math.abs(a[pivot][col]) < 1e-12) throw new Error('Control points are degenerate.')
    ;[a[col], a[pivot]] = [a[pivot], a[col]]
    for (let row = 0; row < size; row += 1) {
      if (row === col) continue
      const factor = a[row][col] / a[col][col]
      if (factor === 0) continue
      for (let c = col; c < a[row].length; c += 1) a[row][c] -= factor * a[col][c]
    }
  }
  return rightHandSides.map((_, k) => a.map((row, index) => row[size + k] / row[index]))
}
