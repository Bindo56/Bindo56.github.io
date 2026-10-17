import * as THREE from 'three'
import './nju-jork.css'

type Zone = {
  id: string
  name: string
  bounds: [number, number, number, number]
  start: [number, number]
  overview: string
  tiles: [number, number][]
}
type Manifest = {
  source: string
  step: number
  detailStep: number
  detailPixels: number
  baseY: number
  tileBlocks: number
  tilePixels: number
  zones: Zone[]
  roadNetwork?: string
}
type RoadNode = { id: string; x: number; z: number; kind: 'intersection' | 'corner' | 'end' | 'loop' }
type Road = { id: string; name: string; from: string; to: string; length: number; points: [number, number][] }
type Building = { id: string; name: string; address: string; streetId: string | null; icon: 'building'; x: number; z: number; roofY: number; areaBlocks: number; bounds: [number, number, number, number]; nameSource?: 'osm-place' | 'osm-address' | 'plan' }
type RoadNetwork = { zones: Record<string, { nodes: RoadNode[]; roads: Road[]; buildings: Building[] }> }

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div class="nj-stage" aria-label="Three-dimensional Nju Jork city model"></div>
  <div class="nj-road-labels" id="nj-road-labels" aria-label="Street and building markers"></div>
  <div class="nj-ui">
    <header class="nj-topbar">
      <a href="/" class="nj-back">← <span>SYSTEM ZERO</span></a>
      <span class="nj-world">CLOCKWORK CITY <b>/</b> WORLD MODEL</span>
      <span class="nj-status" id="nj-status"><i></i> PREPARING CITY</span>
    </header>
    <section class="nj-intro" aria-labelledby="nj-title">
      <span class="nj-eyebrow">REAL MANHATTAN · MINECRAFT BLOCKS</span>
      <h1 id="nj-title">NJU<br><em>JORK</em></h1>
      <p>Explore real New York streets and buildings, matched from OpenStreetMap. Select a marker to see its place name and street address.</p>
    </section>
    <div class="nj-zone-switch" id="nj-zone-switch" role="group" aria-label="World area"></div>
    <div class="nj-info" aria-live="polite">
      <span id="nj-view-mode" class="nj-view-mode">CITY VIEW</span>
      <span class="nj-info-separator"></span>
      <span id="nj-coordinates">X — / Z —</span>
      <span class="nj-info-separator"></span>
      <span id="nj-tile-count">OVERVIEW</span>
    </div>
    <div class="nj-controls" aria-label="Map controls">
      <button type="button" id="nj-zoom-in" aria-label="Zoom in">+</button>
      <button type="button" id="nj-zoom-out" aria-label="Zoom out">−</button>
      <button type="button" id="nj-street">STREET</button>
      <button type="button" id="nj-roads" aria-pressed="true">ROADS ON</button>
      <button type="button" id="nj-labels" aria-pressed="true">LABELS ON</button>
      <button type="button" id="nj-overview">OVERVIEW</button>
    </div>
    <div class="nj-map-key">▣ BUILDINGS <b>·</b> STREET NAMES <b>·</b> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener" style="color: inherit">© OPENSTREETMAP</a></div>
    <aside class="nj-place-card" id="nj-place-card" hidden aria-live="polite"></aside>
    <div class="nj-help">DRAG TO PAN <b>·</b> SCROLL OR PINCH TO ZOOM <b>·</b> SHIFT + DRAG TO ORBIT</div>
    <div class="nj-loading" id="nj-loading" role="status">READING THE CITY MODEL…</div>
  </div>
`

const stage = app.querySelector<HTMLDivElement>('.nj-stage')!
const canvasStatus = app.querySelector<HTMLElement>('#nj-status')!
const loading = app.querySelector<HTMLElement>('#nj-loading')!
const coordinates = app.querySelector<HTMLElement>('#nj-coordinates')!
const tileCount = app.querySelector<HTMLElement>('#nj-tile-count')!
const viewMode = app.querySelector<HTMLElement>('#nj-view-mode')!
const zoneSwitch = app.querySelector<HTMLElement>('#nj-zone-switch')!
const roadLabels = app.querySelector<HTMLElement>('#nj-road-labels')!
const roadButton = app.querySelector<HTMLButtonElement>('#nj-roads')!
const labelButton = app.querySelector<HTMLButtonElement>('#nj-labels')!
const placeCard = app.querySelector<HTMLElement>('#nj-place-card')!
const assetBase = `${import.meta.env.BASE_URL}assets/nju-jork/`

const scene = new THREE.Scene()
scene.background = new THREE.Color('#152b31')
scene.fog = new THREE.Fog('#152b31', 1800, 5400)
const camera = new THREE.PerspectiveCamera(55, 1, .08, 30000)
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, innerWidth < 700 ? 1.25 : 1.6))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.domElement.setAttribute('aria-label', 'Nju Jork model. Drag to pan, scroll to zoom, Shift and drag to orbit.')
stage.append(renderer.domElement)

const overviewMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false })
const tileMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true })

// One block of facade (4 m, about a floor): two windows on a white wall. The texture multiplies each
// wall's own colour, so glass reads darker and bluer on any facade; crisp up close, smooth far away.
function facadeTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 16
  const context = canvas.getContext('2d')!
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, 16, 16)
  context.fillStyle = '#56677a'
  context.fillRect(2, 3, 5, 8)
  context.fillRect(9, 3, 5, 8)
  context.fillStyle = '#7d8fa1'
  context.fillRect(2, 3, 5, 2)
  context.fillRect(9, 3, 5, 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.NearestFilter
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
const facadeMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, map: facadeTexture(), side: THREE.DoubleSide, fog: true })
let overview: THREE.Mesh | null = null
let manifest: Manifest
let zone: Zone
let zoneTiles = new Set<string>()
let zoneEpoch = 0
let roadNetwork: RoadNetwork | null = null
let roadGroup: THREE.Group | null = null
let roadsVisible = true
let labelsVisible = true
let activeRoads: Road[] = []
let activeBuildings: Building[] = []
let lastLabelUpdate = 0
type TileMesh = { mesh: THREE.Mesh; lod: 'standard' | 'detail'; anchor: string }
const loadedTiles = new Map<string, TileMesh>()
const tileDataCache = new Map<string, Uint8ClampedArray>()
const pendingTiles = new Set<string>()
const focus = new THREE.Vector3(-535, 0, -32)
const targetFocus = focus.clone()
let viewHeight = 260
let targetViewHeight = 260
let orbit = -.56
let tiltAdjustment = 0
let lastTileCheck = 0
let dirty = true

function key(rx: number, rz: number) { return `${rx},${rz}` }

function cameraPose() {
  const t = THREE.MathUtils.clamp((Math.log(viewHeight) - Math.log(7)) / (Math.log(260) - Math.log(7)), 0, 1)
  const tilt = THREE.MathUtils.clamp(THREE.MathUtils.lerp(.14, .86, t) + tiltAdjustment, .08, 1.45)
  const distance = viewHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))
  const lookHeight = THREE.MathUtils.lerp(1.6, 16, t)
  camera.position.set(
    focus.x + Math.sin(orbit) * Math.cos(tilt) * distance,
    Math.max(2, lookHeight + Math.sin(tilt) * distance),
    focus.z + Math.cos(orbit) * Math.cos(tilt) * distance,
  )
  camera.lookAt(focus.x, lookHeight, focus.z)
}

function updateCamera() {
  camera.aspect = Math.max(.1, stage.clientWidth / Math.max(1, stage.clientHeight))
  camera.updateProjectionMatrix()
  cameraPose()
}

function resize() {
  renderer.setSize(stage.clientWidth, stage.clientHeight)
  updateCamera()
  dirty = true
}
new ResizeObserver(resize).observe(stage)
resize()

function clampFocus() {
  if (!zone) return
  const [left, top, right, bottom] = zone.bounds
  targetFocus.x = THREE.MathUtils.clamp(targetFocus.x, left - 60, right + 60)
  targetFocus.z = THREE.MathUtils.clamp(targetFocus.z, top - 60, bottom + 60)
}

function overviewView() {
  const [left, top, right, bottom] = zone.bounds
  targetFocus.set((left + right) / 2, 0, (top + bottom) / 2)
  const aspect = Math.max(.5, stage.clientWidth / Math.max(1, stage.clientHeight))
  targetViewHeight = Math.max(bottom - top, (right - left) / aspect) * 1.14
  dirty = true
}

function clearTiles() {
  for (const { mesh } of loadedTiles.values()) {
    scene.remove(mesh)
    mesh.geometry.dispose()
  }
  loadedTiles.clear()
  pendingTiles.clear()
  tileDataCache.clear()
}

function clearRoads() {
  if (roadGroup) {
    scene.remove(roadGroup)
    roadGroup.traverse((item) => {
      if (item instanceof THREE.LineSegments || item instanceof THREE.Points) item.geometry.dispose()
    })
  }
  roadGroup = null
  activeRoads = []
  activeBuildings = []
  roadLabels.replaceChildren()
}

function showRoads(zoneId: string) {
  clearRoads()
  const graph = roadNetwork?.zones[zoneId]
  if (!graph) return
  activeRoads = graph.roads
  activeBuildings = graph.buildings || []
  if (!graph.roads.length) return
  roadGroup = new THREE.Group()
  const linePositions: number[] = []
  for (const road of graph.roads) for (let i = 1; i < road.points.length; i++) {
    const [ax, az] = road.points[i - 1]
    const [bx, bz] = road.points[i]
    linePositions.push(ax, .19, az, bx, .19, bz)
  }
  const lineGeometry = new THREE.BufferGeometry()
  lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3))
  roadGroup.add(new THREE.LineSegments(lineGeometry,
    new THREE.LineBasicMaterial({ color: '#ffd36f', transparent: true, opacity: .72, depthTest: true })))
  for (const kind of ['intersection', 'corner', 'end', 'loop'] as const) {
    const positions: number[] = []
    for (const node of graph.nodes) if (node.kind === kind) positions.push(node.x, .25, node.z)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    roadGroup.add(new THREE.Points(geometry, new THREE.PointsMaterial({
      color: kind === 'intersection' ? '#ff665e' : kind === 'corner' ? '#75dcf5' : '#f7e3ae',
      size: kind === 'intersection' ? 7 : 5, sizeAttenuation: false, depthTest: true,
    })))
  }
  scene.add(roadGroup)
  roadGroup.visible = roadsVisible
}

function updateRoadOverlay() {
  if (!roadGroup) return
  roadGroup.visible = roadsVisible && viewHeight < 800
  roadGroup.children.forEach((child, index) => { child.visible = index === 0 || viewHeight < 200 })
}

function updateMapLabels(now: number) {
  if (now - lastLabelUpdate < 120) return
  lastLabelUpdate = now
  if (!labelsVisible || viewHeight > 650) { roadLabels.replaceChildren(); return }
  const width = stage.clientWidth
  const height = stage.clientHeight
  const radius = Math.max(45, viewHeight * 1.4)
  const occupied: [number, number][] = []
  const items: HTMLElement[] = []
  const place = (element: HTMLElement, x: number, y: number, spacingX: number, spacingY: number) => {
    const projected = new THREE.Vector3(x, y, element.dataset.z ? Number(element.dataset.z) : 0).project(camera)
    if (projected.z < -1 || projected.z > 1) return false
    const px = (projected.x + 1) * .5 * width
    const py = (1 - projected.y) * .5 * height
    const edgeMargin = element.classList.contains('nj-building-marker') ? 100 : 62
    if (px < edgeMargin || px > width - edgeMargin || py < 66 || py > height - 68) return false
    if (px < (width < 700 ? 200 : 330) && py < (width < 700 ? 240 : 350)) return false
    if (px > width - 135 && py < 440) return false
    if (occupied.some(([ox, oy]) => Math.abs(px - ox) < spacingX && Math.abs(py - oy) < spacingY)) return false
    occupied.push([px, py])
    element.style.left = `${px}px`
    element.style.top = `${py}px`
    items.push(element)
    return true
  }
  const seenNames = new Set<string>()
  const streetLimit = viewHeight < 35 ? 10 : 16
  const streets = activeRoads.filter((road) => {
    if (road.length < 16 || !road.name) return false
    const mid = road.points[Math.floor(road.points.length / 2)]
    return Math.abs(mid[0] - focus.x) < radius && Math.abs(mid[1] - focus.z) < radius
  }).sort((a, b) => b.length - a.length)
  for (const road of streets) {
    if (seenNames.has(road.name) || seenNames.size >= streetLimit) continue
    const mid = road.points[Math.floor(road.points.length / 2)]
    const label = document.createElement('span')
    label.className = 'nj-street-name'
    label.textContent = road.name
    label.title = `${road.name} · ${road.id}`
    label.dataset.z = String(mid[1])
    if (place(label, mid[0], .55, 115, 30)) seenNames.add(road.name)
  }
  const buildingLimit = viewHeight > 220 ? 8 : viewHeight > 65 ? 22 : 35
  const buildings = activeBuildings.filter((building) =>
    Math.abs(building.x - focus.x) < radius && Math.abs(building.z - focus.z) < radius)
    .sort((a, b) => viewHeight > 100 ? b.areaBlocks - a.areaBlocks :
      Math.hypot(a.x - focus.x, a.z - focus.z) - Math.hypot(b.x - focus.x, b.z - focus.z))
  let placed = 0
  for (const building of buildings) {
    if (placed >= buildingLimit) break
    const marker = document.createElement('button')
    marker.type = 'button'
    marker.className = 'nj-building-marker'
    marker.dataset.building = building.id
    marker.dataset.z = String(building.z)
    marker.setAttribute('aria-label', `${building.name}, ${building.address}, X ${building.x}, Z ${building.z}`)
    marker.title = `${building.name} · ${building.address}`
    marker.innerHTML = '<svg aria-hidden="true" viewBox="0 0 20 20"><path d="M4 18V3h12v15M2 18h16M7 6h2m2 0h2M7 9h2m2 0h2M7 12h2m2 0h2M9 18v-3h2"/></svg><span></span>'
    marker.querySelector('span')!.textContent = building.name
    if (place(marker, building.x, viewHeight < 25 ? 2 : Math.max(2, building.roofY - manifest.baseY + .6), 140, 37)) placed++
  }
  roadLabels.replaceChildren(...items)
}

roadLabels.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-building]')
  if (!target) return
  const building = activeBuildings.find((item) => item.id === target.dataset.building)
  if (!building) return
  const real = building.nameSource !== undefined && building.nameSource !== 'plan'
  placeCard.innerHTML = '<button type="button" class="nj-card-close" aria-label="Close building details">×</button><span class="nj-card-eyebrow"></span><h2></h2><p class="nj-card-address"></p><p class="nj-card-meta"></p><small></small>'
  placeCard.querySelector('.nj-card-eyebrow')!.textContent = real ? 'REAL PLACE · OPENSTREETMAP' : 'GENERATED PLACE NAME'
  placeCard.querySelector('h2')!.textContent = building.name
  placeCard.querySelector<HTMLElement>('.nj-card-address')!.textContent = building.address
  placeCard.querySelector<HTMLElement>('.nj-card-meta')!.textContent = `${building.id} · X ${building.x} / Z ${building.z} · ${building.areaBlocks} block footprint`
  placeCard.querySelector('small')!.textContent = real
    ? `Roof Y ${building.roofY}. Name and address from OpenStreetMap, matched to this block; may be approximate.`
    : `Roof Y ${building.roofY}. No real building matched here; name and address are planning labels.`
  placeCard.hidden = false
  placeCard.querySelector<HTMLButtonElement>('button')!.addEventListener('click', () => { placeCard.hidden = true })
})

async function activateZone(next: Zone) {
  const epoch = ++zoneEpoch
  zone = next
  showRoads(next.id)
  placeCard.hidden = true
  zoneTiles = new Set(next.tiles.map(([rx, rz]) => key(rx, rz)))
  clearTiles()
  if (overview) {
    scene.remove(overview)
    overview.geometry.dispose()
    overview = null
  }
  overviewMaterial.map?.dispose()
  overviewMaterial.map = null
  focus.set(next.start[0], 0, next.start[1])
  targetFocus.copy(focus)
  viewHeight = next.id === 'city' ? 260 : 180
  targetViewHeight = viewHeight
  zoneSwitch.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.zone === next.id))
  })
  loading.hidden = false
  canvasStatus.innerHTML = '<i></i> LOADING MODEL'
  try {
    const texture = await new THREE.TextureLoader().loadAsync(`${assetBase}${next.overview}`)
    if (epoch !== zoneEpoch) { texture.dispose(); return }
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    overviewMaterial.map = texture
    overviewMaterial.needsUpdate = true
    const [left, top, right, bottom] = next.bounds
    overview = new THREE.Mesh(new THREE.PlaneGeometry(right - left, bottom - top), overviewMaterial)
    overview.rotation.x = -Math.PI / 2
    overview.position.set((left + right) / 2, -.12, (top + bottom) / 2)
    overview.name = `${next.name} surface overview`
    scene.add(overview)
    loading.hidden = true
    canvasStatus.innerHTML = '<i></i> CITY READY'
    lastTileCheck = 0
    dirty = true
  } catch (error) {
    loading.textContent = 'THE CITY MODEL COULD NOT BE LOADED.'
    canvasStatus.innerHTML = '<i></i> MODEL OFFLINE'
    console.error(error)
  }
}

const FLAT_UV = [0, 0, 0, 0, 0, 0, 0, 0]

function addQuad(positions: number[], colors: number[], uvs: number[], indices: number[],
  corners: number[], rgb: [number, number, number], uv = FLAT_UV) {
  const base = positions.length / 3
  positions.push(...corners)
  uvs.push(...uv)
  for (let i = 0; i < 4; i++) colors.push(rgb[0], rgb[1], rgb[2])
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
}

function srgbToLinear(value: number) {
  const channel = value / 255
  return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
}

function makeTile(rx: number, rz: number, data: Uint8ClampedArray,
  lod: 'standard' | 'detail', anchorX: number, anchorZ: number): THREE.Mesh {
  const width = lod === 'detail' ? manifest.detailPixels : manifest.tilePixels
  const step = lod === 'detail' ? manifest.detailStep : manifest.step
  const count = width * width
  const keys = new Uint32Array(count)
  const heights = new Float32Array(count)
  const seen = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    const j = i * 4
    const alpha = data[j + 3]
    if (!alpha) continue
    keys[i] = (((data[j] << 24) | (data[j + 1] << 16) | (data[j + 2] << 8) | alpha) >>> 0)
    heights[i] = Math.max(0, alpha - 1 - manifest.baseY)
  }
  const positions: number[] = []
  const colors: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const facadeIndices: number[] = []
  const originX = rx * manifest.tileBlocks
  const originZ = rz * manifest.tileBlocks
  const cropRadius = 128
  const minX = lod === 'detail' ? Math.max(0, Math.floor((anchorX - cropRadius - originX) / step)) : 0
  const maxX = lod === 'detail' ? Math.min(width, Math.ceil((anchorX + cropRadius - originX) / step)) : width
  const minZ = lod === 'detail' ? Math.max(0, Math.floor((anchorZ - cropRadius - originZ) / step)) : 0
  const maxZ = lod === 'detail' ? Math.min(width, Math.ceil((anchorZ + cropRadius - originZ) / step)) : width
  const rgbAt = (i: number, shade = 1): [number, number, number] => [
    srgbToLinear(data[i * 4]) * shade,
    srgbToLinear(data[i * 4 + 1]) * shade,
    srgbToLinear(data[i * 4 + 2]) * shade,
  ]
  // Merge equal-height, equal-colour roof and street cells into rectangles.
  for (let z = minZ; z < maxZ; z++) for (let x = minX; x < maxX; x++) {
    const i = z * width + x
    if (!keys[i] || seen[i]) continue
    let spanX = 1
    while (x + spanX < maxX && !seen[i + spanX] && keys[i + spanX] === keys[i]) spanX++
    let spanZ = 1
    outer: while (z + spanZ < maxZ) {
      for (let dx = 0; dx < spanX; dx++) {
        const j = (z + spanZ) * width + x + dx
        if (seen[j] || keys[j] !== keys[i]) break outer
      }
      spanZ++
    }
    for (let dz = 0; dz < spanZ; dz++) seen.fill(1, (z + dz) * width + x, (z + dz) * width + x + spanX)
    const x0 = originX + x * step
    const x1 = x0 + spanX * step
    const z0 = originZ + z * step
    const z1 = z0 + spanZ * step
    const y = heights[i] + .02
    addQuad(positions, colors, uvs, indices, [x0,y,z0, x0,y,z1, x1,y,z1, x1,y,z0], rgbAt(i))
  }
  // Only exposed height changes need walls; no hidden voxel faces are sent to the GPU.
  for (let z = minZ; z < maxZ; z++) for (let x = minX; x < maxX; x++) {
    const i = z * width + x
    if (!keys[i] || heights[i] <= .1) continue
    const y1 = heights[i]
    const x0 = originX + x * step
    const z0 = originZ + z * step
    const x1 = x0 + step
    const z1 = z0 + step
    const walls: [number, number, number[]][] = [
      [x - 1, z, [x0,0,z0, x0,0,z1, x0,0,z1, x0,0,z0]],
      [x + 1, z, [x1,0,z1, x1,0,z0, x1,0,z0, x1,0,z1]],
      [x, z - 1, [x1,0,z0, x0,0,z0, x0,0,z0, x1,0,z0]],
      [x, z + 1, [x0,0,z1, x1,0,z1, x1,0,z1, x0,0,z1]],
    ]
    for (let side = 0; side < 4; side++) {
      const [nx, nz, corners] = walls[side]
      if (nx < 0 || nz < 0 || nx >= width || nz >= width) continue
      const neighbor = nz * width + nx
      const y0 = keys[neighbor] ? heights[neighbor] : 0
      if (y1 - y0 < .8) continue
      corners[1] = y0; corners[4] = y0; corners[7] = y1; corners[10] = y1
      // Building walls get windows: at least about three floors of wall, and not greenery (tree columns).
      const [r, g, b] = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]
      const glazed = y1 >= 3 && y1 - y0 >= 2.5 && !(g > r + 8 && g > b + 8)
      // u runs along the wall in blocks (z for walls facing x, x for walls facing z), v up it in blocks.
      const along = side < 2 ? 2 : 0
      const uv = [corners[along], y0, corners[3 + along], y0, corners[6 + along], y1, corners[9 + along], y1]
      addQuad(positions, colors, uvs, glazed ? facadeIndices : indices, corners, rgbAt(i, side === 0 || side === 2 ? .68 : .82), uv)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices.concat(facadeIndices))
  geometry.addGroup(0, indices.length, 0)
  geometry.addGroup(indices.length, facadeIndices.length, 1)
  geometry.computeBoundingSphere()
  const mesh = new THREE.Mesh(geometry, [tileMaterial, facadeMaterial])
  mesh.name = `Source region ${rx}, ${rz} (${lod})`
  return mesh
}

async function loadTile(rx: number, rz: number, epoch: number,
  lod: 'standard' | 'detail', anchorX: number, anchorZ: number, anchor: string) {
  const id = key(rx, rz)
  pendingTiles.add(id)
  try {
    const cacheKey = `${lod}:${id}`
    let data = tileDataCache.get(cacheKey)
    if (!data) {
      const prefix = lod === 'detail' ? 'd.' : 'r.'
      const heightPrefix = lod === 'detail' ? 'dh.' : 'h.'
      const responses = await Promise.all([
        fetch(`${assetBase}${prefix}${rx}.${rz}.png`),
        fetch(`${assetBase}${heightPrefix}${rx}.${rz}.png`),
      ])
      if (responses.some((response) => !response.ok)) throw new Error(`Tile ${id} unavailable`)
      const [bitmap, heightBitmap] = await Promise.all(responses.map(async (response) =>
        createImageBitmap(await response.blob())))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d', { willReadFrequently: true })!
      context.drawImage(bitmap, 0, 0)
      data = context.getImageData(0, 0, canvas.width, canvas.height).data
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(heightBitmap, 0, 0)
      const heightData = context.getImageData(0, 0, canvas.width, canvas.height).data
      bitmap.close()
      heightBitmap.close()
      for (let i = 0; i < data.length; i += 4) data[i + 3] = heightData[i]
      tileDataCache.set(cacheKey, data)
      if (tileDataCache.size > 10) tileDataCache.delete(tileDataCache.keys().next().value!)
    }
    if (epoch !== zoneEpoch) return
    const mesh = makeTile(rx, rz, data, lod, anchorX, anchorZ)
    loadedTiles.set(id, { mesh, lod, anchor })
    scene.add(mesh)
    dirty = true
  } catch (error) {
    console.error(error)
  } finally {
    pendingTiles.delete(id)
  }
}

function refreshTiles(now: number) {
  if (!zone || now - lastTileCheck < 350) return
  lastTileCheck = now
  const isNear = viewHeight < 1450
  const lod: 'standard' | 'detail' = viewHeight < 55 ? 'detail' : 'standard'
  const anchorX = Math.round(focus.x / 64) * 64
  const anchorZ = Math.round(focus.z / 64) * 64
  const anchor = lod === 'detail' ? `${anchorX},${anchorZ}` : 'full'
  const aspect = stage.clientWidth / Math.max(1, stage.clientHeight)
  const radius = Math.max(viewHeight * .8, viewHeight * aspect * .56) + 220
  const targets: [number, number, number][] = []
  if (isNear) for (const [rx, rz] of zone.tiles) {
    const centerX = rx * 512 + 256
    const centerZ = rz * 512 + 256
    const intersects = lod === 'detail'
      ? Math.abs(centerX - anchorX) < 384 && Math.abs(centerZ - anchorZ) < 384
      : Math.abs(centerX - focus.x) < radius + 256 && Math.abs(centerZ - focus.z) < radius + 256
    if (intersects) {
      targets.push([rx, rz, (centerX - focus.x) ** 2 + (centerZ - focus.z) ** 2])
    }
  }
  targets.sort((a, b) => a[2] - b[2])
  const budget = lod === 'detail' ? 4 : viewHeight < 450 ? 4 : 6
  const wanted = new Set(targets.slice(0, budget).map(([rx, rz]) => key(rx, rz)))
  for (const [id, entry] of loadedTiles) if (!wanted.has(id) || entry.lod !== lod || entry.anchor !== anchor) {
    scene.remove(entry.mesh)
    entry.mesh.geometry.dispose()
    loadedTiles.delete(id)
    dirty = true
  }
  for (const [rx, rz] of targets.slice(0, budget)) {
    const id = key(rx, rz)
    if (!zoneTiles.has(id) || loadedTiles.has(id) || pendingTiles.has(id)) continue
    if (pendingTiles.size >= 2) break
    void loadTile(rx, rz, zoneEpoch, lod, anchorX, anchorZ, anchor)
  }
  viewMode.textContent = viewHeight < 14 ? 'STREET VIEW' : viewHeight < 160 ? 'NEIGHBORHOOD' : 'CITY VIEW'
  tileCount.textContent = isNear ? `${loadedTiles.size} REGIONS IN 3D` : 'CITY OVERVIEW'
  coordinates.textContent = `X ${Math.round(focus.x)} / Z ${Math.round(focus.z)}`
}

const pointers = new Map<number, { x: number; y: number }>()
function pan(dx: number, dy: number) {
  const unit = viewHeight / Math.max(1, stage.clientHeight)
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
  targetFocus.x += (-dx * right.x + dy * up.x) * unit
  targetFocus.z += (-dx * right.z + dy * up.z) * unit
  clampFocus()
  dirty = true
}
renderer.domElement.addEventListener('pointerdown', (event) => {
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  renderer.domElement.setPointerCapture(event.pointerId)
})
renderer.domElement.addEventListener('pointermove', (event) => {
  const old = pointers.get(event.pointerId)
  if (!old) return
  const dx = event.clientX - old.x
  const dy = event.clientY - old.y
  if (pointers.size === 2) {
    const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1]
    if (other) {
      const before = Math.hypot(old.x - other.x, old.y - other.y)
      const after = Math.hypot(event.clientX - other.x, event.clientY - other.y)
      if (before > 8) targetViewHeight = THREE.MathUtils.clamp(targetViewHeight * before / Math.max(8, after), 7, 6500)
      pan(dx / 2, dy / 2)
    }
  } else if (event.shiftKey || event.buttons === 2) {
    orbit -= dx * .004
    tiltAdjustment = THREE.MathUtils.clamp(tiltAdjustment + dy * .003, -.42, .42)
    dirty = true
  } else pan(dx, dy)
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
})
renderer.domElement.addEventListener('pointerup', (event) => pointers.delete(event.pointerId))
renderer.domElement.addEventListener('pointercancel', (event) => pointers.delete(event.pointerId))
renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault())
renderer.domElement.addEventListener('wheel', (event) => {
  event.preventDefault()
  targetViewHeight = THREE.MathUtils.clamp(targetViewHeight * Math.exp(event.deltaY * .0012), 7, 6500)
  dirty = true
}, { passive: false })

app.querySelector<HTMLButtonElement>('#nj-zoom-in')!.addEventListener('click', () => {
  targetViewHeight = Math.max(7, targetViewHeight * .64)
  dirty = true
})
app.querySelector<HTMLButtonElement>('#nj-zoom-out')!.addEventListener('click', () => {
  targetViewHeight = Math.min(6500, targetViewHeight * 1.55)
  dirty = true
})
app.querySelector<HTMLButtonElement>('#nj-street')!.addEventListener('click', () => {
  if (viewHeight > 1450) targetFocus.set(zone.start[0], 0, zone.start[1])
  targetViewHeight = 7
  dirty = true
})
app.querySelector<HTMLButtonElement>('#nj-overview')!.addEventListener('click', overviewView)
roadButton.addEventListener('click', () => {
  roadsVisible = !roadsVisible
  roadButton.textContent = roadsVisible ? 'ROADS ON' : 'ROADS OFF'
  roadButton.setAttribute('aria-pressed', String(roadsVisible))
  dirty = true
})
labelButton.addEventListener('click', () => {
  labelsVisible = !labelsVisible
  labelButton.textContent = labelsVisible ? 'LABELS ON' : 'LABELS OFF'
  labelButton.setAttribute('aria-pressed', String(labelsVisible))
  dirty = true
})

let lastFrame = 0
function frame(now: number) {
  requestAnimationFrame(frame)
  if (now - lastFrame < 32) return
  const dt = Math.min((now - lastFrame) / 1000, .06)
  lastFrame = now
  const blend = 1 - Math.exp(-8 * dt)
  focus.lerp(targetFocus, blend)
  viewHeight = THREE.MathUtils.lerp(viewHeight, targetViewHeight, blend)
  const moving = focus.distanceToSquared(targetFocus) > .05 || Math.abs(viewHeight - targetViewHeight) > .05
  if (moving || dirty) updateCamera()
  refreshTiles(now)
  if (moving || dirty) updateRoadOverlay()
  if (moving || dirty) updateMapLabels(now)
  if (moving || dirty) renderer.render(scene, camera)
  dirty = false
}
requestAnimationFrame(frame)

async function loadWorld() {
  try {
    const response = await fetch(`${assetBase}manifest.json`)
    if (!response.ok) throw new Error('Nju Jork model manifest is unavailable')
    manifest = await response.json() as Manifest
    if (manifest.roadNetwork) {
      const roadResponse = await fetch(`${assetBase}${manifest.roadNetwork}`)
      if (roadResponse.ok) roadNetwork = await roadResponse.json() as RoadNetwork
    }
    zoneSwitch.innerHTML = manifest.zones.map((item) =>
      `<button type="button" data-zone="${item.id}" aria-pressed="false">${item.name}</button>`).join('')
    zoneSwitch.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.addEventListener('click', () => {
        const next = manifest.zones.find((item) => item.id === button.dataset.zone)
        if (next) void activateZone(next)
      })
    })
    await activateZone(manifest.zones[0])
  } catch (error) {
    loading.textContent = 'THE CITY MODEL COULD NOT BE LOADED.'
    canvasStatus.innerHTML = '<i></i> MODEL OFFLINE'
    console.error(error)
  }
}
void loadWorld()
