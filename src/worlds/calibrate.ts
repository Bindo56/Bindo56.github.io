import './calibrate.css'
import { loadGoogleMap, loadOsmMap, type MapAdapter, type MapEvents } from './calibrateMaps'
import { createGeoref, googleMapsUrl, type CheckResult, type ControlPoint, type GeoPoint, type Georef, type GeorefData } from './georef'

// Dev tool: match spots on the Nju Jork world map with real spots on Google Maps
// (or OpenStreetMap when there is no working key; ?map=osm forces it).
// Each matched pair tightens the world ↔ lat/lon conversion saved in georef.json.

type Zone = { id: string; bounds: [number, number, number, number]; overview: string; tiles: [number, number][] }
type Manifest = { zones: Zone[]; roadNetwork: string }
type RoadNode = { id: string; x: number; z: number }
type Building = { id: string; name: string; x: number; z: number }
type RoadNetwork = { zones: Record<string, { nodes: RoadNode[]; buildings: Building[] }> }
type SearchResult = { label: string; lat: number; lon: number }
type Lookup = { address: string | null; street: string | null; note?: string; places: { name: string; type: string | null; address: string | null }[] }

const assetBase = `${import.meta.env.BASE_URL}assets/nju-jork/`
const SNAP_PX = 10
const errorColour = (meters: number | undefined) => (meters === undefined ? '#8fa7a3' : meters < 40 ? '#73d7ae' : meters < 100 ? '#efc88f' : '#f3806b')
const formatGeo = ({ lat, lon }: GeoPoint) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
<div class="cal">
  <header class="cal-bar">
    <a href="./">← EARTH SIM (NEW YORK)</a>
    <h1>Map calibration</h1>
    <div class="cal-stats" id="cal-stats">Loading…</div>
    <button type="button" class="cal-btn" id="cal-save" disabled>Save points</button>
  </header>
  <main class="cal-main">
    <section class="cal-pane" aria-label="Nju Jork world map">
      <canvas id="cal-world"></canvas>
      <div class="cal-tag">NJU JORK WORLD</div>
      <div class="cal-readout" id="cal-world-readout">Drag to pan · scroll to zoom · click to mark a spot (snaps to intersections, Shift-click to place freely)</div>
    </section>
    <section class="cal-pane" aria-label="Real-world map">
      <div class="cal-gmap" id="cal-gmap"></div>
      <div class="cal-gmap" id="cal-osm" hidden></div>
      <div class="cal-tag" id="cal-map-tag">REAL MAP</div>
      <div class="cal-notice" id="cal-gmap-notice"><p>Loading map…</p></div>
      <div class="cal-readout top" id="cal-gmap-readout" hidden></div>
    </section>
    <aside class="cal-side">
      <form class="cal-search" id="cal-search">
        <input id="cal-query" type="search" placeholder="Find a place or intersection, e.g. W 42nd St & 8th Ave" aria-label="Search a real place" />
        <button type="submit" class="cal-btn ghost">Find</button>
      </form>
      <ul class="cal-results" id="cal-results"></ul>
      <div class="cal-pair">
        <dl>
          <dt>World</dt><dd id="cal-pending-world">Click the world map</dd>
          <dt>Real</dt><dd id="cal-pending-geo">Click the real map or search</dd>
        </dl>
        <input class="cal-label" id="cal-label" placeholder="Label, e.g. 8th Ave & W 42nd St" aria-label="Point label" />
        <div class="cal-actions">
          <button type="button" class="cal-btn" id="cal-add" disabled>Add pair</button>
          <button type="button" class="cal-btn ghost" id="cal-clear">Clear</button>
        </div>
        <div class="cal-lookup" id="cal-lookup"></div>
      </div>
      <h2>REFERENCE POINTS</h2>
      <p class="cal-help">Error = how far off each point would be if it were left out. Green under 40 m, amber under 100 m, red means check that match. Intersections give the most accurate pairs.</p>
      <ol class="cal-points" id="cal-points"></ol>
    </aside>
  </main>
</div>`

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const canvas = $<HTMLCanvasElement>('cal-world')
const context = canvas.getContext('2d')!
const statsEl = $('cal-stats')
const saveButton = $<HTMLButtonElement>('cal-save')
const addButton = $<HTMLButtonElement>('cal-add')
const labelInput = $<HTMLInputElement>('cal-label')
const lookupEl = $('cal-lookup')
const worldReadout = $('cal-world-readout')
const gmapNotice = $('cal-gmap-notice')
const gmapReadout = $('cal-gmap-readout')

let zone: Zone
let nodes: RoadNode[] = []
let buildings: Building[] = []
let data: GeorefData
let georef: Georef | null = null
let checks = new Map<string, number>()
let dirty = false

let pendingWorld: { x: number; z: number; note: string } | null = null
let pendingGeo: GeoPoint | null = null
let ghostWorld: { x: number; z: number } | null = null

const view = { cx: -450, cz: 250, scale: 0.4 }
const overview = new Image()
const detailTiles = new Map<string, HTMLImageElement>()

let realMap: MapAdapter | null = null

// ---------- fitting ----------

function refit() {
  try {
    georef = createGeoref(data.points)
    checks = new Map(georef.check().map((result: CheckResult) => [result.id, result.errorM]))
  } catch {
    georef = null
    checks = new Map()
  }
  const errors = [...checks.values()].sort((a, b) => a - b)
  const median = errors.length ? errors[Math.floor(errors.length / 2)] : undefined
  statsEl.innerHTML = georef
    ? `<b>${data.points.length}</b> points · <b>${georef.metersPerBlock.toFixed(2)}</b> m/block · rotated <b>${georef.rotationDeg.toFixed(1)}°</b> · typical error <b>${median === undefined ? '–' : Math.round(median)} m</b>, worst <b>${errors.length ? Math.round(errors[errors.length - 1]) : '–'} m</b>${dirty ? ' · unsaved changes' : ''}`
    : `<b>${data.points.length}</b> points · need at least two`
  saveButton.disabled = !dirty
  renderPointList()
  syncPointMarkers()
  draw()
}

function markDirty() {
  dirty = true
  refit()
}

// ---------- world canvas ----------

const toScreen = (x: number, z: number) => ({ x: (x - view.cx) * view.scale + canvas.clientWidth / 2, y: (z - view.cz) * view.scale + canvas.clientHeight / 2 })
const toWorld = (sx: number, sy: number) => ({ x: (sx - canvas.clientWidth / 2) / view.scale + view.cx, z: (sy - canvas.clientHeight / 2) / view.scale + view.cz })

function resize() {
  const ratio = window.devicePixelRatio || 1
  canvas.width = Math.round(canvas.clientWidth * ratio)
  canvas.height = Math.round(canvas.clientHeight * ratio)
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  draw()
}

function detailTile(rx: number, rz: number) {
  const key = `${rx}.${rz}`
  let image = detailTiles.get(key)
  if (!image) {
    image = new Image()
    image.onload = () => draw()
    image.src = `${assetBase}d.${key}.png`
    detailTiles.set(key, image)
  }
  return image
}

function cross(x: number, y: number, colour: string, size = 9) {
  context.strokeStyle = '#0b1c20'
  context.lineWidth = 4
  context.beginPath()
  context.moveTo(x - size, y); context.lineTo(x + size, y); context.moveTo(x, y - size); context.lineTo(x, y + size)
  context.stroke()
  context.strokeStyle = colour
  context.lineWidth = 2
  context.stroke()
}

let drawQueued = false
function draw() {
  if (drawQueued) return
  drawQueued = true
  requestAnimationFrame(() => {
    drawQueued = false
    paint()
  })
}

function paint() {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  context.fillStyle = '#0f2226'
  context.fillRect(0, 0, width, height)
  if (!zone || !data) return
  context.imageSmoothingEnabled = view.scale < 1
  const [minX, minZ, maxX, maxZ] = zone.bounds
  const topLeft = toScreen(minX, minZ)
  if (overview.complete && overview.naturalWidth) context.drawImage(overview, topLeft.x, topLeft.y, (maxX - minX) * view.scale, (maxZ - minZ) * view.scale)

  if (view.scale >= 0.9) {
    for (const [rx, rz] of zone.tiles) {
      const corner = toScreen(rx * 512, rz * 512)
      const size = 512 * view.scale
      if (corner.x > width || corner.y > height || corner.x + size < 0 || corner.y + size < 0) continue
      const image = detailTile(rx, rz)
      if (image.complete && image.naturalWidth) context.drawImage(image, corner.x, corner.y, size, size)
    }
  }

  if (view.scale >= 1.6) {
    // Intersections are the snap targets for accurate pairs.
    context.fillStyle = '#ffb347'
    context.strokeStyle = '#0b1c20'
    context.lineWidth = 1
    for (const node of nodes) {
      const point = toScreen(node.x, node.z)
      if (point.x < 0 || point.y < 0 || point.x > width || point.y > height) continue
      context.beginPath()
      context.arc(point.x, point.y, 2.5, 0, Math.PI * 2)
      context.fill()
      context.stroke()
    }
  }

  context.font = '600 11px "DM Sans", sans-serif'
  for (const point of data.points) {
    const screen = toScreen(point.world[0], point.world[1])
    if (screen.x < -40 || screen.y < -40 || screen.x > width + 40 || screen.y > height + 40) continue
    context.fillStyle = errorColour(checks.get(point.id))
    context.strokeStyle = '#0b1c20'
    context.lineWidth = 2
    context.beginPath()
    context.arc(screen.x, screen.y, 6, 0, Math.PI * 2)
    context.fill()
    context.stroke()
    if (view.scale >= 0.6) {
      context.lineWidth = 3
      context.strokeText(point.label, screen.x + 9, screen.y + 4)
      context.fillStyle = '#fff8e9'
      context.fillText(point.label, screen.x + 9, screen.y + 4)
    }
  }
  if (ghostWorld) {
    const screen = toScreen(ghostWorld.x, ghostWorld.z)
    cross(screen.x, screen.y, '#ff4fd8')
  }
  if (pendingGeo && !pendingWorld && georef) {
    // Where the current fit thinks the chosen real spot is; click the true spot near it.
    const predicted = georef.toWorld(pendingGeo)
    const screen = toScreen(predicted.x, predicted.z)
    context.strokeStyle = '#7fe3ff'
    context.lineWidth = 2
    context.setLineDash([4, 3])
    context.beginPath()
    context.arc(screen.x, screen.y, 14, 0, Math.PI * 2)
    context.stroke()
    context.setLineDash([])
    cross(screen.x, screen.y, '#7fe3ff', 7)
  }
  if (pendingWorld) {
    const screen = toScreen(pendingWorld.x, pendingWorld.z)
    cross(screen.x, screen.y, '#ffd25e', 12)
  }
}

function nearestNode(sx: number, sy: number) {
  let best: RoadNode | null = null
  let bestDistance = SNAP_PX
  for (const node of nodes) {
    const point = toScreen(node.x, node.z)
    const distance = Math.hypot(point.x - sx, point.y - sy)
    if (distance < bestDistance) {
      best = node
      bestDistance = distance
    }
  }
  return best
}

function nearestBuilding(x: number, z: number) {
  let best: Building | null = null
  let bestDistance = 40
  for (const building of buildings) {
    const distance = Math.hypot(building.x - x, building.z - z)
    if (distance < bestDistance) {
      best = building
      bestDistance = distance
    }
  }
  return best
}

let drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId)
  drag = { x: event.clientX, y: event.clientY, cx: view.cx, cz: view.cz, moved: false }
})

canvas.addEventListener('pointermove', (event) => {
  const rect = canvas.getBoundingClientRect()
  const sx = event.clientX - rect.left
  const sy = event.clientY - rect.top
  if (drag) {
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (Math.hypot(dx, dy) > 4) drag.moved = true
    if (drag.moved) {
      canvas.classList.add('panning')
      view.cx = drag.cx - dx / view.scale
      view.cz = drag.cz - dy / view.scale
      draw()
      return
    }
  }
  const world = toWorld(sx, sy)
  const building = nearestBuilding(world.x, world.z)
  const geo = georef?.toGeo(world)
  worldReadout.textContent = `x ${Math.round(world.x)}, z ${Math.round(world.z)}${geo ? ` → ${formatGeo(geo)}` : ''}${building ? ` · ${building.name} (${building.id})` : ''}`
  if (geo) realMap?.setGhost(geo)
})

canvas.addEventListener('pointerup', (event) => {
  canvas.classList.remove('panning')
  const wasClick = drag && !drag.moved
  drag = null
  if (!wasClick) return
  const rect = canvas.getBoundingClientRect()
  const sx = event.clientX - rect.left
  const sy = event.clientY - rect.top
  const node = event.shiftKey ? null : nearestNode(sx, sy)
  const raw = toWorld(sx, sy)
  const world = node ? { x: node.x, z: node.z } : { x: Math.round(raw.x), z: Math.round(raw.z) }
  const building = nearestBuilding(world.x, world.z)
  pendingWorld = { ...world, note: node ? `intersection ${node.id}` : building ? `near ${building.name}` : 'free point' }
  updatePending()
  const geo = georef?.toGeo(world)
  if (geo) void showLookup(geo, 'Predicted real spot')
})

canvas.addEventListener('pointerleave', () => realMap?.setGhost(null))

canvas.addEventListener('wheel', (event) => {
  event.preventDefault()
  const rect = canvas.getBoundingClientRect()
  const sx = event.clientX - rect.left
  const sy = event.clientY - rect.top
  const before = toWorld(sx, sy)
  view.scale = Math.min(12, Math.max(0.15, view.scale * Math.pow(1.0015, -event.deltaY)))
  const after = toWorld(sx, sy)
  view.cx += before.x - after.x
  view.cz += before.z - after.z
  draw()
}, { passive: false })

function focusWorld(x: number, z: number, scale = Math.max(view.scale, 2)) {
  view.cx = x
  view.cz = z
  view.scale = scale
  draw()
}

// ---------- pending pair ----------

function updatePending() {
  $('cal-pending-world').textContent = pendingWorld ? `x ${pendingWorld.x}, z ${pendingWorld.z} (${pendingWorld.note})` : 'Click the world map'
  $('cal-pending-geo').textContent = pendingGeo ? formatGeo(pendingGeo) : 'Click the real map or search'
  addButton.disabled = !(pendingWorld && pendingGeo)
  realMap?.setPending(pendingGeo)
  draw()
}

function setPendingGeo(geo: GeoPoint, label?: string) {
  pendingGeo = geo
  if (label && !labelInput.value) labelInput.value = label
  updatePending()
  const world = georef?.toWorld(geo)
  if (world && !pendingWorld) focusWorld(world.x, world.z)
}

function clearPending() {
  pendingWorld = null
  pendingGeo = null
  labelInput.value = ''
  lookupEl.innerHTML = ''
  updatePending()
}

addButton.addEventListener('click', () => {
  if (!pendingWorld || !pendingGeo) return
  const label = labelInput.value.trim() || `Point ${data.points.length + 1}`
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'point'
  let id = slug
  for (let n = 2; data.points.some((point) => point.id === id); n += 1) id = `${slug}-${n}`
  const source = `calibration (${realMap?.provider === 'google' ? 'Google' : 'OpenStreetMap'})`
  data.points.push({ id, label, world: [pendingWorld.x, pendingWorld.z], geo: [Number(pendingGeo.lat.toFixed(7)), Number(pendingGeo.lon.toFixed(7))], source })
  clearPending()
  markDirty()
})

$('cal-clear').addEventListener('click', clearPending)

// ---------- point list ----------

function renderPointList() {
  const list = $('cal-points')
  const sorted = [...data.points].sort((a, b) => (checks.get(b.id) ?? 0) - (checks.get(a.id) ?? 0))
  list.innerHTML = sorted.map((point) => {
    const error = checks.get(point.id)
    return `<li data-id="${escapeHtml(point.id)}">
      <i class="cal-dot" style="background:${errorColour(error)}"></i>
      <span title="${escapeHtml(point.label)} · ${point.source}">${escapeHtml(point.label)}</span>
      <em>${error === undefined ? '–' : `${Math.round(error)} m`}</em>
      <button type="button" data-action="go">Go</button>
      <button type="button" data-action="delete" aria-label="Delete ${escapeHtml(point.label)}">×</button>
    </li>`
  }).join('')
}

$('cal-points').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('button')
  const id = button?.closest('li')?.dataset.id
  const point = data.points.find((item) => item.id === id)
  if (!button || !point) return
  if (button.dataset.action === 'go') {
    focusWorld(point.world[0], point.world[1])
    realMap?.panTo({ lat: point.geo[0], lon: point.geo[1] })
  } else if (button.dataset.action === 'delete') {
    if (data.points.length <= 2) return
    data.points = data.points.filter((item) => item !== point)
    markDirty()
  }
})

saveButton.addEventListener('click', async () => {
  saveButton.disabled = true
  try {
    const response = await fetch('/api/georef/points', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    const body = await response.json() as { error?: string }
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
    dirty = false
    refit()
  } catch (error) {
    statsEl.innerHTML = `<span class="cal-error">Save failed: ${escapeHtml(error instanceof Error ? error.message : String(error))}</span>`
    saveButton.disabled = false
  }
})

window.addEventListener('beforeunload', (event) => {
  if (dirty) event.preventDefault()
})

// ---------- search and lookups ----------

$('cal-search').addEventListener('submit', async (event) => {
  event.preventDefault()
  const query = $<HTMLInputElement>('cal-query').value.trim()
  const results = $('cal-results')
  if (!query) return
  results.innerHTML = '<li class="cal-help">Searching…</li>'
  try {
    const response = await fetch(`/api/georef/geocode?q=${encodeURIComponent(query)}&provider=${provider()}`)
    const body = await response.json() as SearchResult[] | { error: string }
    if (!Array.isArray(body)) throw new Error(body.error)
    results.innerHTML = body.length
      ? body.map((result, index) => `<li><button type="button" data-index="${index}">${escapeHtml(result.label)}</button></li>`).join('')
      : '<li class="cal-help">No matches.</li>'
    results.onclick = (clickEvent) => {
      const index = Number((clickEvent.target as HTMLElement).closest('button')?.dataset.index)
      const result = body[index]
      if (!result) return
      setPendingGeo({ lat: result.lat, lon: result.lon }, result.label.split(',')[0])
      realMap?.panTo({ lat: result.lat, lon: result.lon })
      results.innerHTML = ''
    }
  } catch (error) {
    results.innerHTML = `<li class="cal-help cal-error">${escapeHtml(error instanceof Error ? error.message : String(error))}</li>`
  }
})

let lookupToken = 0
async function showLookup(geo: GeoPoint, heading: string) {
  const token = ++lookupToken
  lookupEl.innerHTML = `${heading}: ${formatGeo(geo)} · <a href="${googleMapsUrl(geo)}" target="_blank" rel="noopener">open in Google Maps</a>`
  try {
    const source = provider()
    const response = await fetch(`/api/georef/lookup?lat=${geo.lat}&lon=${geo.lon}&provider=${source}`)
    const body = await response.json() as Lookup & { error?: string }
    if (token !== lookupToken) return
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
    const places = body.places.slice(0, 3).map((place) => `<li>${escapeHtml(place.name)}${place.type ? ` <span>(${escapeHtml(place.type.replace(/_/g, ' '))})</span>` : ''}</li>`).join('')
    const credit = source === 'osm' ? '<br><small>Address data © OpenStreetMap contributors</small>' : ''
    lookupEl.innerHTML += `<br><b>${escapeHtml(body.address ?? 'No address')}</b>${places ? `<ul>${places}</ul>` : ''}${body.note ? `<br><small>${escapeHtml(body.note)}</small>` : ''}${credit}`
  } catch (error) {
    if (token === lookupToken) lookupEl.innerHTML += `<br><span class="cal-error">${escapeHtml(error instanceof Error ? error.message : String(error))}</span>`
  }
}

// ---------- real-world map ----------

const provider = () => realMap?.provider ?? 'osm'

function syncPointMarkers() {
  realMap?.setPoints(data.points.map((point) => ({
    geo: { lat: point.geo[0], lon: point.geo[1] },
    label: point.label,
    colour: errorColour(checks.get(point.id)),
  })))
}

const mapEvents: MapEvents = {
  click(geo) {
    setPendingGeo(geo)
    void showLookup(geo, 'Clicked')
  },
  hover(geo) {
    if (!georef) return
    ghostWorld = georef.toWorld(geo)
    gmapReadout.hidden = false
    gmapReadout.textContent = `${formatGeo(geo)} → world x ${Math.round(ghostWorld.x)}, z ${Math.round(ghostWorld.z)}`
    draw()
  },
  leave() {
    ghostWorld = null
    gmapReadout.hidden = true
    draw()
  },
}

function mapReady(adapter: MapAdapter, note = '') {
  realMap = adapter
  gmapNotice.hidden = true
  $('cal-map-tag').textContent = adapter.provider === 'google' ? 'GOOGLE MAPS' : `OPENSTREETMAP${note ? ` · ${note}` : ''}`
  syncPointMarkers()
  updatePending()
}

async function useOpenStreetMap(note: string) {
  if (realMap?.provider === 'osm') return
  realMap = null
  $('cal-gmap').hidden = true
  const container = $('cal-osm')
  container.hidden = false
  try {
    mapReady(await loadOsmMap(container, mapEvents), note)
  } catch (error) {
    gmapNotice.hidden = false
    gmapNotice.innerHTML = `<p>Could not load OpenStreetMap: ${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`
  }
}

async function startMap() {
  const config = await fetch('/api/georef/config').then((response) => response.json() as Promise<{ mapsKey: string | null }>).catch(() => null)
  if (!config) {
    gmapNotice.innerHTML = '<p>The calibration API is not running. Open this page from <code>npm run dev</code>.</p>'
    return
  }
  const forceOsm = new URLSearchParams(location.search).get('map') === 'osm'
  if (forceOsm || !config.mapsKey) return useOpenStreetMap(forceOsm ? '' : 'NO GOOGLE KEY')
  try {
    mapReady(await loadGoogleMap($('cal-gmap'), config.mapsKey, mapEvents, () => void useOpenStreetMap('GOOGLE KEY REFUSED')))
  } catch {
    await useOpenStreetMap('GOOGLE KEY REFUSED')
  }
}

// ---------- start ----------

async function start() {
  const manifest = await fetch(`${assetBase}manifest.json`).then((response) => response.json() as Promise<Manifest>)
  zone = manifest.zones.find((item) => item.id === 'city')!
  const [network, georefData] = await Promise.all([
    fetch(`${assetBase}${manifest.roadNetwork}`).then((response) => response.json() as Promise<RoadNetwork>),
    fetch(`${assetBase}georef.json`, { cache: 'no-store' }).then((response) => response.json() as Promise<GeorefData>),
  ])
  nodes = network.zones.city?.nodes ?? []
  buildings = network.zones.city?.buildings ?? []
  data = { ...georefData, points: georefData.points.map((point: ControlPoint) => ({ ...point })) }
  overview.onload = () => draw()
  overview.src = `${assetBase}${zone.overview}`
  resize()
  refit()
  void startMap()
}

new ResizeObserver(resize).observe(canvas)
start().catch((error: unknown) => {
  statsEl.innerHTML = `<span class="cal-error">Failed to load: ${escapeHtml(error instanceof Error ? error.message : String(error))}</span>`
})
