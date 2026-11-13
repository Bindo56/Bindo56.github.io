// OpenStreetMap fallback for the calibration page: free, no key.
// Nominatim (search, reverse, street shapes) allows at most one request per second,
// so every call goes through one throttled queue and results are cached.
// Overpass (nearby named places) is best-effort: public servers are often busy.

const USER_AGENT = 'system-zero-calibration/1.0 (local dev tool)'
const NOMINATIM = 'https://nominatim.openstreetmap.org'
const NYC_VIEWBOX = '-74.27,40.92,-73.68,40.49'
const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

export class OsmError extends Error {}

type LonLat = [number, number]
type Geometry = { type: string; coordinates: unknown }
type NominatimPlace = { display_name: string; lat: string; lon: string; name?: string; type?: string; geojson?: Geometry }
type NominatimReverse = NominatimPlace & {
  error?: string
  address?: { house_number?: string; road?: string; neighbourhood?: string; suburb?: string; postcode?: string }
}
type OverpassElement = { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

const cache = new Map<string, unknown>()
let queue: Promise<unknown> = Promise.resolve()
let lastRequest = 0

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function nominatim<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = `${NOMINATIM}${path}?${new URLSearchParams({ format: 'jsonv2', 'accept-language': 'en', ...params })}`
  if (cache.has(url)) return Promise.resolve(cache.get(url) as T)
  const request = queue.then(async () => {
    const wait = lastRequest + 1100 - Date.now()
    if (wait > 0) await sleep(wait)
    lastRequest = Date.now()
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new OsmError(`OpenStreetMap search failed (HTTP ${response.status}).`)
    const body = (await response.json()) as T
    if (cache.size > 500) cache.clear()
    cache.set(url, body)
    return body
  })
  queue = request.catch(() => undefined)
  return request
}

// ---------- street name clean-up: "W 42nd St" → "West 42nd Street" ----------

const DIRECTIONS: Record<string, string> = { w: 'West', e: 'East', n: 'North', s: 'South' }
const SUFFIXES: Record<string, string> = {
  st: 'Street', str: 'Street', ave: 'Avenue', av: 'Avenue', blvd: 'Boulevard', pl: 'Place', dr: 'Drive',
  pkwy: 'Parkway', rd: 'Road', sq: 'Square', ln: 'Lane', hwy: 'Highway', ct: 'Court', ter: 'Terrace',
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`

export function normalizeStreet(raw: string) {
  const words = raw.trim().replace(/\./g, '').split(/\s+/).filter(Boolean)
  return words.map((word, index) => {
    const lower = word.toLowerCase()
    const last = index === words.length - 1
    if (lower === 'bway' || lower === "b'way") return 'Broadway'
    if (index === 0 && words.length > 1 && DIRECTIONS[lower]) return DIRECTIONS[lower]
    if (last && SUFFIXES[lower]) return SUFFIXES[lower]
    if (/^\d+$/.test(word)) return ordinal(Number(word))
    if (/^\d+(st|nd|rd|th)$/i.test(word)) return lower
    return word[0].toUpperCase() + word.slice(1)
  }).join(' ')
}

// ---------- intersections from street shapes ----------

async function streetLines(name: string): Promise<LonLat[][]> {
  const results = await nominatim<NominatimPlace[]>('/search', {
    street: name, city: 'New York', state: 'New York', polygon_geojson: '1', limit: '50', dedupe: '0',
  })
  return results.flatMap((result) => {
    const geometry = result.geojson
    if (geometry?.type === 'LineString') return [geometry.coordinates as LonLat[]]
    if (geometry?.type === 'MultiLineString') return geometry.coordinates as LonLat[][]
    return []
  })
}

const LAT0 = 40.75
const M_PER_LON = Math.cos((LAT0 * Math.PI) / 180) * 111_320
const M_PER_LAT = 110_574
const toXY = ([lon, lat]: LonLat): [number, number] => [lon * M_PER_LON, lat * M_PER_LAT]
const toGeo = ([x, y]: [number, number]) => ({ lat: y / M_PER_LAT, lon: x / M_PER_LON })

function closestOnSegment(p: [number, number], a: [number, number], b: [number, number]): [number, number] {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0
  return [a[0] + t * dx, a[1] + t * dy]
}

/** Where two segments cross, or the midpoint of their closest approach when within `tolerance` m (divided roads). */
function meet(a1: [number, number], a2: [number, number], b1: [number, number], b2: [number, number], tolerance: number) {
  const d = (a2[0] - a1[0]) * (b2[1] - b1[1]) - (a2[1] - a1[1]) * (b2[0] - b1[0])
  if (d !== 0) {
    const t = ((b1[0] - a1[0]) * (b2[1] - b1[1]) - (b1[1] - a1[1]) * (b2[0] - b1[0])) / d
    const u = ((b1[0] - a1[0]) * (a2[1] - a1[1]) - (b1[1] - a1[1]) * (a2[0] - a1[0])) / d
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { point: [a1[0] + t * (a2[0] - a1[0]), a1[1] + t * (a2[1] - a1[1])] as [number, number], gap: 0 }
  }
  let best: { point: [number, number]; gap: number } | null = null
  for (const [p, a, b] of [[a1, b1, b2], [a2, b1, b2], [b1, a1, a2], [b2, a1, a2]] as const) {
    const q = closestOnSegment(p, a, b)
    const gap = Math.hypot(p[0] - q[0], p[1] - q[1])
    if (gap <= tolerance && (!best || gap < best.gap)) best = { point: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], gap }
  }
  return best
}

function crossings(first: LonLat[][], second: LonLat[][]) {
  const hits: [number, number][] = []
  const a = first.map((line) => line.map(toXY))
  const b = second.map((line) => line.map(toXY))
  for (const lineA of a) for (let i = 1; i < lineA.length; i += 1) {
    for (const lineB of b) for (let j = 1; j < lineB.length; j += 1) {
      const hit = meet(lineA[i - 1], lineA[i], lineB[j - 1], lineB[j], 20)
      if (hit) hits.push(hit.point)
    }
  }
  // Merge hits within 40 m (both carriageways, shared nodes counted twice).
  const clusters: { sum: [number, number]; count: number }[] = []
  for (const hit of hits) {
    const cluster = clusters.find((item) => Math.hypot(item.sum[0] / item.count - hit[0], item.sum[1] / item.count - hit[1]) < 40)
    if (cluster) {
      cluster.sum[0] += hit[0]
      cluster.sum[1] += hit[1]
      cluster.count += 1
    } else {
      clusters.push({ sum: [hit[0], hit[1]], count: 1 })
    }
  }
  return clusters.map((cluster) => toGeo([cluster.sum[0] / cluster.count, cluster.sum[1] / cluster.count]))
}

// ---------- public API ----------

export async function osmSearch(query: string) {
  const parts = query.split(/\s+(?:and|at)\s+|\s*[&/@]\s*/i).map((part) => part.trim()).filter(Boolean)
  if (parts.length === 2) {
    const [first, second] = parts.map(normalizeStreet)
    const linesA = await streetLines(first)
    const linesB = linesA.length ? await streetLines(second) : []
    const points = crossings(linesA, linesB)
    if (points.length) return points.slice(0, 5).map((point) => ({ label: `${first} & ${second}`, ...point }))
  }
  const results = await nominatim<NominatimPlace[]>('/search', { q: query, viewbox: NYC_VIEWBOX, bounded: '1', limit: '6' })
  return results.map((result) => ({ label: result.display_name, lat: Number(result.lat), lon: Number(result.lon) }))
}

async function nearbyPlaces(lat: number, lon: number) {
  const query = `[out:json][timeout:8];nwr(around:50,${lat},${lon})["name"]["highway"!~"."];out center 12;`
  for (const server of OVERPASS_SERVERS) {
    try {
      const response = await fetch(server, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(9_000),
      })
      if (!response.ok) continue
      const body = (await response.json()) as { elements: OverpassElement[] }
      return body.elements
        .map((element) => {
          const at = element.center ?? (element.lat !== undefined && element.lon !== undefined ? { lat: element.lat, lon: element.lon } : null)
          const tags = element.tags ?? {}
          return {
            name: tags.name,
            type: tags.amenity ?? tags.shop ?? tags.tourism ?? tags.leisure ?? tags.office ?? tags.historic ?? tags.building ?? null,
            address: null,
            placeId: null,
            lat: at?.lat ?? null,
            lon: at?.lon ?? null,
            distance: at ? Math.hypot((at.lat - lat) * M_PER_LAT, (at.lon - lon) * M_PER_LON) : Infinity,
          }
        })
        .filter((place) => place.name)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 5)
        .map(({ distance: _distance, ...place }) => place)
    } catch {
      // Try the next public server.
    }
  }
  return null
}

export async function osmLookup(lat: number, lon: number) {
  const reverse = await nominatim<NominatimReverse>('/reverse', { lat: String(lat), lon: String(lon), zoom: '18', addressdetails: '1' })
  if (reverse.error) throw new OsmError(`OpenStreetMap: ${reverse.error}`)
  const address = reverse.address ?? {}
  const street = [address.house_number, address.road].filter(Boolean).join(' ')
  const nearby = await nearbyPlaces(lat, lon)
  const fallback = reverse.name && reverse.name !== address.road ? [{ name: reverse.name, type: reverse.type ?? null, address: null, placeId: null, lat: Number(reverse.lat), lon: Number(reverse.lon) }] : []
  return {
    address: [street, address.neighbourhood ?? address.suburb, address.postcode].filter(Boolean).join(', ') || reverse.display_name,
    placeId: null,
    street: address.road ?? null,
    places: nearby ?? fallback,
    note: nearby ? undefined : 'Nearby places are unavailable right now (OpenStreetMap Overpass servers are busy).',
  }
}
