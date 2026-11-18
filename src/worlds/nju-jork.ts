import * as THREE from 'three'
import { SkyBox } from './SkyBox'
import { buildBrooklynBridge, type BrooklynBridgeData } from './brooklynBridge'
import { buildBridgeFlyovers, clearBrooklynRampRaster } from './bridgeFlyovers'
import { buildMinecraftTrees, disposeMinecraftTrees, type MinecraftTree } from './minecraftTrees'
import { buildSmoothRoads, disposeSmoothRoads } from './smoothRoads'
import { buildElevatedRail } from './elevatedRail'
import { buildStationLandmarks, STATION_COLLIDERS, STATION_LANDMARKS } from './stationLandmarks'
import { resolveCameraCollision } from './cameraCollision'
import { TransitOverlay, type TransitNetwork, type TransitNode, type TransitZone } from './transitNetwork'
import { TransitVehicles } from './transitVehicles'
import { buildSkyline, flattenCutouts, type Rect, type SkylineScene, type TowerDef } from './skyline'
import { createAdAtlas, type AdAtlas } from './skyline/adArt'
import { buildStreetAds, disposeStreetAds } from './skyline/streetAds'
import { buildTimesSquare, TIMES_SQUARE, type TimesSquareScene } from './skyline/timesSquare'
import { TimeManager } from './TimeManager'
import { NpcProof } from './npcProof'
import { NpcPopulation } from './npcPopulation'
import { NpcPopulationFigures } from './npcPopulationFigures'
import { SidewalkNetwork, type SidewalkData } from './sidewalkNetwork'
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
  sidewalkNetwork?: string
  transitNetwork?: string
  bridgeRise?: number
  bridgePiers?: [number, number, number][]
  brooklynBridge?: BrooklynBridgeData
  parkFocus?: [number, number]
  footpathWidthBlocks?: number
}
type RoadNode = { id: string; x: number; z: number; kind: 'intersection' | 'corner' | 'end' | 'loop' }
type Road = { id: string; name: string; from: string; to: string; length: number; bridge?: boolean; width: number; sidewalk?: boolean; points: [number, number][] }
type Building = { id: string; name: string; address: string; streetId: string | null; icon: 'building'; x: number; z: number; roofY: number; areaBlocks: number; bounds: [number, number, number, number]; nameSource?: 'osm-place' | 'osm-address' | 'plan' }
type RoadNetwork = { zones: Record<string, { nodes: RoadNode[]; roads: Road[]; buildings: Building[] }> }
type MappedBuilding = { id: string; name: string; address: string; x: number; z: number; uses: string[]; unitsRes: number; officeAreaSqFt: number; sources: { dataset: string; id: string; match?: string }[] }
type MappedPlace = { id: string; anchorId: string; kind: string; label: string; source: string; sourceId: string; match: string; distanceM: number | null }
type PlaceCatalog = { buildings: MappedBuilding[]; places: MappedPlace[]; sources: Record<string, string> }
type NpcOccupancy = { summary: { members: number; households: number }; anchors: Record<string, { residents: number; workers: number; students: number }> }
const DETAIL_VIEW_HEIGHT = 55

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div class="nj-stage" aria-label="Three-dimensional Ambient NPCs New York city model"></div>
  <div class="nj-road-labels" id="nj-road-labels" aria-label="Street and building markers"></div>
  <div class="nj-ui">
    <header class="nj-topbar">
      <a href="${import.meta.env.BASE_URL}" class="nj-back">← <span>SYSTEM ZERO</span></a>
      <span class="nj-world">AMBIENT NPCs <b>/</b> NEW YORK SIM</span>
      <span class="nj-status" id="nj-status"><i></i> PREPARING CITY</span>
    </header>
    <section class="nj-intro" aria-labelledby="nj-title">
      <span class="nj-eyebrow">REAL MANHATTAN · LIVING WORLD</span>
      <h1 id="nj-title">NEW YORK<br><em>SIM</em></h1>
      <p class="nj-intro-tagline">WITH AMBIENT NPCs</p>
      <p>World filler with 100,000 scheduled people across homes, offices, cafes, parks, and sidewalks. Click a person to follow their day.</p>
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
      <button type="button" id="nj-roads" aria-pressed="false">ROADS OFF</button>
      <button type="button" id="nj-subway" aria-pressed="false">SUBWAY OFF</button>
      <button type="button" id="nj-metro" aria-pressed="false">METRO OFF</button>
      <button type="button" id="nj-labels" aria-pressed="true">LABELS ON</button>
      <button type="button" id="nj-brooklyn" aria-label="View Brooklyn Bridge">BRIDGE</button>
      <button type="button" id="nj-park" aria-label="View Central Park trees">PARK TREES</button>
      <button type="button" id="nj-proof" aria-label="Open the NPC first proof">NPC PROOF</button>
      <a class="nj-train-models" href="${import.meta.env.BASE_URL}worlds/train-models/">TRAIN MODELS</a>
      <button type="button" id="nj-overview">OVERVIEW</button>
    </div>
    <div class="nj-map-key">▣ BUILDINGS <b>·</b> STREET NAMES <b>·</b> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener" style="color: inherit">© OPENSTREETMAP</a> <b>·</b> <a href="https://data.cityofnewyork.us/d/64uk-42ks" target="_blank" rel="noopener" style="color: inherit">NYC PLUTO</a> <b>·</b> <a href="https://data.cityofnewyork.us/d/43nn-pn8j" target="_blank" rel="noopener" style="color: inherit">NYC HEALTH</a></div>
    <div class="nj-transit-key" id="nj-transit-key" hidden><span class="nj-key-subway">- - SUBWAY · MOVING TRAIN MODEL · BRIDGE RAIL</span><span class="nj-key-metro">- - METRO-NORTH · MOVING TRAIN MODEL</span><span>UNDERGROUND TRAINS SHOWN AS MAP PROJECTIONS · MTA STATIC GTFS</span></div>
    <aside class="nj-place-card" id="nj-place-card" hidden aria-live="polite"></aside>
    <div class="nj-help">DRAG TO PAN <b>·</b> SCROLL OR PINCH TO ZOOM <b>·</b> SHIFT + DRAG TO ORBIT</div>
    <div class="nj-loading" id="nj-loading" role="status">READING THE CITY MODEL…</div>
  </div>
`

const timeManager = new TimeManager(app.querySelector<HTMLElement>('.nj-topbar')!, () => npcPopulation.refreshNow())
if (import.meta.hot) import.meta.hot.dispose(() => timeManager.dispose())

const stage = app.querySelector<HTMLDivElement>('.nj-stage')!
const canvasStatus = app.querySelector<HTMLElement>('#nj-status')!
const loading = app.querySelector<HTMLElement>('#nj-loading')!
const coordinates = app.querySelector<HTMLElement>('#nj-coordinates')!
const tileCount = app.querySelector<HTMLElement>('#nj-tile-count')!
const viewMode = app.querySelector<HTMLElement>('#nj-view-mode')!
const zoneSwitch = app.querySelector<HTMLElement>('#nj-zone-switch')!
const roadLabels = app.querySelector<HTMLElement>('#nj-road-labels')!
const roadButton = app.querySelector<HTMLButtonElement>('#nj-roads')!
const subwayButton = app.querySelector<HTMLButtonElement>('#nj-subway')!
const metroButton = app.querySelector<HTMLButtonElement>('#nj-metro')!
const labelButton = app.querySelector<HTMLButtonElement>('#nj-labels')!
const transitKey = app.querySelector<HTMLElement>('#nj-transit-key')!
const placeCard = app.querySelector<HTMLElement>('#nj-place-card')!
const assetBase = `${import.meta.env.BASE_URL}assets/nju-jork/`
let placeCatalog: PlaceCatalog | null = null
let npcOccupancy: NpcOccupancy | null = null
let mappedKind = ''
const mappedById = new Map<string, MappedPlace>()

const scene = new THREE.Scene()
scene.background = new THREE.Color('#152b31')
scene.fog = new THREE.Fog('#152b31', 1800, 5400)
const skyBox = new SkyBox({
  zenith: 0x3a728c, horizon: 0x152b31, cloud: 0xa3b9bc, sun: 0xffd7a4,
  cloudOpacity: 0.32, sunVisibility: 0.55, starVisibility: 0,
})
scene.add(skyBox.mesh)
if (import.meta.hot) import.meta.hot.dispose(() => skyBox.dispose())
const camera = new THREE.PerspectiveCamera(55, 1, .5, 12000)
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, innerWidth < 700 ? 1.25 : 1.6))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.domElement.setAttribute('aria-label', 'Ambient NPCs New York model. Drag to pan, scroll to zoom, Shift and drag to orbit.')
stage.append(renderer.domElement)
const transitOverlay = new TransitOverlay(stage)
const transitVehicles = new TransitVehicles(scene)
if (import.meta.hot) import.meta.hot.dispose(() => transitVehicles.dispose())

const overviewMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false })
const tileMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true })

// One block of facade (3 m, about a floor): two windows on a white wall. The texture multiplies each
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
let sidewalks: SidewalkNetwork | null = null
let transitNetwork: TransitNetwork | null = null
let activeTransit: TransitZone | undefined
let activeStations = new Map<string, TransitNode>()
let roadGroup: THREE.Group | null = null
let brooklynModel: THREE.Group | null = null
let flyoverModel: THREE.Group | null = null
let stationModel: THREE.Group | null = null
let grandCentralDetail: THREE.Group | null = null
let elevatedRailModel: THREE.Group | null = null
let skyline: SkylineScene | null = null
let timesSquare: TimesSquareScene | null = null
let adAtlas: AdAtlas | null = null
/** Raster footprints replaced by hand-built landmark models */
let modelCutouts: Rect[] = []
/** road-network building id → the model that replaces it */
const towerByBuilding = new Map<string, TowerDef>()
let brooklynTile = ''
let roadsVisible = false
let subwayVisible = false
let metroVisible = false
let labelsVisible = true
let activeRoads: Road[] = []
let activeBuildings: Building[] = []
let lastLabelUpdate = 0
type TileMesh = { mesh: THREE.Mesh; trees: THREE.Group; surface: THREE.Group; ads: THREE.Group; data: Uint8ClampedArray; lod: 'standard' | 'detail'; anchor: string }
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
function proofCameraOrbit(x: number, z: number) {
  // Face the home entrance from W 45th St, then the cart from along 7th Ave.
  return x > -525 || z < -67 ? -Math.PI / 2 : -Math.PI
}
let followPopulationId = 0
const npcProof = new NpcProof(scene, app, camera, (x, z, height) => {
  followPopulationId = 0
  npcPopulation.stopFollowing()
  npcPopulationFigures.select(0)
  targetFocus.set(x, 0, z)
  targetViewHeight = height
  orbit = proofCameraOrbit(x, z)
  tiltAdjustment = .08
  dirty = true
})
if (import.meta.hot) import.meta.hot.dispose(() => npcProof.dispose())
const npcPopulationFigures = new NpcPopulationFigures(scene, () => { dirty = true })
const npcPopulation = new NpcPopulation(app, `${assetBase}npc-data/`,
  (people) => npcPopulationFigures.setPeople(people),
  (npcId) => {
    const point = npcPopulationFigures.positionFor(npcId)
    if (!point) return
    npcProof.stopFollowing()
    followPopulationId = npcId
    npcPopulationFigures.select(npcId)
    targetFocus.set(point.x, 0, point.z)
    targetViewHeight = 7
    orbit = npcPopulationFigures.orbitFor(npcId) ?? 0
    tiltAdjustment = .5
    dirty = true
  }, () => timeManager.nowMs())
if (import.meta.hot) import.meta.hot.dispose(() => {
  npcPopulation.dispose()
  npcPopulationFigures.dispose()
})

function stopFollowingNpc() {
  npcProof.stopFollowing()
  npcPopulation.stopFollowing()
  followPopulationId = 0
  npcPopulationFigures.select(0)
}

function key(rx: number, rz: number) { return `${rx},${rz}` }

/** A modelled tower or Times Square by view id, for markers, the picker and ?view= links. */
function skylineView(id: string): { x: number; z: number; height: number } | undefined {
  if (id === TIMES_SQUARE.id) return TIMES_SQUARE
  return skyline?.towers.find((tower) => tower.id === id)
}

/** Side-on framing tall enough to fit the whole tower. */
function skylineViewHeight(height: number) {
  return THREE.MathUtils.clamp(height * 2.3, 130, 460)
}

function jumpToLandmark(id: string) {
  const station = STATION_LANDMARKS.find((item) => item.id === id)
  const tower = station ? undefined : skylineView(id)
  const landmark = station ?? tower
  if (!landmark) return
  stopFollowingNpc()
  targetFocus.set(landmark.x, 0, landmark.z)
  targetViewHeight = tower ? skylineViewHeight(tower.height) : 135
  tiltAdjustment = tower ? -.18 : .8
  const url = new URL(location.href)
  for (const parameter of ['x', 'z', 'height', 'tilt', 'mode']) url.searchParams.delete(parameter)
  url.searchParams.set('view', id)
  history.replaceState(null, '', url)
  const stationPicker = zoneSwitch.querySelector<HTMLSelectElement>('.nj-station-picker:not(.nj-tower-picker)')
  if (stationPicker) stationPicker.value = station ? id : ''
  const towerPicker = zoneSwitch.querySelector<HTMLSelectElement>('.nj-tower-picker')
  if (towerPicker) towerPicker.value = tower ? id : ''
  dirty = true
}

function brooklynApproachOrbit(bridge: BrooklynBridgeData) {
  const [[ax, az], [bx, bz]] = bridge.towers
  return Math.atan2(ax - bx, az - bz)
}

function brooklynFootpathAt(bridge: BrooklynBridgeData, x: number, z: number): [number, number] {
  const [[ax, az], [bx, bz]] = bridge.towers
  const dx = bx - ax
  const dz = bz - az
  const length = Math.hypot(dx, dz)
  const along = ((x - ax) * dx + (z - az) * dz) / length
  return [ax + (dx / length) * along - (dz / length) * 4.5,
    az + (dz / length) * along + (dx / length) * 4.5]
}

function bridgeDeckAtFocus() {
  const bridge = manifest?.brooklynBridge
  if (!bridge) return 0
  const [[ax, az], [bx, bz]] = bridge.towers
  const dx = bx - ax
  const dz = bz - az
  const length = Math.hypot(dx, dz)
  const along = ((focus.x - ax) * dx + (focus.z - az) * dz) / length
  const across = Math.abs(((focus.x - ax) * dz - (focus.z - az) * dx) / length)
  return along > -46 && along < length + 46 && across < 11 ? bridge.deckRise : 0
}

/** Query the same height cells used to build the visible city, including unnamed buildings. */
function cameraCollisionTopAt(x: number, y: number, z: number, radius: number): number {
  if (!zone || !manifest || y + radius <= 0) return 0
  let top = 0
  if (zone.id === 'city' && stationModel && viewHeight < 1200) {
    for (const box of STATION_COLLIDERS) {
      if (y - radius >= box.top) continue
      const nearX = THREE.MathUtils.clamp(x, box.minX, box.maxX)
      const nearZ = THREE.MathUtils.clamp(z, box.minZ, box.maxZ)
      if ((x - nearX) ** 2 + (z - nearZ) ** 2 < radius ** 2) top = Math.max(top, box.top)
    }
  }
  const tileSize = manifest.tileBlocks
  for (let rz = Math.floor((z - radius) / tileSize); rz <= Math.floor((z + radius) / tileSize); rz++) {
    for (let rx = Math.floor((x - radius) / tileSize); rx <= Math.floor((x + radius) / tileSize); rx++) {
      const tile = loadedTiles.get(key(rx, rz))
      if (!tile) continue
      const step = tile.lod === 'detail' ? manifest.detailStep : manifest.step
      const width = tile.lod === 'detail' ? manifest.detailPixels : manifest.tilePixels
      const originX = rx * tileSize
      const originZ = rz * tileSize
      const minX = Math.max(0, Math.floor((x - radius - originX) / step))
      const maxX = Math.min(width - 1, Math.floor((x + radius - originX) / step))
      const minZ = Math.max(0, Math.floor((z - radius - originZ) / step))
      const maxZ = Math.min(width - 1, Math.floor((z + radius - originZ) / step))
      for (let cz = minZ; cz <= maxZ; cz++) for (let cx = minX; cx <= maxX; cx++) {
        const x0 = originX + cx * step
        const z0 = originZ + cz * step
        const nearX = THREE.MathUtils.clamp(x, x0, x0 + step)
        const nearZ = THREE.MathUtils.clamp(z, z0, z0 + step)
        if ((x - nearX) ** 2 + (z - nearZ) ** 2 >= radius ** 2) continue
        const pixel = (cz * width + cx) * 4
        const height = tile.data[pixel + 3] - 1 - manifest.baseY
        if (height < 2.5 || y - radius >= height) continue
        const r = tile.data[pixel], g = tile.data[pixel + 1], b = tile.data[pixel + 2]
        const bridgeDeck = height === manifest.bridgeRise
          && ((r === 0 && g === 0 && b === 0) || (r === 150 && g === 150 && b === 150))
        if (!bridgeDeck) top = Math.max(top, height)
      }
    }
  }
  return top
}

function cameraPose() {
  const t = THREE.MathUtils.clamp((Math.log(viewHeight) - Math.log(7)) / (Math.log(260) - Math.log(7)), 0, 1)
  const tilt = THREE.MathUtils.clamp(THREE.MathUtils.lerp(.14, .86, t) + tiltAdjustment, .08, 1.45)
  const distance = viewHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))
  const lookHeight = THREE.MathUtils.lerp(1.6, 16, t) + bridgeDeckAtFocus() * (1 - t)
  camera.position.set(
    focus.x + Math.sin(orbit) * Math.cos(tilt) * distance,
    Math.max(2, lookHeight + Math.sin(tilt) * distance),
    focus.z + Math.cos(orbit) * Math.cos(tilt) * distance,
  )
  const clear = resolveCameraCollision(camera.position, cameraCollisionTopAt)
  camera.position.set(clear.x, clear.y, clear.z)
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
  stopFollowingNpc()
  const [left, top, right, bottom] = zone.bounds
  targetFocus.set((left + right) / 2, 0, (top + bottom) / 2)
  const aspect = Math.max(.5, stage.clientWidth / Math.max(1, stage.clientHeight))
  targetViewHeight = Math.max(bottom - top, (right - left) / aspect) * 1.14
  dirty = true
}

function removeTile(entry: TileMesh) {
  scene.remove(entry.mesh)
  scene.remove(entry.trees)
  scene.remove(entry.surface)
  scene.remove(entry.ads)
  entry.mesh.geometry.dispose()
  disposeMinecraftTrees(entry.trees)
  disposeSmoothRoads(entry.surface)
  disposeStreetAds(entry.ads)
}

function clearTiles() {
  for (const entry of loadedTiles.values()) removeTile(entry)
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
    const edgeMargin = width < 700 ? 40
      : element.classList.contains('nj-building-marker') || element.classList.contains('nj-transit-marker') ? 100 : 62
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
  for (const landmark of STATION_LANDMARKS) {
    if (Math.hypot(landmark.x - focus.x, landmark.z - focus.z) > radius) continue
    const marker = document.createElement('button')
    marker.type = 'button'
    marker.className = 'nj-landmark-marker'
    marker.dataset.landmark = landmark.id
    marker.dataset.z = String(landmark.z)
    marker.textContent = landmark.name
    marker.title = `${landmark.name} · above-ground landmark`
    place(marker, landmark.x, landmark.id === 'oculus' ? 25 : landmark.id === 'grand-central' ? 25 : landmark.id === 'fulton' ? 14 : 13, 165, 40)
  }
  // Times Square and the hand-built towers, labelled just above their tops.
  for (const landmark of [TIMES_SQUARE, ...(skyline?.towers ?? [])]) {
    if (Math.hypot(landmark.x - focus.x, landmark.z - focus.z) > radius) continue
    const marker = document.createElement('button')
    marker.type = 'button'
    marker.className = landmark.id === TIMES_SQUARE.id ? 'nj-landmark-marker nj-times-square-marker' : 'nj-landmark-marker nj-tower-marker'
    marker.dataset.landmark = landmark.id
    marker.dataset.z = String(landmark.z)
    marker.textContent = landmark.name
    marker.title = landmark.id === TIMES_SQUARE.id ? 'Times Square · billboards and plaza' : `${landmark.name} · hand-built landmark model`
    place(marker, landmark.x, landmark.height + 3, 165, 40)
  }
  if (subwayVisible || metroVisible) {
    const stationLimit = viewHeight > 220 ? 12 : viewHeight > 65 ? 18 : 26
    const stations = [...activeStations.values()].filter((station) =>
      (station.mode === 'subway' ? subwayVisible : metroVisible)
      && Math.abs(station.x - focus.x) < radius && Math.abs(station.z - focus.z) < radius)
      .sort((a, b) => Math.hypot(a.x - focus.x, a.z - focus.z) - Math.hypot(b.x - focus.x, b.z - focus.z))
    let placed = 0
    for (const station of stations) {
      if (placed >= stationLimit) break
      const marker = document.createElement('button')
      marker.type = 'button'
      marker.className = `nj-transit-marker ${station.mode === 'subway' ? 'subway' : 'metro'}`
      marker.dataset.station = station.id
      marker.dataset.z = String(station.z)
      marker.textContent = station.name ?? station.id
      marker.title = `${station.name} · ${station.mode === 'subway' ? 'Subway' : 'Metro-North'} · ${station.id}`
      marker.setAttribute('aria-label', marker.title)
      if (place(marker, station.x, .8, 135, 33)) placed++
    }
    roadLabels.replaceChildren(...items)
    return
  }
  if (mappedKind && placeCatalog) {
    const mappedBuildings = placeCatalog.buildings.filter((building) => building.uses.includes(mappedKind))
    const byBuilding = new Map(placeCatalog.buildings.map((building) => [building.id, building]))
    const candidates = mappedKind === 'home' || mappedKind === 'office'
      ? mappedBuildings.map((building) => ({ id: building.id, label: building.address || building.name,
        x: building.x, z: building.z, building }))
      : placeCatalog.places.filter((item) => item.kind === mappedKind).map((item) => {
        const building = byBuilding.get(item.anchorId)
        return building ? { id: item.id, label: item.label, x: building.x, z: building.z, building } : null
      }).filter((item): item is NonNullable<typeof item> => item !== null)
    candidates.sort((a, b) => Math.hypot(a.x - focus.x, a.z - focus.z) - Math.hypot(b.x - focus.x, b.z - focus.z))
    let shown = 0
    for (const item of candidates) {
      if (shown >= (viewHeight > 220 ? 12 : 30)) break
      if (Math.abs(item.x - focus.x) > radius || Math.abs(item.z - focus.z) > radius) continue
      const marker = document.createElement('button')
      marker.type = 'button'
      marker.className = 'nj-mapped-marker'
      marker.dataset.mapped = item.id
      marker.dataset.z = String(item.z)
      const counts = npcOccupancy?.anchors[item.building.id]
      const count = mappedKind === 'home' ? counts?.residents : mappedKind === 'office' ? counts?.workers : 0
      marker.textContent = count ? `${count} ${mappedKind === 'home' ? 'residents' : 'workers'} · ${item.label}` : item.label
      marker.title = `${mappedKind.replace('_', ' ')} · ${item.label}`
      if (place(marker, item.x, Math.max(2, item.building ? (activeBuildings.find((building) => building.id === item.building.id)?.roofY ?? manifest.baseY) - manifest.baseY + .6 : 2), 125, 34)) shown++
    }
    roadLabels.replaceChildren(...items)
    return
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
  // Modelled towers already carry their own landmark marker.
  const buildings = activeBuildings.filter((building) => !towerByBuilding.has(building.id)
    && Math.abs(building.x - focus.x) < radius && Math.abs(building.z - focus.z) < radius)
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
  const mappedTarget = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-mapped]')
  if (mappedTarget && placeCatalog) {
    const id = mappedTarget.dataset.mapped ?? ''
    const business = mappedById.get(id)
    const building = placeCatalog.buildings.find((item) => item.id === (business?.anchorId ?? id))
    if (!building) return
    placeCard.innerHTML = '<button type="button" class="nj-card-close" aria-label="Close place details">×</button><span class="nj-card-eyebrow"></span><h2></h2><p class="nj-card-address"></p><p class="nj-card-meta"></p><small></small>'
    placeCard.querySelector('.nj-card-eyebrow')!.textContent = `${mappedKind.toUpperCase()} · SOURCE MATCH`
    placeCard.querySelector('h2')!.textContent = business?.label ?? building.name
    placeCard.querySelector<HTMLElement>('.nj-card-address')!.textContent = building.address
    placeCard.querySelector<HTMLElement>('.nj-card-meta')!.textContent = business
      ? `${business.source} · ${business.sourceId} · ${business.match}`
      : `${building.unitsRes} residential units · ${building.officeAreaSqFt.toLocaleString()} office sq ft`
    const counts = npcOccupancy?.anchors[building.id]
    if (counts) placeCard.querySelector<HTMLElement>('.nj-card-meta')!.textContent +=
      ` · ${counts.residents} simulated residents · ${counts.workers} simulated workers · ${counts.students} simulated students`
    placeCard.querySelector('small')!.textContent = 'Mapped to this 3D building approximately. NPC homes and jobs are simulated; these are not real residents or employees.'
    placeCard.hidden = false
    placeCard.querySelector<HTMLButtonElement>('button')!.addEventListener('click', () => { placeCard.hidden = true })
    return
  }
  const landmarkTarget = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-landmark]')
  if (landmarkTarget) {
    const id = landmarkTarget.dataset.landmark ?? ''
    jumpToLandmark(id)
    const view = skylineView(id)
    if (view) {
      const tower = skyline?.towers.find((item) => item.id === id)
      placeCard.innerHTML = '<button type="button" class="nj-card-close" aria-label="Close landmark details">×</button><span class="nj-card-eyebrow"></span><h2></h2><p class="nj-card-address"></p><p class="nj-card-meta"></p><small></small>'
      placeCard.querySelector('.nj-card-eyebrow')!.textContent = tower ? 'ICONIC TOWER · HAND-BUILT BLOCK MODEL' : 'TIMES SQUARE · BILLBOARDS'
      placeCard.querySelector('h2')!.textContent = tower?.name ?? TIMES_SQUARE.name
      placeCard.querySelector<HTMLElement>('.nj-card-address')!.textContent = tower
        ? `About ${Math.round(tower.height * 3)} m to the top · ${Math.round(tower.height)} blocks`
        : 'Broadway and Seventh Avenue, W 42nd to W 47th Street'
      placeCard.querySelector<HTMLElement>('.nj-card-meta')!.textContent = `${tower?.buildingId ? `${tower.buildingId} · ` : ''}X ${Math.round(view.x)} / Z ${Math.round(view.z)}`
      placeCard.querySelector('small')!.textContent = tower
        ? 'Modelled from OpenStreetMap footprints and published heights; details are simplified into blocks.'
        : 'Screens and billboards show made-up brands only.'
      placeCard.hidden = false
      placeCard.querySelector<HTMLButtonElement>('button')!.addEventListener('click', () => { placeCard.hidden = true })
    }
    return
  }
  const stationTarget = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-station]')
  if (stationTarget) {
    const station = activeStations.get(stationTarget.dataset.station ?? '')
    if (!station) return
    const routes = (station.routes ?? []).map((id) =>
      activeTransit?.routes.find((route) => route.mode === station.mode && route.id === id)?.name ?? id)
    placeCard.innerHTML = '<button type="button" class="nj-card-close" aria-label="Close station details">×</button><span class="nj-card-eyebrow"></span><h2></h2><p class="nj-card-address"></p><p class="nj-card-meta"></p><small></small>'
    placeCard.querySelector('.nj-card-eyebrow')!.textContent = station.mode === 'subway' ? 'SUBWAY STATION · MTA GTFS' : 'METRO-NORTH STATION · MTA GTFS'
    placeCard.querySelector('h2')!.textContent = station.name ?? station.id
    placeCard.querySelector<HTMLElement>('.nj-card-address')!.textContent = routes.length ? `Routes: ${routes.join(', ')}` : 'Route data unavailable'
    placeCard.querySelector<HTMLElement>('.nj-card-meta')!.textContent = `${station.id} · X ${station.x.toFixed(1)} / Z ${station.z.toFixed(1)}`
    placeCard.querySelector('small')!.textContent = 'Static station and track network. Train positions and passenger simulation are not connected yet.'
    placeCard.hidden = false
    placeCard.querySelector<HTMLButtonElement>('button')!.addEventListener('click', () => { placeCard.hidden = true })
    return
  }
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
  stopFollowingNpc()
  npcProof.setZone(next.id)
  npcPopulationFigures.setZone(next.id)
  showRoads(next.id)
  activeTransit = transitNetwork?.zones[next.id]
  activeStations = new Map(activeTransit?.nodes.filter((node) => node.kind === 'station')
    .map((node): [string, TransitNode] => [node.id, node]) ?? [])
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
  const query = new URLSearchParams(location.search)
  const bridgeStart = next.id === 'city' && query.get('view') === 'brooklyn-bridge'
    ? manifest.brooklynBridge : undefined
  const parkStart = next.id === 'city' && query.get('view') === 'central-park'
    ? manifest.parkFocus : undefined
  const stationStart = next.id === 'city'
    ? STATION_LANDMARKS.find((item) => item.id === query.get('view')) : undefined
  const towerStart = next.id === 'city' && !stationStart ? skylineView(query.get('view') ?? '') : undefined
  const directStart: [number, number] | undefined = next.id === 'city' && query.has('x') && query.has('z')
    && Number.isFinite(Number(query.get('x'))) && Number.isFinite(Number(query.get('z')))
    ? [Number(query.get('x')), Number(query.get('z'))] : undefined
  let start: [number, number] = bridgeStart
    ? [(bridgeStart.towers[0][0] + bridgeStart.towers[1][0]) / 2, (bridgeStart.towers[0][1] + bridgeStart.towers[1][1]) / 2]
    : directStart ?? (stationStart ? [stationStart.x, stationStart.z] : undefined)
      ?? (towerStart ? [towerStart.x, towerStart.z] : undefined) ?? parkStart ?? next.start
  const streetStart = (bridgeStart || parkStart || directStart) && query.get('mode') === 'street'
  if (streetStart && bridgeStart) {
    start = brooklynFootpathAt(bridgeStart, start[0], start[1])
    orbit = brooklynApproachOrbit(bridgeStart)
  }
  focus.set(start[0], 0, start[1])
  targetFocus.copy(focus)
  const requestedHeight = Number(query.get('height'))
  viewHeight = streetStart ? 7 : directStart && Number.isFinite(requestedHeight) && requestedHeight > 0
    ? THREE.MathUtils.clamp(requestedHeight, 7, 6500) : stationStart ? 135 : towerStart ? skylineViewHeight(towerStart.height)
      : bridgeStart || parkStart ? 180 : next.id === 'city' ? 260 : 180
  targetViewHeight = viewHeight
  if (stationStart) tiltAdjustment = .8
  if (towerStart) tiltAdjustment = -.18
  if (directStart && query.has('tilt') && Number.isFinite(Number(query.get('tilt'))))
    tiltAdjustment = THREE.MathUtils.clamp(Number(query.get('tilt')), -.42, 1)
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
    if (epoch === 1) npcPopulation.start(focus.x, focus.z)
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
  const rgbAt = (i: number, shade = 1): [number, number, number] => {
    const offset = i * 4
    // The raster has broad black intersections. The mapped road and sidewalk
    // meshes above it provide the actual street shape and visible pavement.
    const oldRoad = heights[i] <= .1 && data[offset] === 0 && data[offset + 1] === 0 && data[offset + 2] === 0
    const [r, g, b] = oldRoad ? [119, 124, 120] : [data[offset], data[offset + 1], data[offset + 2]]
    return [srgbToLinear(r) * shade, srgbToLinear(g) * shade, srgbToLinear(b) * shade]
  }
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
      const [r, g, b] = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]
      const bridgeDeck = y1 === manifest.bridgeRise && ((r === 0 && g === 0 && b === 0) || (r === 150 && g === 150 && b === 150))
      const wallBase = bridgeDeck ? Math.max(y0, y1 - .45) : y0
      corners[1] = wallBase; corners[4] = wallBase; corners[7] = y1; corners[10] = y1
      // Bridges are thin decks. Building walls get windows, but bridge edges do not.
      const glazed = !bridgeDeck && y1 >= 3 && y1 - y0 >= 2.5 && !(g > r + 8 && g > b + 8)
      // u runs along the wall in blocks (z for walls facing x, x for walls facing z), v up it in blocks.
      const along = side < 2 ? 2 : 0
      const uv = [corners[along], wallBase, corners[3 + along], wallBase, corners[6 + along], y1, corners[9 + along], y1]
      const edgeColour: [number, number, number] = bridgeDeck
        ? [srgbToLinear(105), srgbToLinear(111), srgbToLinear(113)]
        : rgbAt(i, side === 0 || side === 2 ? .68 : .82)
      addQuad(positions, colors, uvs, glazed ? facadeIndices : indices, corners, edgeColour, uv)
    }
  }
  // Add a few concrete piers to the tile mesh, so they only appear with their 3D deck.
  const supportColour: [number, number, number] = [srgbToLinear(105), srgbToLinear(111), srgbToLinear(113)]
  const cropLeft = originX + minX * step
  const cropRight = originX + maxX * step
  const cropTop = originZ + minZ * step
  const cropBottom = originZ + maxZ * step
  for (const [px, pz, rise] of manifest.bridgePiers ?? []) {
    if (px < cropLeft || px >= cropRight || pz < cropTop || pz >= cropBottom) continue
    const x0 = px - 1.25; const x1 = px + 1.25
    const z0 = pz - 1.25; const z1 = pz + 1.25
    const y0 = 0; const y1 = rise - .35
    addQuad(positions, colors, uvs, indices, [x0,y0,z0, x0,y0,z1, x0,y1,z1, x0,y1,z0], supportColour)
    addQuad(positions, colors, uvs, indices, [x1,y0,z1, x1,y0,z0, x1,y1,z0, x1,y1,z1], supportColour)
    addQuad(positions, colors, uvs, indices, [x1,y0,z0, x0,y0,z0, x0,y1,z0, x1,y1,z0], supportColour)
    addQuad(positions, colors, uvs, indices, [x0,y0,z1, x1,y0,z1, x1,y1,z1, x0,y1,z1], supportColour)
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

let streetAdsFailed = false

/** Kiosks, bus shelters, rooftop billboards and murals for one tile; an empty group if the builder fails. */
function streetAdsFor(data: Uint8ClampedArray, lod: 'standard' | 'detail', originX: number, originZ: number,
  anchorX: number, anchorZ: number, treeData: MinecraftTree[]) {
  if (!adAtlas || streetAdsFailed) return new THREE.Group()
  try {
    return buildStreetAds(activeRoads, {
      data,
      width: lod === 'detail' ? manifest.detailPixels : manifest.tilePixels,
      step: lod === 'detail' ? manifest.detailStep : manifest.step,
      originX,
      originZ,
      groundByte: manifest.baseY + 1,
      lod,
      crop: lod === 'detail' ? { x: anchorX, z: anchorZ, radius: 128 } : undefined,
    }, treeData, adAtlas)
  } catch (error) {
    streetAdsFailed = true
    console.error('Street ads could not be built:', error)
    return new THREE.Group()
  }
}

async function loadTile(rx: number, rz: number, epoch: number,
  lod: 'standard' | 'detail', anchorX: number, anchorZ: number, anchor: string) {
  const id = key(rx, rz)
  pendingTiles.add(id)
  try {
    const treeResponse = await fetch(`${assetBase}trees.${rx}.${rz}.json`)
    if (!treeResponse.ok) throw new Error(`Trees for tile ${id} unavailable`)
    const treeData = await treeResponse.json() as MinecraftTree[]
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
      // Hand-built landmark models replace the raster blocks under their footprints.
      flattenCutouts(data, canvas.width, lod === 'detail' ? manifest.detailStep : manifest.step,
        rx * manifest.tileBlocks, rz * manifest.tileBlocks, manifest.baseY + 1, modelCutouts)
      if (manifest.brooklynBridge) clearBrooklynRampRaster(data, canvas.width,
        lod === 'detail' ? manifest.detailStep : manifest.step,
        rx * manifest.tileBlocks, rz * manifest.tileBlocks, manifest.brooklynBridge, manifest.baseY)
      tileDataCache.set(cacheKey, data)
      if (tileDataCache.size > 10) tileDataCache.delete(tileDataCache.keys().next().value!)
    }
    if (epoch !== zoneEpoch) return
    const mesh = makeTile(rx, rz, data, lod, anchorX, anchorZ)
    const trees = buildMinecraftTrees(treeData, lod === 'detail' ? { x: anchorX, z: anchorZ, radius: 128 } : undefined)
    const left = rx * manifest.tileBlocks
    const top = rz * manifest.tileBlocks
    const surface = buildSmoothRoads(activeRoads, {
      left: lod === 'detail' ? Math.max(left, anchorX - 128) : left,
      top: lod === 'detail' ? Math.max(top, anchorZ - 128) : top,
      right: lod === 'detail' ? Math.min(left + manifest.tileBlocks, anchorX + 128) : left + manifest.tileBlocks,
      bottom: lod === 'detail' ? Math.min(top + manifest.tileBlocks, anchorZ + 128) : top + manifest.tileBlocks,
    }, manifest.footpathWidthBlocks ?? 2, sidewalks?.data.connectors ?? [], sidewalks?.data.crossings ?? [])
    const ads = streetAdsFor(data, lod, left, top, anchorX, anchorZ, treeData)
    loadedTiles.set(id, { mesh, trees, surface, ads, data, lod, anchor })
    scene.add(mesh)
    scene.add(surface)
    scene.add(trees)
    scene.add(ads)
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
  const lod: 'standard' | 'detail' = viewHeight < DETAIL_VIEW_HEIGHT ? 'detail' : 'standard'
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
    removeTile(entry)
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
const tapOrigins = new Map<number, { x: number; y: number; button: number; moved: boolean; multi: boolean }>()
function pan(dx: number, dy: number) {
  stopFollowingNpc()
  const unit = viewHeight / Math.max(1, stage.clientHeight)
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
  targetFocus.x += (-dx * right.x + dy * up.x) * unit
  targetFocus.z += (-dx * right.z + dy * up.z) * unit
  clampFocus()
  dirty = true
}
renderer.domElement.addEventListener('pointerdown', (event) => {
  if (pointers.size) for (const tap of tapOrigins.values()) tap.multi = true
  tapOrigins.set(event.pointerId, { x: event.clientX, y: event.clientY,
    button: event.button, moved: false, multi: pointers.size > 0 })
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  renderer.domElement.setPointerCapture(event.pointerId)
})
renderer.domElement.addEventListener('pointermove', (event) => {
  const tap = tapOrigins.get(event.pointerId)
  if (tap && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 5) tap.moved = true
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
    stopFollowingNpc()
    orbit -= dx * .004
    tiltAdjustment = THREE.MathUtils.clamp(tiltAdjustment + dy * .003, -.42, .42)
    dirty = true
  } else pan(dx, dy)
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
})
renderer.domElement.addEventListener('pointerup', (event) => {
  const tap = tapOrigins.get(event.pointerId)
  const single = pointers.size === 1
  pointers.delete(event.pointerId)
  tapOrigins.delete(event.pointerId)
  if (!tap || !single || tap.button !== 0 || tap.multi || tap.moved || event.shiftKey
    || Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 5
    || zone?.id !== 'city' || viewHeight >= 200) return
  const bounds = renderer.domElement.getBoundingClientRect()
  const x = (event.clientX - bounds.left) / bounds.width * 2 - 1
  const y = 1 - (event.clientY - bounds.top) / bounds.height * 2
  const npcId = npcPopulationFigures.pick(camera, x, y)
  if (npcId !== null) npcPopulation.focusNpc(npcId)
})
renderer.domElement.addEventListener('pointercancel', (event) => {
  pointers.delete(event.pointerId)
  tapOrigins.delete(event.pointerId)
})
renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault())
renderer.domElement.addEventListener('wheel', (event) => {
  event.preventDefault()
  stopFollowingNpc()
  targetViewHeight = THREE.MathUtils.clamp(targetViewHeight * Math.exp(event.deltaY * .0012), 7, 6500)
  dirty = true
}, { passive: false })

app.querySelector<HTMLButtonElement>('#nj-zoom-in')!.addEventListener('click', () => {
  stopFollowingNpc()
  targetViewHeight = Math.max(7, targetViewHeight * .64)
  dirty = true
})
app.querySelector<HTMLButtonElement>('#nj-zoom-out')!.addEventListener('click', () => {
  stopFollowingNpc()
  targetViewHeight = Math.min(6500, targetViewHeight * 1.55)
  dirty = true
})
app.querySelector<HTMLButtonElement>('#nj-street')!.addEventListener('click', () => {
  stopFollowingNpc()
  if (viewHeight > 1450) targetFocus.set(zone.start[0], 0, zone.start[1])
  if (bridgeDeckAtFocus() && manifest.brooklynBridge) {
    const [x, z] = brooklynFootpathAt(manifest.brooklynBridge, focus.x, focus.z)
    targetFocus.set(x, 0, z)
    orbit = brooklynApproachOrbit(manifest.brooklynBridge)
  }
  targetViewHeight = 7
  dirty = true
})
app.querySelector<HTMLButtonElement>('#nj-overview')!.addEventListener('click', overviewView)
app.querySelector<HTMLButtonElement>('#nj-proof')!.addEventListener('click', () => { void npcProof.open() })
app.querySelector<HTMLButtonElement>('#nj-brooklyn')!.addEventListener('click', () => {
  stopFollowingNpc()
  const bridge = manifest?.brooklynBridge
  if (!bridge || zone?.id !== 'city') return
  targetFocus.set((bridge.towers[0][0] + bridge.towers[1][0]) / 2, 0,
    (bridge.towers[0][1] + bridge.towers[1][1]) / 2)
  targetViewHeight = 180
  dirty = true
})
app.querySelector<HTMLButtonElement>('#nj-park')!.addEventListener('click', () => {
  stopFollowingNpc()
  if (!manifest?.parkFocus || zone?.id !== 'city') return
  targetFocus.set(manifest.parkFocus[0], 0, manifest.parkFocus[1])
  targetViewHeight = 180
  dirty = true
})
roadButton.addEventListener('click', () => {
  roadsVisible = !roadsVisible
  roadButton.textContent = roadsVisible ? 'ROADS ON' : 'ROADS OFF'
  roadButton.setAttribute('aria-pressed', String(roadsVisible))
  dirty = true
})
function updateTransitControls() {
  subwayButton.textContent = subwayVisible ? 'SUBWAY ON' : 'SUBWAY OFF'
  subwayButton.setAttribute('aria-pressed', String(subwayVisible))
  metroButton.textContent = metroVisible ? 'METRO ON' : 'METRO OFF'
  metroButton.setAttribute('aria-pressed', String(metroVisible))
  transitKey.hidden = !subwayVisible && !metroVisible
  transitKey.querySelector<HTMLElement>('.nj-key-subway')!.hidden = !subwayVisible
  transitKey.querySelector<HTMLElement>('.nj-key-metro')!.hidden = !metroVisible
  lastLabelUpdate = 0
  dirty = true
}
function syncTransitQuery() {
  const url = new URL(location.href)
  const selected = subwayVisible && metroVisible ? 'both' : subwayVisible ? 'subway' : metroVisible ? 'metro' : ''
  url.searchParams.set('transit', selected || 'off')
  history.replaceState(null, '', url)
}
function focusMetroRouteIfOffscreen() {
  const terminal = activeTransit?.nodes.find((node) => node.mode === 'metro-north' && node.kind === 'station')
  if (!terminal) return
  const horizontalReach = Math.max(90, viewHeight * .4)
  if (Math.abs(focus.x - terminal.x) <= horizontalReach
    && focus.z <= terminal.z + Math.max(100, viewHeight * .4)) return
  targetFocus.set(terminal.x, 0, terminal.z - 170)
  targetViewHeight = 420
  tiltAdjustment = .7
  const picker = zoneSwitch.querySelector<HTMLSelectElement>('.nj-station-picker')
  if (picker) picker.value = ''
  const url = new URL(location.href)
  url.searchParams.delete('view')
  url.searchParams.delete('mode')
  url.searchParams.set('x', String(terminal.x))
  url.searchParams.set('z', String(terminal.z - 170))
  url.searchParams.set('height', '420')
  url.searchParams.set('tilt', '.7')
  url.searchParams.set('transit', subwayVisible ? 'both' : 'metro')
  history.replaceState(null, '', url)
  dirty = true
}
subwayButton.addEventListener('click', () => {
  subwayVisible = !subwayVisible
  updateTransitControls()
  syncTransitQuery()
})
metroButton.addEventListener('click', () => {
  metroVisible = !metroVisible
  updateTransitControls()
  syncTransitQuery()
  if (metroVisible) focusMetroRouteIfOffscreen()
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
  const follow = npcProof.followPoint
  if (follow) {
    targetFocus.set(follow.x, 0, follow.z)
    orbit = THREE.MathUtils.lerp(orbit, proofCameraOrbit(follow.x, follow.z), Math.min(1, dt * 3))
  } else if (followPopulationId) {
    const point = npcPopulationFigures.positionFor(followPopulationId)
    if (point) targetFocus.set(point.x, 0, point.z)
  }
  const blend = 1 - Math.exp(-8 * dt)
  focus.lerp(targetFocus, blend)
  viewHeight = THREE.MathUtils.lerp(viewHeight, targetViewHeight, blend)
  const moving = focus.distanceToSquared(targetFocus) > .05 || Math.abs(viewHeight - targetViewHeight) > .05
  if (moving || dirty) updateCamera()
  const proofChanged = npcProof.update(dt, viewHeight, focus)
  const populationChanged = npcPopulationFigures.update(dt, viewHeight, focus, timeManager.nowMs())
  const trainsChanged = transitVehicles.update(dt, zone?.id === 'city', subwayVisible, metroVisible, viewHeight, focus)
  npcPopulation.update(focus.x, focus.z, viewHeight, now)
  refreshTiles(now)
  if (brooklynModel) {
    const visible = zone?.id === 'city' && viewHeight < 850 && loadedTiles.has(brooklynTile)
    if (brooklynModel.visible !== visible) { brooklynModel.visible = visible; dirty = true }
  }
  if (flyoverModel) {
    const visible = zone?.id === 'city' && viewHeight < 1200
    if (flyoverModel.visible !== visible) { flyoverModel.visible = visible; dirty = true }
    if (visible) for (const tile of flyoverModel.children) {
      const tileVisible = loadedTiles.has(tile.userData.tileId as string)
      if (tile.visible !== tileVisible) { tile.visible = tileVisible; dirty = true }
    }
  }
  if (stationModel) {
    const visible = zone?.id === 'city' && viewHeight < 1200
    if (stationModel.visible !== visible) { stationModel.visible = visible; dirty = true }
  }
  if (grandCentralDetail) {
    const visible = stationModel?.visible === true && viewHeight < DETAIL_VIEW_HEIGHT
    if (grandCentralDetail.visible !== visible) { grandCentralDetail.visible = visible; dirty = true }
  }
  if (elevatedRailModel) elevatedRailModel.visible = zone?.id === 'city' && viewHeight < 1200
  if (skyline) {
    const far = zone?.id === 'city' && viewHeight < 4000
    const near = far && viewHeight < 450
    if (skyline.far.visible !== far || skyline.near.visible !== near) {
      skyline.far.visible = far
      skyline.near.visible = near
      dirty = true
    }
  }
  if (timesSquare) {
    const visible = zone?.id === 'city' && viewHeight < 1500
    if (timesSquare.group.visible !== visible) { timesSquare.group.visible = visible; dirty = true }
    // Animated screens redraw a few times a second while the camera is close enough to see them.
    if (visible && timesSquare.update(now, viewHeight, focus)) dirty = true
  }
  if (moving || dirty) updateRoadOverlay()
  if (moving || dirty) updateMapLabels(now)
  if (moving || dirty || proofChanged || populationChanged || trainsChanged) {
    renderer.render(scene, camera)
  }
  if (moving || dirty)
    transitOverlay.draw(activeTransit, transitNetwork?.surfaceRail ?? [], camera, subwayVisible, metroVisible, viewHeight, focus)
  dirty = false
}
requestAnimationFrame(frame)

/** Iconic towers, Times Square and the shared ad atlas. A failure here leaves the raster city as it was. */
function buildLandmarkModels() {
  try {
    skyline = buildSkyline()
    skyline.far.visible = false
    skyline.near.visible = false
    scene.add(skyline.far, skyline.near)
    for (const tower of skyline.towers) if (tower.buildingId) towerByBuilding.set(tower.buildingId, tower)
  } catch (error) {
    skyline = null
    console.error('Landmark towers could not be built:', error)
  }
  try {
    timesSquare = buildTimesSquare()
    timesSquare.group.visible = false
    scene.add(timesSquare.group)
  } catch (error) {
    timesSquare = null
    console.error('Times Square could not be built:', error)
  }
  try {
    adAtlas = createAdAtlas()
  } catch (error) {
    adAtlas = null
    console.error('Ad art could not be drawn:', error)
  }
  modelCutouts = [...(skyline?.cutouts ?? []), ...(timesSquare?.cutouts ?? [])]
}

async function loadWorld() {
  try {
    const response = await fetch(`${assetBase}manifest.json`)
    if (!response.ok) throw new Error('New York Sim model manifest is unavailable')
    manifest = await response.json() as Manifest
    if (manifest.brooklynBridge) {
      brooklynModel = buildBrooklynBridge(manifest.brooklynBridge)
      brooklynModel.visible = false
      scene.add(brooklynModel)
      const [x, z] = manifest.brooklynBridge.towers[0]
      brooklynTile = key(Math.floor(x / manifest.tileBlocks), Math.floor(z / manifest.tileBlocks))
    }
    if (manifest.roadNetwork) {
      const roadResponse = await fetch(`${assetBase}${manifest.roadNetwork}`)
      if (roadResponse.ok) roadNetwork = await roadResponse.json() as RoadNetwork
    }
    if (manifest.sidewalkNetwork) {
      const sidewalkResponse = await fetch(`${assetBase}${manifest.sidewalkNetwork}`)
      if (sidewalkResponse.ok) {
        sidewalks = new SidewalkNetwork(await sidewalkResponse.json() as SidewalkData)
        npcPopulationFigures.setSidewalkNetwork(sidewalks)
      } else console.warn('Sidewalk network is unavailable:', sidewalkResponse.status)
    }
    try {
      const catalogResponse = await fetch(`${assetBase}place-catalog.json`)
      if (catalogResponse.ok) {
        placeCatalog = await catalogResponse.json() as PlaceCatalog
        for (const item of placeCatalog.places) mappedById.set(item.id, item)
        const occupancyResponse = await fetch(`${assetBase}npc-place-occupancy.json`)
        if (occupancyResponse.ok) {
          const occupancy = await occupancyResponse.json() as NpcOccupancy
          if (occupancy.summary.members === 100000) npcOccupancy = occupancy
        }
      }
    } catch (error) { console.warn('Mapped places are unavailable:', error) }
    if (roadNetwork?.zones.city?.roads.length) {
      flyoverModel = buildBridgeFlyovers(roadNetwork.zones.city.roads,
        manifest.bridgeRise ?? 5, manifest.tileBlocks, manifest.brooklynBridge)
      flyoverModel.visible = false
      scene.add(flyoverModel)
    }
    if (manifest.transitNetwork) {
      const transitResponse = await fetch(`${assetBase}${manifest.transitNetwork}`)
      if (transitResponse.ok) transitNetwork = await transitResponse.json() as TransitNetwork
      else console.warn('Transit network is unavailable:', transitResponse.status)
    }
    const stations = buildStationLandmarks()
    stationModel = stations.group
    grandCentralDetail = stations.grandCentralDetail
    stationModel.visible = false
    scene.add(stationModel)
    if (transitNetwork?.surfaceRail?.length) {
      elevatedRailModel = buildElevatedRail(transitNetwork.surfaceRail)
      elevatedRailModel.visible = false
      scene.add(elevatedRailModel)
    }
    if (transitNetwork?.zones.city) transitVehicles.configure(transitNetwork.zones.city, transitNetwork.surfaceRail ?? [])
    buildLandmarkModels()
    const requestedTransit = new URLSearchParams(location.search).get('transit')
    subwayVisible = requestedTransit === null || requestedTransit === 'subway' || requestedTransit === 'both'
    metroVisible = requestedTransit === null || requestedTransit === 'metro' || requestedTransit === 'both'
    updateTransitControls()
    zoneSwitch.innerHTML = manifest.zones.map((item) =>
      `<button type="button" data-zone="${item.id}" aria-pressed="false">${item.name}</button>`).join('')
    const stationPicker = document.createElement('select')
    stationPicker.className = 'nj-station-picker'
    stationPicker.setAttribute('aria-label', 'Jump to a major station')
    stationPicker.innerHTML = '<option value="">MAJOR STATIONS</option>' + STATION_LANDMARKS.map((item) =>
      `<option value="${item.id}">${item.name}</option>`).join('')
    stationPicker.value = new URLSearchParams(location.search).get('view') ?? ''
    stationPicker.addEventListener('change', () => {
      jumpToLandmark(stationPicker.value)
    })
    zoneSwitch.append(stationPicker)
    if (placeCatalog) {
      const placePicker = document.createElement('select')
      placePicker.className = 'nj-station-picker nj-place-picker'
      placePicker.setAttribute('aria-label', 'Show mapped New York places')
      const kinds = ['home', 'office', 'cafe', 'grocery', 'restaurant', 'retail', 'school', 'clinic', 'library', 'community']
      const kindNames: Record<string, string> = { home: 'HOMES', office: 'OFFICES', cafe: 'CAFES',
        grocery: 'GROCERIES', restaurant: 'RESTAURANTS', retail: 'RETAIL', school: 'SCHOOLS',
        clinic: 'CLINICS', library: 'LIBRARIES', community: 'COMMUNITY' }
      placePicker.innerHTML = '<option value="">MAP PLACES</option>' + kinds.map((kind) =>
        `<option value="${kind}">${kindNames[kind]}</option>`).join('')
      placePicker.addEventListener('change', () => {
        mappedKind = placePicker.value
        placeCard.hidden = true
        lastLabelUpdate = 0
        dirty = true
      })
      zoneSwitch.append(placePicker)
    }
    if (skyline?.towers.length) {
      const towerPicker = document.createElement('select')
      towerPicker.className = 'nj-station-picker nj-tower-picker'
      towerPicker.setAttribute('aria-label', 'Jump to an iconic tower or Times Square')
      const options = [TIMES_SQUARE, ...[...skyline.towers].sort((a, b) => a.name.localeCompare(b.name))]
      towerPicker.innerHTML = '<option value="">ICONIC TOWERS</option>'
      for (const item of options) {
        const option = document.createElement('option')
        option.value = item.id
        option.textContent = item.name
        towerPicker.append(option)
      }
      const requestedView = new URLSearchParams(location.search).get('view') ?? ''
      towerPicker.value = options.some((item) => item.id === requestedView) ? requestedView : ''
      towerPicker.addEventListener('change', () => jumpToLandmark(towerPicker.value))
      zoneSwitch.append(towerPicker)
    }
    zoneSwitch.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.addEventListener('click', () => {
        const next = manifest.zones.find((item) => item.id === button.dataset.zone)
        if (next) void activateZone(next)
      })
    })
    await activateZone(manifest.zones[0])
    if (new URLSearchParams(location.search).has('proof')) void npcProof.open()
    if (new URLSearchParams(location.search).get('transit') === 'metro'
      && !new URLSearchParams(location.search).has('view')
      && !new URLSearchParams(location.search).has('x')) focusMetroRouteIfOffscreen()
  } catch (error) {
    loading.textContent = 'THE CITY MODEL COULD NOT BE LOADED.'
    canvasStatus.innerHTML = '<i></i> MODEL OFFLINE'
    console.error(error)
  }
}
void loadWorld()
