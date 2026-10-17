import * as THREE from 'three'
import type { PlanetDefinition, PlanetHost, PlanetModule, PlanetSession, PreparedPlanet } from '../app/PlanetContracts.ts'
import { createJungle, type JungleProp } from './elasticJungle.ts'
import './stretch-squash.css'

type Spring = { prop: JungleProp; stretch: number; velocity: number; target: number }
type Ripple = { mesh: THREE.Mesh; age: number }
type QueuedBounce = { spring: Spring; delay: number; strength: number }

const DEMO_URL = 'https://www.youtube.com/watch?v=hHAPJ1ke2lo'
const SOURCE_URL = 'https://github.com/Bindo56/Stretch_And_Squash_Tool'

class ElasticJungle {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.OrthographicCamera(-12, 12, 8, -8, 0.1, 100)

  private readonly props: JungleProp[]
  private readonly land: JungleProp
  private readonly springs: Spring[]
  private readonly springByRoot: Map<THREE.Group, Spring>
  private readonly pickables: THREE.Object3D[]
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private readonly hitPoint = new THREE.Vector3()
  private readonly worldPoint = new THREE.Vector3()
  private readonly rippleGeometry = new THREE.RingGeometry(0.9, 1, 64)
  private readonly ripples: Ripple[] = []
  private readonly waveQueue: QueuedBounce[] = []
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  private canvas: HTMLCanvasElement | null = null
  private isInteractive: () => boolean = () => false
  private active: Spring | null = null
  private pointerStartY = 0
  private pointerMoved = false
  private gesturePointerId: number | null = null
  private openingDelay = 0.7
  private disposed = false

  constructor() {
    this.scene.background = new THREE.Color('#102a2b')
    this.scene.fog = new THREE.Fog('#102a2b', 20, 40)
    this.scene.add(new THREE.HemisphereLight(0xc2f7df, 0x17343d, 0.8))

    const sunlight = new THREE.DirectionalLight(0xffe6ab, 2)
    sunlight.position.set(-5, 11, 7)
    sunlight.castShadow = true
    sunlight.shadow.mapSize.set(2048, 2048)
    sunlight.shadow.camera.left = -12
    sunlight.shadow.camera.right = 12
    sunlight.shadow.camera.top = 12
    sunlight.shadow.camera.bottom = -12
    sunlight.shadow.bias = -0.00025
    this.scene.add(sunlight)
    const edgeLight = new THREE.PointLight(0x81ffd2, 3.5, 18)
    edgeLight.position.set(5, 5, -5)
    this.scene.add(edgeLight)

    this.props = createJungle(this.scene)
    const land = this.props.find(prop => prop.kind === 'land')
    if (!land) throw new Error('The elastic jungle needs a land model.')
    this.land = land

    // Trees and stones ride the island; lilies ride the pond while remaining individually elastic.
    this.scene.updateMatrixWorld(true)
    for (const prop of this.props) {
      if (prop !== land) land.root.attach(prop.root)
    }
    const pond = this.props.find(prop => prop.kind === 'pond')
    if (pond) {
      for (const prop of this.props) {
        if (prop.kind === 'lily') pond.root.attach(prop.root)
      }
    }

    this.springs = this.props.map(prop => ({ prop, stretch: 1, velocity: 0, target: 1 }))
    this.springByRoot = new Map<THREE.Group, Spring>(
      this.props.map((prop, index): [THREE.Group, Spring] => [prop.root, this.springs[index]]),
    )
    const pickableSet = new Set<THREE.Object3D>()
    for (const prop of this.props) {
      prop.root.traverse(object => {
        if (object instanceof THREE.Mesh) pickableSet.add(object)
      })
    }
    this.pickables = [...pickableSet]
    this.resize()
  }

  mount(host: PlanetHost): void {
    this.canvas = host.canvas
    this.isInteractive = host.isInteractive
    host.canvas.addEventListener('pointerdown', this.onPointerDown)
    host.canvas.addEventListener('pointermove', this.onPointerMove)
    host.canvas.addEventListener('pointerup', this.onPointerUp)
    host.canvas.addEventListener('pointercancel', this.onPointerUp)
    window.addEventListener('resize', this.resize)
    this.resize()
  }

  bounceAll(): void {
    this.sendWave(new THREE.Vector3(0, 0, 0), 1.3)
  }

  update(delta: number): void {
    const dt = Math.min(Math.max(delta, 0), 0.05)
    if (!this.reducedMotion && this.openingDelay > 0) {
      this.openingDelay -= dt
      if (this.openingDelay <= 0) this.sendWave(new THREE.Vector3(0, 0, 0), 0.6)
    }

    for (const spring of this.springs) {
      const stiffness = spring.prop.kind === 'land' ? 38 : 28 + spring.prop.weight * 4
      const damping = spring.prop.kind === 'land' ? 6.8 : 5.4 + spring.prop.weight * 0.5
      spring.velocity += ((spring.target - spring.stretch) * stiffness - spring.velocity * damping) * dt
      spring.stretch = THREE.MathUtils.clamp(spring.stretch + spring.velocity * dt, 0.5, 1.9)
      if (Math.abs(spring.stretch - 1) < 0.0005 && Math.abs(spring.velocity) < 0.005 && spring.target === 1) {
        spring.stretch = 1
        spring.velocity = 0
      }
      const width = 1 / Math.sqrt(spring.stretch)
      spring.prop.root.scale.set(width, spring.stretch, width)
    }

    for (let index = this.waveQueue.length - 1; index >= 0; index--) {
      const wave = this.waveQueue[index]
      wave.delay -= dt
      if (wave.delay <= 0) {
        this.bounce(wave.spring, wave.strength)
        this.waveQueue.splice(index, 1)
      }
    }

    for (let index = this.ripples.length - 1; index >= 0; index--) {
      const ripple = this.ripples[index]
      ripple.age += dt
      const progress = ripple.age / (this.reducedMotion ? 0.45 : 0.9)
      ripple.mesh.scale.setScalar(0.12 + progress * 8)
      ;(ripple.mesh.material as THREE.MeshBasicMaterial).opacity = 0.75 * Math.max(0, 1 - progress)
      if (progress >= 1) {
        this.scene.remove(ripple.mesh)
        ;(ripple.mesh.material as THREE.Material).dispose()
        this.ripples.splice(index, 1)
      }
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const canvas = this.canvas
    if (canvas) {
      canvas.removeEventListener('pointerdown', this.onPointerDown)
      canvas.removeEventListener('pointermove', this.onPointerMove)
      canvas.removeEventListener('pointerup', this.onPointerUp)
      canvas.removeEventListener('pointercancel', this.onPointerUp)
      canvas.style.cursor = ''
    }
    window.removeEventListener('resize', this.resize)
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    this.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      geometries.add(object.geometry)
      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of meshMaterials) materials.add(material)
    })
    geometries.add(this.rippleGeometry)
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
    this.scene.clear()
    this.ripples.length = 0
    this.waveQueue.length = 0
    this.canvas = null
  }

  private readonly resize = (): void => {
    const width = Math.max(1, window.innerWidth)
    const height = Math.max(1, window.innerHeight)
    const aspect = width / height
    const viewHeight = width < 700 ? Math.max(17, 15.8 / aspect) : width < 1100 ? 17 : 15.5
    const viewWidth = viewHeight * aspect
    this.camera.left = -viewWidth / 2
    this.camera.right = viewWidth / 2
    this.camera.top = viewHeight / 2
    this.camera.bottom = -viewHeight / 2
    const shift = width >= 1100 ? 1.3 : 0
    this.camera.position.set(12 - shift, 14, 12 + shift)
    this.camera.lookAt(-shift, 1.1, shift)
    this.camera.updateProjectionMatrix()
  }

  private pointFromEvent(event: PointerEvent): void {
    const rect = this.canvas!.getBoundingClientRect()
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
  }

  private pick(event: PointerEvent): { spring: Spring; point: THREE.Vector3 } | null {
    this.pointFromEvent(event)
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0]
    if (!hit) return null
    let object: THREE.Object3D | null = hit.object
    while (object) {
      const spring = this.springByRoot.get(object as THREE.Group)
      if (spring) return { spring, point: hit.point.clone() }
      object = object.parent
    }
    return null
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.isInteractive() || event.button !== 0) return
    const selection = this.pick(event)
    if (!selection) return
    this.active = selection.spring
    this.hitPoint.copy(selection.point)
    this.pointerStartY = event.clientY
    this.pointerMoved = false
    this.gesturePointerId = event.pointerId
    this.canvas!.setPointerCapture(event.pointerId)
    this.canvas!.style.cursor = 'grabbing'
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.canvas || !this.isInteractive()) return
    if (!this.active || this.gesturePointerId !== event.pointerId) {
      this.canvas.style.cursor = this.pick(event) ? 'grab' : ''
      return
    }
    const distance = this.pointerStartY - event.clientY
    if (Math.abs(distance) > 5) this.pointerMoved = true
    const range = this.active.prop.kind === 'land' ? 0.3 : 0.8
    this.active.target = THREE.MathUtils.clamp(1 + distance / 165, 1 - range, 1 + range)
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    const active = this.active
    if (!active || this.gesturePointerId !== event.pointerId) return
    active.target = 1
    if (this.pointerMoved) active.velocity += (active.stretch - 1) * 0.9
    else if (active.prop.kind === 'land') this.sendWave(this.hitPoint)
    else {
      this.bounce(active)
      this.sendWave(this.hitPoint, 0.45)
    }
    this.active = null
    this.gesturePointerId = null
    if (this.canvas) this.canvas.style.cursor = ''
  }

  private addRipple(point: THREE.Vector3): void {
    const material = new THREE.MeshBasicMaterial({ color: 0xc7ff91, side: THREE.DoubleSide, transparent: true, opacity: 0.75, depthWrite: false })
    const mesh = new THREE.Mesh(this.rippleGeometry, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(point.x, 0.1, point.z)
    mesh.scale.setScalar(0.12)
    this.scene.add(mesh)
    this.ripples.push({ mesh, age: 0 })
  }

  private sendWave(origin: THREE.Vector3, strength = 1): void {
    this.addRipple(origin)
    for (const spring of this.springs) {
      if (spring.prop.kind === 'land') continue
      spring.prop.root.getWorldPosition(this.worldPoint)
      const distance = Math.hypot(this.worldPoint.x - origin.x, this.worldPoint.z - origin.z)
      this.waveQueue.push({ spring, delay: distance * 0.075, strength: strength * Math.max(0.25, 1 - distance / 17) })
    }
    this.springByRoot.get(this.land.root)!.velocity += 1.3 * strength
  }

  private bounce(spring: Spring, strength = 1): void {
    spring.velocity += (spring.prop.kind === 'land' ? 1.25 : 3.3 / spring.prop.weight) * strength
  }
}

interface PreparedJungle extends PreparedPlanet { visual: ElasticJungle }

const module: PlanetModule = {
  async prepare(_definition: PlanetDefinition, signal: AbortSignal): Promise<PreparedPlanet> {
    if (signal.aborted) throw new DOMException('Jungle preparation cancelled', 'AbortError')
    const visual = new ElasticJungle()
    let disposed = false
    const prepared: PreparedJungle = {
      scene: visual.scene,
      camera: visual.camera,
      visual,
      dispose() {
        if (disposed) return
        disposed = true
        visual.dispose()
      },
    }
    if (signal.aborted) {
      prepared.dispose()
      throw new DOMException('Jungle preparation cancelled', 'AbortError')
    }
    return prepared
  },

  mount(prepared: PreparedPlanet, host: PlanetHost): PlanetSession {
    const jungle = prepared as PreparedJungle
    const root = document.createElement('div')
    root.className = 'elastic-world'
    root.setAttribute('aria-label', 'The Elastic Jungle interactive world')
    root.innerHTML = `
      <div class="world-ui">
        <header class="topbar">
          <a class="brand" href="/" data-exit aria-label="Return to System Zero">← <span>SYSTEM ZERO</span></a>
          <span class="world-index">WORLD 07 <i></i> THE ELASTIC JUNGLE</span>
          <div class="top-links"><a href="${DEMO_URL}" target="_blank" rel="noopener noreferrer">WATCH DEMO ↗</a><a href="${SOURCE_URL}" target="_blank" rel="noopener noreferrer">SOURCE ↗</a></div>
        </header>
        <main>
          <section class="hero" aria-labelledby="elastic-title">
            <span class="eyebrow"><i></i> A WORLD WITH GIVE</span>
            <h1 id="elastic-title">THE<br><em>ELASTIC</em><br>JUNGLE<span>.</span></h1>
            <p>Nothing here stays still. Pull a tree, press a stone, or tap the land. Every part of this jungle stretches, squashes, and bounces back into place.</p>
            <div class="hero-rule"><span>UNITY STRETCH & SQUASH RIG / REIMAGINED AS A WORLD</span></div>
          </section>
          <div class="interaction-hint"><span class="hint-mark">✳</span><strong>DRAG ANYTHING</strong><span>TO STRETCH OR SQUASH</span></div>
          <section class="legend" aria-label="How to interact">
            <div><span class="legend-number">01</span><span><strong>DRAG</strong><small>Stretch any object</small></span></div>
            <div><span class="legend-number">02</span><span><strong>RELEASE</strong><small>Watch it spring back</small></span></div>
            <div><span class="legend-number">03</span><span><strong>TAP THE LAND</strong><small>Send a bounce wave</small></span></div>
          </section>
          <button class="bounce-button" type="button" aria-label="Bounce the whole jungle"><span>✳</span> BOUNCE THE JUNGLE</button>
        </main>
        <footer class="bottom-bar"><span class="mode-status"><i></i> FIXED ORTHOGRAPHIC CAMERA / 3D JUNGLE</span><a class="source-link" href="${SOURCE_URL}" target="_blank" rel="noopener noreferrer">EXPLORE THE ORIGINAL UNITY TOOL <span>↗</span></a></footer>
      </div>
    `
    const exit = root.querySelector<HTMLAnchorElement>('[data-exit]')!
    exit.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      host.onExit()
    })
    root.querySelector<HTMLButtonElement>('.bounce-button')!.addEventListener('click', () => {
      if (host.isInteractive()) jungle.visual.bounceAll()
    })
    host.uiRoot.replaceChildren(root)
    jungle.visual.mount(host)

    return {
      scene: jungle.scene,
      camera: jungle.camera,
      update(dt: number) { jungle.visual.update(dt) },
      dispose() {
        root.remove()
        jungle.dispose()
      },
    }
  },
}

export default module
