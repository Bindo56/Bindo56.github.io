import type { GeoPoint } from './georef'

// The real-world map on the calibration page: Google Maps when a working key is set,
// OpenStreetMap (Leaflet) otherwise. Both expose the same small surface.

export type MapProvider = 'google' | 'osm'
export type MapPoint = { geo: GeoPoint; label: string; colour: string }
export type MapEvents = { click(geo: GeoPoint): void; hover(geo: GeoPoint): void; leave(): void }
export type MapAdapter = {
  provider: MapProvider
  panTo(geo: GeoPoint): void
  setPending(geo: GeoPoint | null): void
  setGhost(geo: GeoPoint | null): void
  setPoints(points: MapPoint[]): void
}

const START: GeoPoint = { lat: 40.7549, lon: -73.984 }

type LatLngLiteral = { lat: number; lng: number }
type MapsMouseEvent = { latLng: { lat(): number; lng(): number } | null }
type GoogleMap = { addListener(event: string, handler: (event: MapsMouseEvent) => void): void; panTo(position: LatLngLiteral): void }
type AdvancedMarker = { position: LatLngLiteral | null; map: GoogleMap | null }
type GoogleMapsApi = {
  Map: new (element: HTMLElement, options: object) => GoogleMap
  marker: { AdvancedMarkerElement: new (options: object) => AdvancedMarker }
}
declare global {
  interface Window { google?: { maps: GoogleMapsApi }; __calibrateMapsReady?: () => void; gm_authFailure?: () => void }
}

function markerElement(className: string, colour?: string) {
  const element = document.createElement('div')
  element.className = `cal-marker ${className}`
  if (colour) element.style.background = colour
  return element
}

/** Resolves once the map is up. `onFailure` covers key problems Google reports after loading. */
export function loadGoogleMap(container: HTMLElement, key: string, events: MapEvents, onFailure: (reason: string) => void) {
  return new Promise<MapAdapter>((resolve, reject) => {
    let ready = false
    const fail = (reason: string) => (ready ? onFailure(reason) : reject(new Error(reason)))
    window.gm_authFailure = () => fail('Google refused the key (quota used up, API not enabled, or billing missing).')
    window.__calibrateMapsReady = () => {
      const maps = window.google!.maps
      const map = new maps.Map(container, {
        center: { lat: START.lat, lng: START.lon },
        zoom: 15,
        mapId: 'DEMO_MAP_ID',
        clickableIcons: false,
        streetViewControl: false,
        fullscreenControl: false,
      })
      const pending = new maps.marker.AdvancedMarkerElement({ content: markerElement('pending'), zIndex: 3 })
      const ghost = new maps.marker.AdvancedMarkerElement({ content: markerElement('ghost'), zIndex: 2 })
      let points: AdvancedMarker[] = []
      const toGeo = (event: MapsMouseEvent) => (event.latLng ? { lat: event.latLng.lat(), lon: event.latLng.lng() } : null)
      map.addListener('click', (event) => { const geo = toGeo(event); if (geo) events.click(geo) })
      map.addListener('mousemove', (event) => { const geo = toGeo(event); if (geo) events.hover(geo) })
      map.addListener('mouseout', () => events.leave())
      const place = (marker: AdvancedMarker, geo: GeoPoint | null) => {
        marker.position = geo ? { lat: geo.lat, lng: geo.lon } : null
        marker.map = geo ? map : null
      }
      ready = true
      resolve({
        provider: 'google',
        panTo: (geo) => map.panTo({ lat: geo.lat, lng: geo.lon }),
        setPending: (geo) => place(pending, geo),
        setGhost: (geo) => place(ghost, geo),
        setPoints: (next) => {
          for (const marker of points) marker.map = null
          points = next.map((point) => new maps.marker.AdvancedMarkerElement({
            map,
            position: { lat: point.geo.lat, lng: point.geo.lon },
            title: point.label,
            content: markerElement('point', point.colour),
          }))
        },
      })
    }
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&libraries=marker&loading=async&callback=__calibrateMapsReady`
    script.async = true
    script.onerror = () => fail('Could not load Google Maps (network or key problem).')
    document.head.append(script)
  })
}

/** OpenStreetMap tiles through Leaflet; free, no key. */
export async function loadOsmMap(container: HTMLElement, events: MapEvents): Promise<MapAdapter> {
  const module = await import('leaflet')
  await import('leaflet/dist/leaflet.css')
  const L = (module as unknown as { default?: typeof module }).default ?? module
  const map = L.map(container, { zoomControl: false }).setView([START.lat, START.lon], 16)
  L.control.zoom({ position: 'topright' }).addTo(map)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  }).addTo(map)
  new ResizeObserver(() => map.invalidateSize()).observe(container)

  const pointLayer = L.layerGroup().addTo(map)
  const pending = L.circleMarker([0, 0], { radius: 9, color: '#3a2a00', weight: 2, fillColor: '#ffd25e', fillOpacity: 1, interactive: false })
  const ghost = L.circleMarker([0, 0], { radius: 7, color: '#ff4fd8', weight: 2, fill: false, interactive: false })
  map.on('click', (event) => events.click({ lat: event.latlng.lat, lon: event.latlng.lng }))
  map.on('mousemove', (event) => events.hover({ lat: event.latlng.lat, lon: event.latlng.lng }))
  map.on('mouseout', () => events.leave())
  const place = (marker: typeof pending, geo: GeoPoint | null) => {
    if (geo) marker.setLatLng([geo.lat, geo.lon]).addTo(map)
    else marker.remove()
  }

  return {
    provider: 'osm',
    panTo: (geo) => map.panTo([geo.lat, geo.lon]),
    setPending: (geo) => place(pending, geo),
    setGhost: (geo) => place(ghost, geo),
    setPoints: (points) => {
      pointLayer.clearLayers()
      for (const point of points) {
        L.circleMarker([point.geo.lat, point.geo.lon], { radius: 6, color: '#0b1c20', weight: 2, fillColor: point.colour, fillOpacity: 1 })
          .bindTooltip(point.label)
          .addTo(pointLayer)
      }
    },
  }
}
