import type { GeoPoint, PostGeo } from './types'

const EARTH_RADIUS_M = 6_371_008.8

const toRadians = (degrees: number) => (degrees * Math.PI) / 180

export function distanceM(a: GeoPoint, b: GeoPoint) {
  const dLat = toRadians(b.lat - a.lat)
  const dLon = toRadians(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Distance from a point to a post location; 0 when the point sits inside the post's place box. */
export function distanceToGeo(center: GeoPoint, geo: PostGeo) {
  if (!geo.bbox) return distanceM(center, geo)
  const [west, south, east, north] = geo.bbox
  return distanceM(center, { lat: clamp(center.lat, south, north), lon: clamp(center.lon, west, east) })
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const UNIT_METERS: Record<string, number> = { m: 1, km: 1000, mi: 1609.344, ft: 0.3048 }

/** Parses "300", "300m", "2.5km", "1mi" or "500ft" into meters. */
export function parseDistance(value: string | null | undefined, fallbackM: number) {
  if (!value) return fallbackM
  const match = /^\s*(\d+(?:\.\d+)?)\s*(m|km|mi|ft)?\s*$/i.exec(value)
  if (!match) throw new Error(`Invalid distance "${value}". Use a number with m, km, mi or ft.`)
  return Number(match[1]) * UNIT_METERS[(match[2] || 'm').toLowerCase()]
}

export function bboxCenter([west, south, east, north]: [number, number, number, number]): GeoPoint {
  return { lat: (south + north) / 2, lon: (west + east) / 2 }
}
