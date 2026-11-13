// Ties Nju Jork to real New York so buildings can ask for posts made at the matching place.
// Nju Jork uses Manhattan geometry at about 3 m per block. The city zone's
// mapping comes from public/assets/nju-jork/georef.json (shared with the calibration tool).

import { createGeoref, type ControlPoint, type Georef, type GeorefData } from './georef'

export { googleMapsUrl } from './georef'

export type GeoPoint = { lat: number; lon: number }
export type BlockPoint = { x: number; z: number }

/** A real place to watch: coordinates for location posts, keywords for posts without a location. */
export type Place = {
  id: string
  name: string
  lat: number
  lon: number
  radiusM: number
  keywords: string[]
  /** Nju Jork building that stands in for it, when it has been identified in the model */
  buildingId?: string
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180

// The detached tower strip is not part of the Manhattan replica. It stands in for the Long Island
// City waterfront across the East River: 4 m per block, block north turned 22° east of true north.
const DETACHED_POINTS: ControlPoint[] = [
  { id: 'detached-center', label: 'Gantry Plaza', world: [6030, 6116], geo: [40.7438, -73.9592], source: 'stand-in' },
  { id: 'detached-north', label: '400 m up the waterfront', world: [6030, 6016], geo: [40.747154, -73.957424], source: 'stand-in' },
]

const georefs = new Map<string, Georef>([['detached', createGeoref(DETACHED_POINTS)]])

/** Loads the shared control points; returns false (and keeps the city unmapped) if the file is missing or invalid. */
export async function loadGeoref(url: string) {
  try {
    const response = await fetch(url)
    if (!response.ok) return false
    const data = (await response.json()) as GeorefData
    const points = Array.isArray(data.points) ? data.points.filter(isControlPoint) : []
    if (data.version !== 1 || typeof data.zone !== 'string' || points.length < 2) return false
    georefs.set(data.zone, createGeoref(points))
    return true
  } catch {
    return false
  }
}

const isFiniteNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
const isControlPoint = (point: ControlPoint) =>
  Array.isArray(point?.world) && Array.isArray(point.geo) && [...point.world, ...point.geo].length === 4 &&
  [...point.world, ...point.geo].every(isFiniteNumber)

/** How far (blocks) an unidentified landmark may be from the building that stands in for it. */
const LANDMARK_REACH: Record<string, number> = { city: 60, detached: 120 }

export function blockToGeo(zoneId: string, x: number, z: number): GeoPoint | null {
  return georefs.get(zoneId)?.toGeo({ x, z }) ?? null
}

export function geoToBlock(zoneId: string, lat: number, lon: number): BlockPoint | null {
  return georefs.get(zoneId)?.toWorld({ lat, lon }) ?? null
}

export function distanceM(a: GeoPoint, b: GeoPoint) {
  const dLat = toRadians(b.lat - a.lat)
  const dLon = toRadians(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)))
}

const place = (id: string, name: string, lat: number, lon: number, radiusM: number, keywords: string[], buildingId?: string): Place =>
  ({ id, name, lat, lon, radiusM, keywords, buildingId })

/** Landmarks in priority order. Identified ones name their building; the rest claim the nearest free one. */
export const LANDMARKS: Record<string, Place[]> = {
  city: [
    place('empire-state', 'Empire State Building', 40.7484, -73.9857, 200, ['Empire State Building', 'Empire State', 'ESB'], 'B0471'),
    place('grand-central', 'Grand Central Terminal', 40.7527, -73.9772, 220, ['Grand Central', 'Grand Central Terminal', 'MetLife Building'], 'B0398'),
    place('one-vanderbilt', 'One Vanderbilt', 40.7531, -73.9787, 150, ['One Vanderbilt', 'SUMMIT One Vanderbilt'], 'B0406'),
    place('chrysler', 'Chrysler Building', 40.7516, -73.9755, 150, ['Chrysler Building'], 'B0407'),
    place('msg', 'Madison Square Garden & Penn Station', 40.7505, -73.9934, 250, ['Madison Square Garden', 'MSG', 'Penn Station', 'Moynihan Train Hall'], 'B0484'),
    place('javits', 'Javits Center', 40.7577, -74.0023, 300, ['Javits Center', 'Javits', 'NY Comic Con', 'NYCC'], 'B0452'),
    place('columbus-circle', 'Columbus Circle', 40.7685, -73.9829, 250, ['Columbus Circle', 'Time Warner Center', 'Deutsche Bank Center', 'Central Park South'], 'B0234'),
    place('united-nations', 'United Nations', 40.7489, -73.968, 300, ['United Nations', 'UN Headquarters', 'UN General Assembly', 'UNGA'], 'B0390'),
    place('one-wtc', 'One World Trade Center', 40.713, -74.0132, 300, ['One World Trade', 'World Trade Center', 'One WTC', 'Freedom Tower', '9/11 Memorial', 'Oculus'], 'B0639'),
    place('hudson-yards', 'Hudson Yards', 40.7537, -74.0007, 300, ['Hudson Yards', 'The Vessel', 'The Edge NYC', 'The Shed'], 'B0475'),
    place('bryant-park', 'Bryant Park & Library', 40.7557, -73.9845, 220, ['Bryant Park', 'New York Public Library', 'NYPL', 'Bank of America Tower'], 'B0404'),
    place('queensboro', 'Queensboro Bridge', 40.7571, -73.9545, 400, ['Queensboro Bridge', '59th Street Bridge', 'Ed Koch Queensboro Bridge'], 'B0232'),
    place('brooklyn-bridge', 'Brooklyn Bridge', 40.7061, -73.9969, 400, ['Brooklyn Bridge'], 'B0619'),
    place('times-square', 'Times Square', 40.758, -73.9855, 250, ['Times Square', 'TimesSquare', 'Theater District']),
    place('rockefeller', 'Rockefeller Center', 40.7587, -73.9787, 220, ['Rockefeller Center', 'Rockefeller Plaza', 'Top of the Rock', '30 Rock', 'Radio City']),
    place('herald-square', "Herald Square & Macy's", 40.7505, -73.9884, 200, ['Herald Square', "Macy's Herald Square", 'Koreatown', 'K-Town']),
    place('port-authority', 'Port Authority Bus Terminal', 40.757, -73.9903, 200, ['Port Authority', 'Port Authority Bus Terminal']),
    place('st-patricks', "St. Patrick's Cathedral", 40.7585, -73.976, 180, ["St. Patrick's Cathedral", 'St Patricks Cathedral', 'Saks Fifth Avenue']),
    place('moma', 'Museum of Modern Art', 40.7614, -73.9776, 180, ['MoMA', 'Museum of Modern Art']),
    place('carnegie-hall', 'Carnegie Hall', 40.7651, -73.9799, 200, ['Carnegie Hall', 'Billionaires Row', "Billionaires' Row"]),
    place('lincoln-center', 'Lincoln Center', 40.7725, -73.9835, 250, ['Lincoln Center', 'Metropolitan Opera', 'The Met Opera']),
    place('flatiron', 'Flatiron Building', 40.7411, -73.9897, 200, ['Flatiron Building', 'Flatiron', 'Madison Square Park', 'NoMad']),
    place('nyse', 'New York Stock Exchange', 40.7069, -74.0113, 200, ['New York Stock Exchange', 'NYSE', 'Federal Hall']),
    place('trinity', 'Trinity Church', 40.7081, -74.0119, 150, ['Trinity Church']),
    place('charging-bull', 'Charging Bull', 40.7056, -74.0134, 150, ['Charging Bull', 'Fearless Girl', 'Bowling Green']),
    place('city-hall', 'City Hall', 40.7128, -74.006, 200, ['City Hall Park', 'NYC City Hall', 'New York City Hall']),
    place('seaport', 'South Street Seaport', 40.7065, -74.0036, 250, ['South Street Seaport', 'Seaport District', 'Pier 17']),
    place('battery-park', 'Battery Park', 40.7033, -74.017, 300, ['Battery Park', 'Staten Island Ferry', 'Castle Clinton']),
  ],
  detached: [
    place('gantry-plaza', 'Gantry Plaza State Park', 40.7454, -73.9584, 250, ['Gantry Plaza', 'Pepsi-Cola sign', 'Pepsi Cola sign']),
    place('hunters-point-south', 'Hunters Point South', 40.7404, -73.9605, 300, ['Hunters Point South', 'Hunters Point']),
  ],
}

/** Neighborhood areas for when the camera is over a part of the city with no landmark nearby. */
export const NEIGHBORHOODS: Record<string, Place[]> = {
  city: [
    place('upper-west-side', 'Upper West Side', 40.787, -73.9754, 900, ['Upper West Side', 'UWS']),
    place('upper-east-side', 'Upper East Side', 40.7736, -73.9566, 900, ['Upper East Side', 'UES']),
    place('lincoln-square', 'Lincoln Square', 40.7736, -73.9843, 600, ['Lincoln Center', 'Lincoln Square']),
    place('central-park', 'Central Park', 40.7712, -73.9742, 900, ['Central Park']),
    place('central-park-south', 'Central Park South', 40.765, -73.979, 600, ['Central Park South', "Billionaires' Row", 'Carnegie Hall']),
    place('hells-kitchen', "Hell's Kitchen", 40.7638, -73.9918, 700, ["Hell's Kitchen", 'Hells Kitchen']),
    place('theater-district', 'Theater District', 40.759, -73.9845, 500, ['Times Square', 'Theater District', 'Broadway show']),
    place('midtown', 'Midtown', 40.7549, -73.984, 600, ['Midtown', 'Midtown Manhattan']),
    place('midtown-east', 'Midtown East', 40.7527, -73.972, 700, ['Midtown East', 'Turtle Bay', 'Sutton Place']),
    place('murray-hill', 'Murray Hill', 40.7479, -73.9757, 600, ['Murray Hill']),
    place('garment-district', 'Garment District', 40.7547, -73.9916, 500, ['Garment District', 'Fashion District']),
    place('koreatown', 'Koreatown', 40.7478, -73.9866, 400, ['Koreatown', 'K-Town', 'Herald Square']),
    place('hudson-yards', 'Hudson Yards', 40.7536, -74.001, 600, ['Hudson Yards', 'The Vessel', 'Javits Center']),
    place('chelsea', 'Chelsea', 40.7465, -74.0014, 800, ['Chelsea Market', 'High Line', 'Chelsea NYC', 'Chelsea Manhattan']),
    place('nomad', 'NoMad & Flatiron', 40.742, -73.988, 700, ['NoMad', 'Flatiron', 'Madison Square Park']),
    place('kips-bay', 'Kips Bay & Gramercy', 40.74, -73.98, 700, ['Kips Bay', 'Gramercy']),
    place('greenwich-village', 'Greenwich Village', 40.7336, -74.0027, 800, ['Greenwich Village', 'West Village', 'Washington Square']),
    place('east-village', 'East Village', 40.7265, -73.9815, 800, ['East Village', 'St. Marks Place']),
    place('soho', 'SoHo', 40.7233, -74.003, 600, ['SoHo NYC', 'SoHo Manhattan', 'Nolita']),
    place('chinatown', 'Chinatown & Little Italy', 40.7158, -73.997, 600, ['Chinatown NYC', 'Manhattan Chinatown', 'Little Italy']),
    place('lower-east-side', 'Lower East Side', 40.715, -73.9843, 700, ['Lower East Side']),
    place('tribeca', 'Tribeca', 40.7163, -74.0086, 600, ['Tribeca', 'TriBeCa']),
    place('battery-park-city', 'Battery Park City', 40.7116, -74.0158, 600, ['Battery Park City', 'Brookfield Place']),
    place('fidi', 'Financial District', 40.7075, -74.0113, 600, ['Financial District', 'FiDi', 'Lower Manhattan', 'Stone Street']),
  ],
  detached: [
    place('long-island-city', 'Long Island City', 40.7447, -73.9485, 900, ['Long Island City', 'Court Square', 'MoMA PS1']),
    place('hunters-point', 'Hunters Point', 40.742, -73.957, 600, ['Hunters Point', 'Gantry Plaza']),
  ],
}

/** Maps building id → landmark: identified buildings first, then each landmark claims the nearest free building. */
export function assignLandmarks(zoneId: string, buildings: (BlockPoint & { id: string })[]) {
  const assigned = new Map<string, Place>()
  const reach = LANDMARK_REACH[zoneId]
  if (reach === undefined) return assigned
  const ids = new Set(buildings.map((building) => building.id))
  const landmarks = LANDMARKS[zoneId] ?? []
  for (const landmark of landmarks) if (landmark.buildingId && ids.has(landmark.buildingId)) assigned.set(landmark.buildingId, landmark)
  for (const landmark of landmarks) {
    if (landmark.buildingId) continue
    const spot = geoToBlock(zoneId, landmark.lat, landmark.lon)
    if (!spot) continue
    let best: string | undefined
    let bestDistance = reach
    for (const building of buildings) {
      if (assigned.has(building.id)) continue
      const distance = Math.hypot(building.x - spot.x, building.z - spot.z)
      if (distance < bestDistance) {
        best = building.id
        bestDistance = distance
      }
    }
    if (best) assigned.set(best, landmark)
  }
  return assigned
}

export function nearestPlace(places: Place[], point: GeoPoint) {
  let best: Place | undefined
  let bestDistance = Infinity
  for (const candidate of places) {
    const distance = distanceM(point, candidate)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whole-word, case-insensitive test for any of the place's keywords. */
export function placePattern(target: Place) {
  const body = target.keywords.map((keyword) => escapeRegExp(keyword).replace(/\s+/g, '\\s+')).join('|')
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${body})(?![\\p{L}\\p{N}_])`, 'iu')
}
