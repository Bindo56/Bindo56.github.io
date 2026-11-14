import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildRealPlaceMap } from '../server/population/real-place-map.mjs'

const root = resolve(import.meta.dirname, '..')
const source = resolve(root, '.cache/nyc-place-sources')
const read = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const pluto = read('.cache/nyc-place-sources/pluto.json')
const restaurants = read('.cache/nyc-place-sources/restaurants.json')
const osm = read('.cache/nyc-place-sources/osm-places.json')
const osmBuildings = [0, 1, 2, 3].flatMap((band) => read(`.cache/manhattan-osm/buildings-${band}.json`).elements)
const catalog = buildRealPlaceMap({
  roadNetwork: read('public/assets/nju-jork/road-network.json'),
  georefData: read('public/assets/nju-jork/georef.json'),
  osmBuildings, plutoRows: pluto.rows, restaurantRows: restaurants.rows, osmPlaces: osm.elements,
  fetchedAt: { pluto: pluto.fetchedAt, restaurants: restaurants.fetchedAt, osm: osm.fetchedAt },
})
const output = resolve(root, 'public/assets/nju-jork/place-catalog.json')
writeFileSync(output, JSON.stringify(catalog))
const counts = Object.fromEntries([...new Set(catalog.places.map((place) => place.kind))].sort()
  .map((kind) => [kind, catalog.places.filter((place) => place.kind === kind).length]))
console.log(JSON.stringify({ output, bytes: readFileSync(output).length, coverage: catalog.coverage, places: counts }, null, 2))
