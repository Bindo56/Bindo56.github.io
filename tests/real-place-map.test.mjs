import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createGeoref } from '../src/worlds/georef.ts'
import { buildRealPlaceMap } from '../server/population/real-place-map.mjs'

const georefData = JSON.parse(readFileSync(new URL('../public/assets/nju-jork/georef.json', import.meta.url)))
const georef = createGeoref(georefData.points)
const point = { lat: 40.755, lon: -73.985 }
const { x, z } = georef.toWorld(point)
const building = { id: 'W1', name: 'Test building', address: '123 W 42nd St, New York, NY',
  x, z, bounds: [x - 2, z - 2, x + 2, z + 2], roofY: 30 }
const base = { roadNetwork: { zones: { city: { buildings: [building] } } }, georefData,
  osmBuildings: [], osmPlaces: [], restaurantRows: [], fetchedAt: {} }

test('PLUTO lot uses require a matching building street address', () => {
  const catalog = buildRealPlaceMap({ ...base, plutoRows: [
    { bbl: '1000000001', address: '999 W 42nd St', latitude: point.lat, longitude: point.lon,
      unitsres: '100', officearea: '20000', retailarea: '5000' },
  ] })
  assert.deepEqual(catalog.buildings[0].uses, [])
  assert.equal(catalog.buildings[0].unitsRes, 0)
  assert.equal(catalog.coverage.matchedLots, 1)
})

test('matching PLUTO address classifies residential and office use', () => {
  const catalog = buildRealPlaceMap({ ...base, plutoRows: [
    { bbl: '1000000002', address: '123 West 42 Street', latitude: point.lat, longitude: point.lon,
      unitsres: '45', officearea: '20000', retailarea: '0' },
  ] })
  assert.deepEqual(catalog.buildings[0].uses, ['home', 'office'])
  assert.equal(catalog.buildings[0].unitsRes, 45)
  assert.equal(catalog.buildings[0].officeAreaSqFt, 20000)
})

test('an inspected coffee shop maps to the existing 3D building', () => {
  const catalog = buildRealPlaceMap({ ...base, plutoRows: [], restaurantRows: [
    { camis: '12345', dba: 'Test Coffee', building: '123', street: 'W 42ND ST',
      cuisine_description: 'Coffee/Tea', latitude: point.lat, longitude: point.lon },
  ] })
  assert.equal(catalog.places.length, 1)
  assert.equal(catalog.places[0].anchorId, 'W1')
  assert.equal(catalog.places[0].kind, 'cafe')
  assert.equal(catalog.places[0].source, 'NYC DOHMH')
})
