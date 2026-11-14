import { createGeoref } from '../../src/worlds/georef.ts'

const CELL = 16
const HOME_TAGS = new Set(['apartments', 'residential', 'house', 'detached', 'terrace', 'dormitory'])
const OFFICE_TAGS = new Set(['office'])
const BUILDING_KINDS = new Map([
  ['school', 'school'], ['college', 'school'], ['university', 'school'],
  ['hospital', 'clinic'], ['library', 'library'], ['retail', 'retail'],
  ['commercial', 'retail'], ['bank', 'office'], ['civic', 'community'],
  ['public', 'community'], ['government', 'community'],
])
const AMENITY_KINDS = new Map([
  ['cafe', 'cafe'], ['restaurant', 'restaurant'], ['fast_food', 'restaurant'],
  ['bar', 'restaurant'], ['pub', 'restaurant'], ['school', 'school'],
  ['college', 'school'], ['university', 'school'], ['clinic', 'clinic'],
  ['hospital', 'clinic'], ['doctors', 'clinic'], ['pharmacy', 'clinic'],
  ['library', 'library'], ['community_centre', 'community'],
  ['bank', 'office'], ['post_office', 'community'],
])
const GROCERY_SHOPS = new Set(['supermarket', 'convenience', 'grocery', 'greengrocer', 'food', 'deli'])

export function addressKey(value) {
  return String(value ?? '').split(',')[0].toUpperCase()
    .replace(/\bWEST\b/g, 'W').replace(/\bEAST\b/g, 'E')
    .replace(/\bSTREET\b/g, 'ST').replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bBOULEVARD\b/g, 'BLVD').replace(/\bROAD\b/g, 'RD')
    .replace(/(\d+)(?:ST|ND|RD|TH)\b/g, '$1')
    .replace(/[^A-Z0-9]/g, '')
}

function squareDistanceToBounds(x, z, [minX, minZ, maxX, maxZ]) {
  const dx = Math.max(minX - x, 0, x - maxX)
  const dz = Math.max(minZ - z, 0, z - maxZ)
  return dx * dx + dz * dz
}

function gridKey(x, z) { return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}` }

function buildingIndex(buildings) {
  const grid = new Map()
  for (const building of buildings) {
    const [minX, minZ, maxX, maxZ] = building.bounds
    for (let cx = Math.floor((minX - 4) / CELL); cx <= Math.floor((maxX + 4) / CELL); cx++) {
      for (let cz = Math.floor((minZ - 4) / CELL); cz <= Math.floor((maxZ + 4) / CELL); cz++) {
        const key = `${cx},${cz}`
        const list = grid.get(key) ?? []
        list.push(building)
        grid.set(key, list)
      }
    }
  }
  return (x, z, address = '') => {
    const target = addressKey(address)
    const candidates = grid.get(gridKey(x, z)) ?? []
    let best = null
    for (const building of candidates) {
      const distance2 = squareDistanceToBounds(x, z, building.bounds)
      const sameAddress = !!target && target === addressKey(building.address)
      if (distance2 > (sameAddress ? 64 : 16)) continue
      const score = distance2 - (sameAddress ? 16 : 0)
      if (!best || score < best.score || (score === best.score && building.id < best.building.id)) {
        best = { building, distance2, sameAddress, score }
      }
    }
    return best
  }
}

function kindForOsm(tags) {
  if (AMENITY_KINDS.has(tags.amenity)) return AMENITY_KINDS.get(tags.amenity)
  if (GROCERY_SHOPS.has(tags.shop)) return 'grocery'
  if (tags.shop && tags.shop !== 'vacant' && tags.shop !== 'no') return 'retail'
  if (tags.office && tags.office !== 'no') return 'office'
  return null
}

function cafeFromHealth(row) {
  return /^(coffee\/tea|caf[eé])$/i.test(row.cuisine_description ?? '') ||
    /\b(coffee|cafe|café|espresso|roasters|teahouse|tea house)\b/i.test(row.dba ?? '')
}

function placeLabel(tags, kind) {
  return tags.name || tags.brand || tags.operator || `${kind.replaceAll('_', ' ')} (unnamed)`
}

function compactPlace(place) {
  return { id: place.id, anchorId: place.anchorId, kind: place.kind, label: place.label,
    source: place.source, sourceId: place.sourceId, match: place.match,
    distanceM: place.distanceM == null ? null : Math.round(place.distanceM * 10) / 10 }
}

/** Build a place catalog only for buildings that already exist in the 3D map. */
export function buildRealPlaceMap({ roadNetwork, georefData, osmBuildings, plutoRows, restaurantRows, osmPlaces, fetchedAt }) {
  const buildings = Object.values(roadNetwork.zones).flatMap((zone) => zone.buildings)
  const byId = new Map(buildings.map((building) => [building.id, {
    id: building.id, name: building.name, address: building.address, x: building.x, z: building.z,
    bounds: building.bounds, roofY: building.roofY, uses: new Set(),
    sources: [], bbls: new Set(), unitsRes: 0, officeAreaSqFt: 0, retailAreaSqFt: 0,
  }]))
  const match = buildingIndex(buildings)
  const georef = createGeoref(georefData.points)
  const toWorld = (row) => georef.toWorld({ lat: Number(row.latitude ?? row.lat ?? row.center?.lat),
    lon: Number(row.longitude ?? row.lon ?? row.center?.lon) })
  const osmById = new Map(osmBuildings.map((item) => [`${item.type === 'way' ? 'W' : 'R'}${item.id}`, item]))
  for (const entry of byId.values()) {
    const tags = osmById.get(entry.id)?.tags ?? {}
    if (HOME_TAGS.has(tags.building)) entry.uses.add('home')
    if (OFFICE_TAGS.has(tags.building) || (tags.office && tags.office !== 'no')) entry.uses.add('office')
    if (BUILDING_KINDS.has(tags.building)) entry.uses.add(BUILDING_KINDS.get(tags.building))
    const amenity = kindForOsm(tags)
    if (amenity) entry.uses.add(amenity)
    if (entry.uses.size) entry.sources.push({ dataset: 'OSM building', id: entry.id })
  }

  const plutoAnchorByBbl = new Map()
  let matchedLots = 0
  for (const lot of plutoRows) {
    if (!Number.isFinite(Number(lot.latitude)) || !Number.isFinite(Number(lot.longitude))) continue
    const point = toWorld(lot)
    const found = match(point.x, point.z, lot.address)
    if (!found) continue
    const entry = byId.get(found.building.id)
    const bbl = String(lot.bbl).split('.')[0]
    entry.bbls.add(bbl)
    // A lot centroid can fall inside a neighbouring 3D footprint. Require the
    // street address to agree before using lot statistics as building uses.
    if (found.sameAddress) {
      entry.unitsRes += Math.max(0, Number(lot.unitsres) || 0)
      entry.officeAreaSqFt += Math.max(0, Number(lot.officearea) || 0)
      entry.retailAreaSqFt += Math.max(0, Number(lot.retailarea) || 0)
      if (Number(lot.unitsres) > 0 || Number(lot.resarea) > 0) entry.uses.add('home')
      if (Number(lot.officearea) > 0) entry.uses.add('office')
      if (Number(lot.retailarea) > 0) entry.uses.add('retail')
    }
    entry.sources.push({ dataset: 'NYC PLUTO 26v2', id: bbl, match: found.sameAddress ? 'address_and_footprint' : 'footprint',
      distanceM: Math.round(Math.sqrt(found.distance2) * 3) })
    plutoAnchorByBbl.set(bbl, entry.id)
    matchedLots++
  }

  const places = []
  const seenOsm = new Set()
  let matchedOsm = 0
  for (const item of osmPlaces) {
    const tags = item.tags ?? {}
    const kind = kindForOsm(tags)
    if (!kind) continue
    const point = toWorld(item)
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) continue
    const found = match(point.x, point.z, tags['addr:housenumber'] && tags['addr:street']
      ? `${tags['addr:housenumber']} ${tags['addr:street']}` : '')
    if (!found) continue
    const anchorId = found.building.id
    const sourceId = `${item.type}/${item.id}`
    if (seenOsm.has(sourceId)) continue
    seenOsm.add(sourceId)
    places.push(compactPlace({ id: `osm:${sourceId}`, anchorId, kind, label: placeLabel(tags, kind),
      source: 'OpenStreetMap', sourceId, match: found.sameAddress ? 'address_and_footprint' : 'footprint',
      distanceM: Math.sqrt(found.distance2) * 3 }))
    byId.get(anchorId).uses.add(kind)
    matchedOsm++
  }

  const seenRestaurant = new Set()
  let matchedRestaurants = 0
  for (const row of restaurantRows) {
    if (!row.camis || seenRestaurant.has(row.camis)) continue
    const point = toWorld(row)
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) continue
    const address = row.building && row.street ? `${row.building} ${row.street}` : ''
    const found = match(point.x, point.z, address)
    const anchorId = found?.building.id ?? plutoAnchorByBbl.get(String(row.bbl).split('.')[0])
    if (!anchorId) continue
    seenRestaurant.add(row.camis)
    const kind = cafeFromHealth(row) ? 'cafe' : 'restaurant'
    const distanceM = found ? Math.sqrt(found.distance2) * 3 : null
    const label = row.dba || 'Food establishment'
    const duplicate = places.findIndex((place) => place.source === 'OpenStreetMap' && place.anchorId === anchorId &&
      place.kind === kind && addressKey(place.label) === addressKey(label))
    if (duplicate >= 0) places.splice(duplicate, 1)
    places.push(compactPlace({ id: `dohmh:${row.camis}`, anchorId, kind, label: row.dba || 'Food establishment',
      source: 'NYC DOHMH', sourceId: row.camis, match: found
        ? found.sameAddress ? 'address_and_footprint' : 'footprint' : 'tax_lot', distanceM }))
    byId.get(anchorId).uses.add(kind)
    matchedRestaurants++
  }

  const catalogBuildings = [...byId.values()].map((entry) => ({
    id: entry.id, name: entry.name, address: entry.address, x: entry.x, z: entry.z,
    uses: [...entry.uses].sort(), unitsRes: entry.unitsRes, officeAreaSqFt: entry.officeAreaSqFt,
    retailAreaSqFt: entry.retailAreaSqFt, bbls: [...entry.bbls].sort(), sources: entry.sources,
  })).sort((a, b) => a.id.localeCompare(b.id))
  places.sort((a, b) => a.id.localeCompare(b.id))
  return { version: 1, zone: 'city', generatedAt: new Date().toISOString(), fetchedAt,
    sources: {
      pluto: 'https://data.cityofnewyork.us/d/64uk-42ks',
      restaurants: 'https://data.cityofnewyork.us/d/43nn-pn8j',
      osm: 'https://www.openstreetmap.org/copyright',
    },
    note: 'Tax-lot and POI matches identify possible building uses, not the actual homes or employers of real people. NPC residents and jobs remain synthetic.',
    coverage: { buildingAnchors: buildings.length, matchedLots, matchedOsm, matchedRestaurants,
      residentialBuildings: catalogBuildings.filter((entry) => entry.uses.includes('home')).length,
      officeBuildings: catalogBuildings.filter((entry) => entry.uses.includes('office')).length },
    buildings: catalogBuildings, places }
}
