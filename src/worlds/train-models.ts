import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { buildVoxelTrain } from './voxelTrains'
import './train-models.css'

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <main class="train-page">
    <div class="train-stage" aria-label="Three-dimensional Minecraft-style subway and Metro-North train models"></div>
    <div class="train-ui">
      <header class="train-header">
        <a class="train-back" href="${import.meta.env.BASE_URL}worlds/ambient-npcs/">← AMBIENT NPCs</a>
        <span class="train-kicker">SYSTEM ZERO / MODEL STUDY 01</span>
      </header>
      <section class="train-intro">
        <span class="train-eyebrow">BLOCK-BUILT ROLLING STOCK</span>
        <h1>METRO <span>&</span> SUBWAY</h1>
        <p>The Minecraft-style train models now run on mapped routes in Ambient NPCs. Drag to orbit and scroll to inspect them here.</p>
      </section>
      <div class="train-footer">
        <div class="train-selector" role="group" aria-label="Focus on a train model">
          <button type="button" data-focus="both" aria-pressed="true">BOTH MODELS</button>
          <button type="button" data-focus="subway" aria-pressed="false"><i class="train-dot subway-dot"></i> SUBWAY</button>
          <button type="button" data-focus="metro" aria-pressed="false"><i class="train-dot metro-dot"></i> METRO-NORTH</button>
        </div>
        <div class="train-legend"><span><b>01</b> NYC SUBWAY · SILVER / BLUE</span><span><b>02</b> METRO-NORTH · WHITE / NAVY</span></div>
      </div>
    </div>
  </main>
`

const stage = app.querySelector<HTMLDivElement>('.train-stage')!
const scene = new THREE.Scene()
scene.background = new THREE.Color('#10252b')
scene.fog = new THREE.Fog('#10252b', 65, 135)
const camera = new THREE.PerspectiveCamera(47, 1, .1, 150)
camera.position.set(24, 14, 29)
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
stage.append(renderer.domElement)
renderer.domElement.setAttribute('aria-label', 'Orbitable view of two Minecraft-style train models')

const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 1.6, 0)
controls.enableDamping = true
controls.dampingFactor = .08
controls.minDistance = 8
controls.maxDistance = 95
controls.maxPolarAngle = Math.PI * .48
controls.update()

const materials = {
  plinth: new THREE.MeshBasicMaterial({ color: 0x223b42, fog: true }),
  ballast: new THREE.MeshBasicMaterial({ color: 0x2f4245, fog: true }),
  sleeper: new THREE.MeshBasicMaterial({ color: 0x665d4d, fog: true }),
  rail: new THREE.MeshBasicMaterial({ color: 0xabb9b7, fog: true }),
  stripe: new THREE.MeshBasicMaterial({ color: 0x3d6a72, fog: true }),
}
const cube = new THREE.BoxGeometry(1, 1, 1)
function box(parent: THREE.Group, material: THREE.Material, x: number, y: number, z: number,
  width: number, height: number, length: number) {
  const mesh = new THREE.Mesh(cube, material)
  mesh.position.set(x, y, z)
  mesh.scale.set(width, height, length)
  parent.add(mesh)
}
function displayTrack(x: number, length: number): THREE.Group {
  const track = new THREE.Group()
  box(track, materials.plinth, x, -.37, 0, 6.2, .55, length + 2)
  box(track, materials.ballast, x, -.02, 0, 4.5, .18, length + 1)
  for (let z = -length / 2; z <= length / 2; z += 1.28)
    box(track, materials.sleeper, x, .12, z, 3.6, .18, .35)
  for (const side of [-1, 1]) {
    box(track, materials.rail, x + side * 1.18, .31, 0, .16, .22, length)
    box(track, materials.stripe, x + side * 2.65, -.08, 0, .1, .08, length + 1)
  }
  return track
}

const subway = buildVoxelTrain('subway')
subway.position.x = -5.15
subway.position.y = .42
const metro = buildVoxelTrain('metro-north')
metro.position.x = 5.15
metro.position.y = .42
const subwayTrack = displayTrack(-5.15, 29)
const metroTrack = displayTrack(5.15, 33)
scene.add(subwayTrack, metroTrack, subway, metro)

function focusModel(which: string) {
  const x = which === 'subway' ? -5.15 : which === 'metro' ? 5.15 : 0
  subway.visible = subwayTrack.visible = which !== 'metro'
  metro.visible = metroTrack.visible = which !== 'subway'
  controls.target.set(x, 1.7, 0)
  const narrow = stage.clientWidth < 700
  if (narrow && which === 'both') camera.position.set(15, 25, 65)
  else if (narrow) camera.position.set(x + 7, 15, 46)
  else camera.position.set(x + (which === 'both' ? 24 : 13), which === 'both' ? 14 : 9, which === 'both' ? 29 : 19)
  controls.update()
  app.querySelectorAll<HTMLButtonElement>('[data-focus]').forEach((button) =>
    button.setAttribute('aria-pressed', String(button.dataset.focus === which)))
}
app.querySelectorAll<HTMLButtonElement>('[data-focus]').forEach((button) => {
  button.addEventListener('click', () => focusModel(button.dataset.focus!))
})

function resize() {
  const width = Math.max(1, stage.clientWidth)
  const height = Math.max(1, stage.clientHeight)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}
new ResizeObserver(resize).observe(stage)
resize()
if (stage.clientWidth < 700) focusModel('both')

function frame() {
  requestAnimationFrame(frame)
  controls.update()
  renderer.render(scene, camera)
}
frame()
