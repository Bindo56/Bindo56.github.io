import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { loadEnv, type Plugin } from 'vite'
import { OsmError, osmLookup, osmSearch } from './osm'

// Dev-only endpoints for the calibration page (worlds/clockwork-city/calibrate.html).
// GOOGLE_MAPS_API_KEY is read from .env.local; it never ships in the production build.
// Add provider=osm to geocode/lookup to use OpenStreetMap instead of Google (no key needed).
//   GET  /api/georef/config                    → { hasKey, mapsKey }
//   GET  /api/georef/geocode?q=&provider=       → places/intersections matching a search
//   GET  /api/georef/lookup?lat=&lon=&provider= → real address, street and nearby places
//   POST /api/georef/points                     → saves public/assets/nju-jork/georef.json

const NYC_BOUNDS = '40.49,-74.27|40.92,-73.68'
const GEOREF_FILE = 'public/assets/nju-jork/georef.json'

type GeocodeResult = {
  formatted_address: string
  place_id: string
  types: string[]
  geometry: { location: { lat: number; lng: number } }
  address_components: { long_name: string; short_name: string; types: string[] }[]
}
type GeocodeResponse = { status: string; error_message?: string; results: GeocodeResult[] }
type NearbyPlace = {
  id: string
  displayName?: { text: string }
  formattedAddress?: string
  primaryType?: string
  types?: string[]
  location?: { latitude: number; longitude: number }
}

class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function georefApi(): Plugin {
  let apiKey: string | undefined
  let root = process.cwd()
  const lookups = new Map<string, unknown>()

  async function google<T>(url: string, init: RequestInit = {}): Promise<T> {
    if (!apiKey) throw new ApiError(503, 'GOOGLE_MAPS_API_KEY is not set in .env.local (restart the dev server after adding it).')
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
    const body = (await response.json().catch(() => ({}))) as T & { status?: string; error_message?: string; error?: { message?: string } }
    const failure = body.error?.message ?? (body.status && !['OK', 'ZERO_RESULTS'].includes(body.status) ? `${body.status}: ${body.error_message ?? ''}` : '')
    if (!response.ok || failure) throw new ApiError(502, `Google: ${failure || `HTTP ${response.status}`}`)
    return body
  }

  async function geocode(query: string) {
    const params = new URLSearchParams({ address: query, bounds: NYC_BOUNDS, region: 'us', key: apiKey ?? '' })
    const data = await google<GeocodeResponse>(`https://maps.googleapis.com/maps/api/geocode/json?${params}`)
    return data.results.slice(0, 6).map((result) => ({
      label: result.formatted_address,
      lat: result.geometry.location.lat,
      lon: result.geometry.location.lng,
      placeId: result.place_id,
      types: result.types,
    }))
  }

  async function lookup(lat: number, lon: number) {
    const cacheKey = `${lat.toFixed(5)},${lon.toFixed(5)}`
    if (lookups.has(cacheKey)) return lookups.get(cacheKey)
    const reverseParams = new URLSearchParams({ latlng: `${lat},${lon}`, key: apiKey ?? '' })
    const [reverse, nearby] = await Promise.all([
      google<GeocodeResponse>(`https://maps.googleapis.com/maps/api/geocode/json?${reverseParams}`),
      google<{ places?: NearbyPlace[] }>('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey ?? '',
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.primaryType,places.types,places.location',
        },
        body: JSON.stringify({
          maxResultCount: 5,
          rankPreference: 'DISTANCE',
          locationRestriction: { circle: { center: { latitude: lat, longitude: lon }, radius: 60 } },
        }),
      }),
    ])
    const best = reverse.results[0]
    const street = reverse.results
      .flatMap((result) => result.address_components)
      .find((component) => component.types.includes('route'))
    const result = {
      address: best?.formatted_address ?? null,
      placeId: best?.place_id ?? null,
      street: street?.long_name ?? null,
      places: (nearby.places ?? []).map((place) => ({
        name: place.displayName?.text ?? '',
        type: place.primaryType ?? place.types?.[0] ?? null,
        address: place.formattedAddress ?? null,
        placeId: place.id,
        lat: place.location?.latitude ?? null,
        lon: place.location?.longitude ?? null,
      })),
    }
    if (lookups.size > 2000) lookups.clear()
    lookups.set(cacheKey, result)
    return result
  }

  function savePoints(body: unknown) {
    const data = body as { version?: unknown; zone?: unknown; note?: unknown; points?: unknown }
    if (data?.version !== 1 || typeof data.zone !== 'string' || !Array.isArray(data.points)) throw new ApiError(400, 'Expected { version: 1, zone, points: [] }.')
    const points = data.points.map((value, index) => {
      const point = value as { id?: unknown; label?: unknown; world?: unknown; geo?: unknown; source?: unknown }
      const world = point.world as number[]
      const geo = point.geo as number[]
      const valid = typeof point.id === 'string' && typeof point.label === 'string' && Array.isArray(world) && Array.isArray(geo)
        && world.length === 2 && geo.length === 2 && [...world, ...geo].every(Number.isFinite)
        && Math.abs(geo[0]) <= 90 && Math.abs(geo[1]) <= 180
      if (!valid) throw new ApiError(400, `Point ${index + 1} is malformed.`)
      return { id: point.id, label: point.label, world: [world[0], world[1]], geo: [geo[0], geo[1]], source: typeof point.source === 'string' ? point.source : 'calibration' }
    })
    if (points.length < 2) throw new ApiError(400, 'Keep at least two points.')
    const file = resolve(root, GEOREF_FILE)
    const previous = JSON.parse(readFileSync(file, 'utf8')) as { note?: string }
    // One point per line keeps diffs readable.
    const lines = points.map((point) =>
      `    { "id": ${JSON.stringify(point.id)}, "label": ${JSON.stringify(point.label)}, "world": [${point.world.join(', ')}], "geo": [${point.geo.join(', ')}], "source": ${JSON.stringify(point.source)} }`)
    const text = `{\n  "version": 1,\n  "zone": ${JSON.stringify(data.zone)},\n  "note": ${JSON.stringify(typeof data.note === 'string' ? data.note : previous.note ?? '')},\n  "points": [\n${lines.join(',\n')}\n  ]\n}\n`
    writeFileSync(`${file}.tmp`, text)
    renameSync(`${file}.tmp`, file)
    return { saved: points.length }
  }

  async function route(req: IncomingMessage, url: URL) {
    switch (`${req.method} ${url.pathname}`) {
      case 'GET /api/georef/config':
        return { hasKey: Boolean(apiKey), mapsKey: apiKey ?? null }
      case 'GET /api/georef/geocode': {
        const query = url.searchParams.get('q')?.trim()
        if (!query) throw new ApiError(400, 'Pass q=')
        return url.searchParams.get('provider') === 'osm' ? osmSearch(query) : geocode(query)
      }
      case 'GET /api/georef/lookup': {
        const lat = Number(url.searchParams.get('lat'))
        const lon = Number(url.searchParams.get('lon'))
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new ApiError(400, 'Pass lat= and lon=')
        return url.searchParams.get('provider') === 'osm' ? osmLookup(lat, lon) : lookup(lat, lon)
      }
      case 'POST /api/georef/points':
        return savePoints(JSON.parse(await readBody(req)))
      default:
        return undefined
    }
  }

  return {
    name: 'georef-api',
    apply: 'serve',
    configResolved(config) {
      root = config.root
      const envDir = typeof config.envDir === 'string' ? config.envDir : config.root
      apiKey = loadEnv(config.mode, envDir, '').GOOGLE_MAPS_API_KEY?.trim() || undefined
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (!url.pathname.startsWith('/api/georef/')) return next()
        route(req, url).then(
          (result) => (result === undefined ? sendJson(res, 404, { error: 'Not found' }) : sendJson(res, 200, result)),
          (error: unknown) => sendJson(res, error instanceof ApiError ? error.status : error instanceof OsmError ? 502 : 500, { error: error instanceof Error ? error.message : String(error) }),
        )
      })
    },
  }
}

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolveBody, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      body += chunk
      if (body.length > 1_000_000) reject(new ApiError(413, 'Body too large'))
    })
    req.on('end', () => resolveBody(body))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}
