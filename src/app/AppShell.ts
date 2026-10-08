import { ACESFilmicToneMapping, SRGBColorSpace, WebGLRenderer } from 'three'
import { projects } from '../data/projects.ts'
import { experience } from '../data/experience.ts'
import { SpaceSession } from '../space/SpaceSession.ts'
import { MediaPopup } from '../ui/MediaPopup.ts'
import { parseRoute, pathForPlanet, planetDefinitions } from '../worlds/registry.ts'
import { InputActions } from './InputActions.ts'
import { PlanetLoader, type LoadState } from './PlanetLoader.ts'
import { PortfolioView } from './PortfolioView.ts'
import type { PlanetDefinition, PlanetSession, ThemeMode } from './PlanetContracts.ts'

const THEME_KEY = 'system-zero-theme'
const HOME_TITLE = 'Bindo | Game Developer & Technical Artist | System Zero'
const SPACE_CANVAS_LABEL = 'Interactive dark space with a spaceship and nine portfolio planets. Use flight controls or the flight manifest to explore.'
const APPROACH_RADIUS = 180
const ENTER_RADIUS = 115
const WORLD_TAGS: Record<string, string> = {
  voxel: 'VOXEL / ECS',
  'npc-ecs': 'NPC SYSTEMS',
  'stretch-squash': 'ANIMATION',
  'drone-fleet': 'AI SIM',
  'event-horizon': 'PLAYABLE',
  warfront: 'MULTIPLAYER',
  bitboard: 'BITWISE MATH',
  'pixel-farm': 'SDL2 RENDERER',
  'material-forge': 'MAYA TOOL',
}
const WORLD_NOTES: Record<string, string> = {
  voxel: 'Destructible voxel gameplay systems.',
  'npc-ecs': 'ECS schedules and NPC behavior.',
  'stretch-squash': 'Procedural character animation.',
  'drone-fleet': 'VR drone flight and AI simulation.',
  'event-horizon': 'Launch swarms in a gravity lab.',
  warfront: 'Replicated multiplayer combat.',
  bitboard: 'Bitwise math in a C# training game.',
  'pixel-farm': 'Tile farming rendered with SDL2.',
  'material-forge': 'PBR texture linking for Maya.',
}

interface WorldRowUi {
  row: HTMLDivElement
  select: HTMLButtonElement
  expanded: HTMLDivElement
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag)
  item.className = className
  if (text !== undefined) item.textContent = text
  return item
}

function sourceLink(label: string, url: string): HTMLAnchorElement {
  const anchor = node('a', 'action-link', label)
  anchor.href = url
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  return anchor
}

function getTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch { /* Storage can be disabled. */ }
  return 'dark'
}

function homePath(): string {
  return import.meta.env.BASE_URL || '/'
}

/**
 * One renderer, one loop, and one UI layer for both flight and lazy planet landings.
 * The old arena code remains in source history, but is no longer mounted by main.ts.
 */
export class AppShell {
  private readonly stage = node('div', 'space-stage')
  private readonly canvas = document.createElement('canvas')
  private readonly ui = node('div', 'ui-layer shell-ui')
  private readonly flightUi = node('div', 'flight-ui')
  private readonly touchControls = node('div', 'touch-controls')
  private readonly atlas = node('aside', 'atlas-panel')
  private readonly atlasToggle = node('button', 'atlas-toggle', 'Destinations ▾')
  private readonly worldList = node('div', 'world-list')
  private readonly approach = node('aside', 'approach-card')
  private readonly approachName = node('h2', '', '')
  private readonly approachDistance = node('span', 'approach-distance')
  private readonly approachStatus = node('p', 'approach-status')
  private readonly enterButton = node('button', 'primary-button', 'Enter world')
  private readonly retryButton = node('button', 'secondary-button', 'Retry loading')
  private readonly flyPastButton = node('button', 'text-button', 'Continue flying')
  private readonly landing = node('article', 'landing-panel')
  private readonly worldOverlay = node('div', 'world-overlay')
  private readonly loading = node('div', 'loading-panel')
  private readonly fallback = node('div', 'no-webgl-fallback')
  private readonly themeButton = node('button', 'theme-button')
  private readonly themeChoice = node('span', 'theme-choice')
  private readonly worldMapButton = node('button', 'nav-button world-map-button is-active', 'World map')
  private readonly archiveButton = node('button', 'nav-button', 'Projects')
  private readonly experienceButton = node('button', 'nav-button', 'Experience')
  private readonly location = node('span', 'sector-readout', 'SECTOR 0 · 0 · 0')
  private readonly heading = node('span', 'heading-readout', 'NOSE 0 · 0 · -1')
  private readonly worldRows = new Map<string, WorldRowUi>()
  private selectedPlanet: PlanetDefinition = planetDefinitions[0]
  private readonly portfolio: PortfolioView
  private readonly input: InputActions
  private readonly media: MediaPopup
  private readonly loader: PlanetLoader
  private renderer: WebGLRenderer | null = null
  private space: SpaceSession | null = null
  private planetSession: PlanetSession | null = null
  private activePlanet: PlanetDefinition | null = null
  private loadingRoute: PlanetDefinition | null = null
  private approachPlanet: PlanetDefinition | null = null
  private approachDistanceValue = Infinity
  private dismissedApproach: string | null = null
  private theme: ThemeMode = getTheme()
  private routeGeneration = 0
  private frame = 0
  private lastTime = 0
  private disposed = false

  constructor(private readonly root: HTMLDivElement) {
    root.replaceChildren()
    this.stage.setAttribute('aria-label', 'Three dimensional portfolio game')
    this.fallback.hidden = true
    this.ui.append(this.buildHeader(), this.flightUi, this.approach, this.landing, this.worldOverlay, this.loading, this.fallback)
    root.append(this.stage, this.ui)
    this.buildFlightUi()
    this.buildApproach()
    this.buildLanding()
    this.buildLoading()
    this.worldOverlay.hidden = true
    this.input = new InputActions(this.canvas, this.touchControls)
    this.portfolio = new PortfolioView(
      this.ui,
      () => this.restoreContext(),
      content => this.openMedia(content),
      planet => void this.navigateToWorld(planet, true),
    )
    this.media = new MediaPopup(this.ui, this.input)
    this.loader = new PlanetLoader(state => this.onLoadState(state))
    this.applyTheme(this.theme, false)
    this.archiveButton.addEventListener('click', () => this.openPortfolio('projects'))
    this.experienceButton.addEventListener('click', () => this.openPortfolio('experience'))
    this.themeButton.addEventListener('click', this.toggleTheme)
    this.worldMapButton.addEventListener('click', this.showWorldMap)
    this.enterButton.addEventListener('click', () => void this.enterApproach())
    this.retryButton.addEventListener('click', () => void this.retryLoading())
    this.flyPastButton.addEventListener('click', this.flyPast)
    window.addEventListener('resize', this.onResize)
    window.addEventListener('popstate', this.onPopState)
  }

  start(): void {
    try {
      const context = this.canvas.getContext('webgl2', { antialias: true, alpha: false })
      if (!context) throw new Error('WebGL 2 is unavailable')
      this.renderer = new WebGLRenderer({ canvas: this.canvas, context, antialias: true })
      this.renderer.outputColorSpace = SRGBColorSpace
      this.renderer.toneMapping = ACESFilmicToneMapping
      this.renderer.toneMappingExposure = 1.28
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      this.canvas.setAttribute('role', 'img')
      this.canvas.setAttribute('aria-label', SPACE_CANVAS_LABEL)
      this.stage.append(this.canvas)
      this.space = new SpaceSession(planetDefinitions)
      this.onResize()
      this.frame = requestAnimationFrame(this.tick)
    } catch (error) {
      console.warn('The portfolio is running without WebGL.', error)
      this.renderer?.dispose()
      this.renderer = null
      this.showFallback()
    }
    this.routeFromLocation()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.frame)
    window.removeEventListener('resize', this.onResize)
    window.removeEventListener('popstate', this.onPopState)
    this.themeButton.removeEventListener('click', this.toggleTheme)
    this.worldMapButton.removeEventListener('click', this.showWorldMap)
    this.flyPastButton.removeEventListener('click', this.flyPast)
    this.loader.dispose()
    this.planetSession?.dispose()
    this.space?.dispose()
    this.media.dispose()
    this.portfolio.dispose()
    this.input.dispose()
    this.renderer?.dispose()
    this.root.replaceChildren()
  }

  private buildHeader(): HTMLElement {
    const header = node('header', 'site-header')
    const brand = node('a', 'brand')
    brand.href = homePath()
    const brandCopy = node('span', 'brand-copy')
    brandCopy.append(node('span', 'brand-name', 'SYSTEM ZERO'), node('span', 'brand-descriptor', 'BINDO / GAME DEVELOPMENT PORTFOLIO'))
    brand.append(node('span', 'brand-mark', 'S/0'), brandCopy)
    brand.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      this.exitToSpace(true)
    })
    const nav = node('nav', 'site-nav')
    nav.setAttribute('aria-label', 'Portfolio')
    this.worldMapButton.type = 'button'
    this.archiveButton.type = 'button'
    this.archiveButton.dataset.testid = 'portfolio-button'
    this.experienceButton.type = 'button'
    const contact = node('a', 'nav-contact', 'Contact ↗')
    contact.dataset.testid = 'contact-link'
    contact.href = 'https://github.com/Bindo56'
    contact.target = '_blank'
    contact.rel = 'noopener noreferrer'
    this.themeButton.type = 'button'
    this.themeButton.dataset.testid = 'theme-toggle'
    this.themeButton.append(node('span', 'theme-prefix', 'INTERFACE'), this.themeChoice)
    nav.append(this.worldMapButton, this.archiveButton, this.experienceButton, contact, this.themeButton)
    header.append(brand, nav)
    return header
  }

  private buildFlightUi(): void {
    const hero = node('section', 'flight-hero')
    const title = node('h1', 'hero-title')
    title.append('Game', node('br', ''), 'systems.', node('br', ''), node('em', 'hero-accent', 'In motion.'))
    hero.append(
      node('span', 'eyebrow', '001 / EXPLORATION LOG'),
      title,
      node('p', 'hero-description', 'Fly between nine worlds shaped by my work in gameplay, AI, simulation, rendering, and tools.'),
    )
    const solarPlanet = planetDefinitions.find(planet => planet.slug === 'event-horizon')
    if (solarPlanet) {
      const play = node('a', 'hero-play-link primary-button', 'Play Solar DOTS ↗')
      play.dataset.testid = 'solar-hero-play'
      play.href = pathForPlanet(solarPlanet)
      play.addEventListener('click', event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        void this.navigateToWorld(solarPlanet, true)
      })
      hero.append(play)
    }
    const orbitLabel = node('div', 'orbit-label')
    orbitLabel.append(node('span', 'status-dot'), node('span', '', 'SHIP READY'), node('span', 'orbit-count', '9 PROJECT WORLDS'))
    hero.append(orbitLabel)

    const atlasTitle = node('div', 'atlas-title')
    this.atlasToggle.type = 'button'
    this.atlasToggle.setAttribute('aria-expanded', 'false')
    this.atlasToggle.addEventListener('click', () => this.setAtlasCompact(!this.atlas.classList.contains('compact')))
    this.atlas.classList.add('compact')
    this.atlas.setAttribute('aria-label', 'Flight manifest')
    const atlasHeading = node('div', 'atlas-heading')
    atlasHeading.append(node('span', 'eyebrow', 'DESTINATION INDEX'), node('h2', '', 'Flight manifest'))
    atlasTitle.append(atlasHeading, node('span', 'atlas-count', '09 / 09'), this.atlasToggle)
    this.worldList.setAttribute('aria-label', 'Nine project worlds')
    const atlasFooter = node('div', 'atlas-footer')
    atlasFooter.append(node('span', '', 'SELECT A WORLD TO FLY'), node('span', '', '09 PROJECT WORLDS'))
    this.atlas.append(atlasTitle, this.worldList, atlasFooter)
    for (const [index, planet] of planetDefinitions.entries()) {
      const row = node('div', 'world-row')
      row.dataset.world = planet.slug
      const select = node('button', 'world-select')
      select.type = 'button'
      select.setAttribute('aria-label', 'Select ' + planet.title + ' in flight manifest')
      select.addEventListener('click', () => this.selectPlanet(planet))
      const glyph = node('span', 'world-glyph')
      glyph.style.setProperty('--planet-color', '#' + planet.color.toString(16).padStart(6, '0'))
      glyph.textContent = String(index + 1).padStart(2, '0')
      const name = node('span', 'world-row-name', planet.title)
      const kind = node('span', 'world-kind', WORLD_TAGS[planet.slug] ?? 'PROJECT WORLD')
      select.append(glyph, name, kind)
      const expanded = node('div', 'world-expanded')
      expanded.id = 'world-' + planet.slug + '-details'
      select.setAttribute('aria-controls', expanded.id)
      const summary = node('p', 'world-summary', WORLD_NOTES[planet.slug] ?? 'Explore the project behind this world.')
      const actions = node('div', 'world-actions')
      const fly = node('button', 'world-fly', 'Warp to orbit ↗')
      fly.type = 'button'
      fly.setAttribute('aria-label', 'Warp to orbit around ' + planet.title)
      fly.addEventListener('click', () => this.warpTo(planet))
      const link = node('a', 'world-direct', planet.slug === 'event-horizon' ? 'Play now ↗' : 'Project ↗')
      link.href = pathForPlanet(planet)
      link.setAttribute('aria-label', 'Open ' + planet.title + ' landing')
      link.addEventListener('click', event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        void this.navigateToWorld(planet, true)
      })
      actions.append(fly, link)
      expanded.append(summary, actions)
      row.append(select, expanded)
      this.worldRows.set(planet.slug, { row, select, expanded })
      this.worldList.append(row)
    }
    this.selectPlanet(this.selectedPlanet)

    const center = node('div', 'reticle')
    center.setAttribute('aria-hidden', 'true')
    center.append(node('span', 'reticle-line horizontal'), node('span', 'reticle-line vertical'), node('span', 'reticle-dot'))

    const hud = node('div', 'flight-hud')
    this.location.dataset.testid = 'ship-position'
    this.heading.dataset.testid = 'ship-heading'
    const status = node('div', 'flight-status')
    status.append(node('span', 'status-dot'), node('span', '', 'FREE FLIGHT'))
    const telemetry = node('div', 'flight-telemetry')
    telemetry.append(this.location, this.heading)
    const controls = node('div', 'flight-controls')
    for (const [key, label] of [['W/S', 'THRUST'], ['MOUSE', 'STEER'], ['Q/E', 'ROLL'], ['SPACE', 'BRAKE']]) {
      const item = node('span', 'flight-control')
      item.append(node('strong', '', key), document.createTextNode(' ' + label))
      controls.append(item)
    }
    hud.append(status, telemetry, controls)
    this.buildTouchControls()
    this.flightUi.append(hero, this.atlas, center, hud, this.touchControls)
  }

  private setAtlasCompact(compact: boolean): void {
    this.atlas.classList.toggle('compact', compact)
    this.atlasToggle.setAttribute('aria-expanded', String(!compact))
    this.atlasToggle.textContent = compact ? 'Destinations ▾' : 'Close chart ▴'
  }

  private selectPlanet(planet: PlanetDefinition): void {
    this.selectedPlanet = planet
    for (const [slug, { row, select, expanded }] of this.worldRows) {
      const selected = slug === planet.slug
      row.classList.toggle('selected', selected)
      select.setAttribute('aria-expanded', String(selected))
      expanded.hidden = !selected
    }
  }

  private readonly showWorldMap = (): void => {
    if (this.planetSession || this.loadingRoute) this.exitToSpace(true)
    if (this.portfolio.isOpen) this.portfolio.close()
    this.setAtlasCompact(false)
    this.worldRows.get(this.selectedPlanet.slug)?.select.focus()
  }

  private buildTouchControls(): void {
    const entries: readonly [string, string][] = [
      ['thrust', '▲ Thrust'], ['reverse', '▼ Reverse'], ['left', '◀ Strafe'], ['right', 'Strafe ▶'],
      ['up', 'Rise'], ['down', 'Descend'], ['yaw-left', 'Turn ◀'], ['yaw-right', 'Turn ▶'],
      ['pitch-up', 'Pitch ▲'], ['pitch-down', 'Pitch ▼'], ['roll-left', 'Roll ↶'],
      ['roll-right', 'Roll ↷'], ['boost', 'Boost'], ['brake', 'Brake'],
    ]
    this.touchControls.setAttribute('aria-label', 'Touch flight controls')
    for (const [action, label] of entries) {
      const button = node('button', 'touch-control', label)
      button.type = 'button'
      button.dataset.control = action
      this.touchControls.append(button)
    }
  }

  private buildApproach(): void {
    this.approach.setAttribute('aria-live', 'polite')
    this.approach.append(
      node('span', 'eyebrow', 'PLANET APPROACH'),
      this.approachName,
      this.approachDistance,
      this.approachStatus,
    )
    const actions = node('div', 'approach-actions')
    this.enterButton.type = 'button'
    this.enterButton.dataset.testid = 'enter-world'
    this.retryButton.type = 'button'
    this.flyPastButton.type = 'button'
    actions.append(this.enterButton, this.retryButton, this.flyPastButton)
    this.approach.append(actions)
    this.approach.hidden = true
  }

  private buildLanding(): void {
    this.landing.setAttribute('aria-live', 'polite')
    this.landing.hidden = true
  }

  private buildLoading(): void {
    this.loading.hidden = true
    this.loading.setAttribute('role', 'status')
  }

  private readonly tick = (time: number): void => {
    if (this.disposed || !this.renderer || !this.space) return
    this.frame = requestAnimationFrame(this.tick)
    const dt = this.lastTime ? Math.min((time - this.lastTime) / 1000, 0.05) : 0
    this.lastTime = time

    this.media.update()
    this.handleKeys()
    if (this.planetSession) {
      this.planetSession.update(dt)
      this.renderer.render(this.planetSession.scene, this.planetSession.camera)
    } else {
      const actions = this.input.getShipActions(dt)
      const planet = this.approachPlanet
      const inOrbit = planet && this.approachDistanceValue <= planet.radius + ENTER_RADIUS && this.dismissedApproach !== planet.slug
      // Ease to a stop in landing range while preserving full steering and
      // allowing any fresh thrust, strafe or lift input to fly away freely.
      if (inOrbit && !actions.thrust && !actions.strafe && !actions.lift && !actions.boost) actions.brake = true
      this.space.update(dt, actions)
      if (!this.loadingRoute) this.updateApproach()
      const position = this.space.getShipPosition()
      this.location.textContent = 'SECTOR ' + position.sector.join(' · ') + ' / ' + position.local.map(value => Math.round(value)).join(' · ')
      this.heading.textContent = 'NOSE ' + this.space.getShipForward().map(value => value.toFixed(2)).join(' · ')
      this.renderer.render(this.space.scene, this.space.camera)
    }
  }

  private handleKeys(): void {
    if (this.media.isOpen) return
    if (this.input.consume('KeyT')) this.toggleTheme()
    if (this.input.consume('Tab') || this.input.consume('KeyM')) {
      if (this.portfolio.isOpen) this.portfolio.close()
      else this.openPortfolio('projects')
    }
    if (this.input.consume('Escape')) {
      if (this.portfolio.isOpen) this.portfolio.close()
      else if (this.planetSession) this.exitToSpace(true)
    }
    if (this.planetSession && this.input.consume('Backspace')) this.exitToSpace(true)
    if (this.approachPlanet && this.input.consume('Enter')) void this.enterApproach()
  }

  private updateApproach(): void {
    if (!this.space || this.planetSession) return
    let nearest: PlanetDefinition | null = null
    let distance = Infinity
    for (const planet of planetDefinitions) {
      const candidate = this.space.distanceTo(planet)
      if (candidate < distance) { nearest = planet; distance = candidate }
    }
    if (!nearest || distance > nearest.radius + APPROACH_RADIUS) {
      this.approachPlanet = null
      this.approach.hidden = true
      this.flightUi.classList.remove('has-approach')
      this.space.hold(this.portfolio.isOpen || this.media.isOpen)
      if (this.loader.state.status !== 'idle') this.loader.clear()
      if (distance > (nearest?.radius ?? 0) + APPROACH_RADIUS) this.dismissedApproach = null
      return
    }

    this.approachPlanet = nearest
    this.approachDistanceValue = distance
    if (this.selectedPlanet.slug !== nearest.slug) this.selectPlanet(nearest)
    this.flightUi.classList.add('has-approach')
    if (this.loader.state.planet?.slug !== nearest.slug) void this.loader.prefetch(nearest)
    this.space.hold(this.portfolio.isOpen || this.media.isOpen)
    this.renderApproach()
  }

  private renderApproach(): void {
    const planet = this.approachPlanet
    if (!planet) return
    const state = this.loader.state
    const inOrbit = this.approachDistanceValue <= planet.radius + ENTER_RADIUS && this.dismissedApproach !== planet.slug
    this.approach.hidden = false
    this.approachName.textContent = planet.title
    this.approachDistance.textContent = Math.max(0, Math.round(this.approachDistanceValue - planet.radius)) + ' units to surface'
    this.approachStatus.textContent = state.status === 'ready'
      ? 'Ready to land'
      : state.status === 'error'
        ? 'Load failed. Retry or view the original project.'
        : 'Preparing world…'
    this.enterButton.hidden = !inOrbit
    this.enterButton.disabled = !inOrbit || state.status !== 'ready'
    this.enterButton.textContent = state.status === 'ready' ? 'Enter world ↗' : 'Preparing…'
    this.retryButton.hidden = state.status !== 'error'
    this.flyPastButton.hidden = !inOrbit
    let link = this.approach.querySelector<HTMLAnchorElement>('.approach-source')
    if (!link) {
      link = node('a', 'approach-source', 'View original project ↗')
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      this.approach.append(link)
    }
    const project = projects.find(item => item.key === planet.projectKey)
    link.hidden = !project?.github
    link.href = project?.github ?? '#'
  }

  private async enterApproach(): Promise<void> {
    if (!this.approachPlanet || this.loader.state.status !== 'ready') return
    if (this.approachDistanceValue > this.approachPlanet.radius + ENTER_RADIUS) return
    await this.navigateToWorld(this.approachPlanet, true)
  }

  private async retryLoading(): Promise<void> {
    if (this.loadingRoute) {
      await this.navigateToWorld(this.loadingRoute, false)
    } else {
      await this.loader.retry()
    }
  }

  private readonly flyPast = (): void => {
    if (!this.approachPlanet) return
    this.dismissedApproach = this.approachPlanet.slug
    this.space?.hold(false)
    this.renderApproach()
  }

  private warpTo(planet: PlanetDefinition): void {
    if (this.planetSession || this.loadingRoute) this.exitToSpace(true)
    this.selectPlanet(planet)
    this.setAtlasCompact(true)
    this.dismissedApproach = null
    this.loader.clear()
    this.space?.placeOutside(planet)
    this.space?.hold(false)
    this.updateApproach()
  }

  private async navigateToWorld(planet: PlanetDefinition, push: boolean): Promise<void> {
    if (push) history.pushState({ world: planet.slug }, '', pathForPlanet(planet))
    document.title = planet.title + ' | Saurabh Kundalwal'
    this.canvas.setAttribute('aria-label', planet.slug === 'event-horizon'
      ? 'Solar DOTS gravity simulation with five colored orbital paths and varied stones around a gold central attractor. Drag to orbit the camera and scroll to zoom.'
      : planet.title + ' project world')
    if (!this.renderer || !this.space) {
      this.showFallback(planet)
      return
    }
    if (this.activePlanet?.slug === planet.slug && this.planetSession) return

    const generation = ++this.routeGeneration
    this.planetSession?.dispose()
    this.planetSession = null
    this.worldOverlay.replaceChildren()
    this.worldOverlay.hidden = true
    this.activePlanet = null
    this.loadingRoute = planet
    this.approachPlanet = null
    this.approach.hidden = true
    this.flightUi.classList.remove('has-approach')
    this.landing.hidden = true
    this.flightUi.hidden = true
    this.worldMapButton.classList.remove('is-active')
    this.loading.hidden = false
    this.renderLoading('PREPARING LANDING', planet.title, 'Preparing world…')
    this.space.hold(true)
    this.input.setContext('dialog')
    await this.loader.prefetch(planet)
    if (generation !== this.routeGeneration || this.disposed) return

    const ready = this.loader.takeReady(planet)
    if (!ready) {
      this.renderLoading('LANDING UNAVAILABLE', planet.title, 'The world could not load. You can retry or view the original project.')
      return
    }
    try {
      this.planetSession = ready.module.mount(ready.prepared, {
        canvas: this.canvas,
        uiRoot: this.worldOverlay,
        onExit: () => this.exitToSpace(true),
        isInteractive: () => this.input.context === 'planet' && !this.portfolio.isOpen && !this.media.isOpen,
      })
      this.activePlanet = planet
      this.loadingRoute = null
      this.loading.hidden = true
      this.showLanding(planet)
      this.input.setContext('planet')
      this.onResize()
    } catch (error) {
      ready.prepared.dispose()
      this.worldOverlay.replaceChildren()
      this.worldOverlay.hidden = true
      console.error('Planet mount failed', error)
      this.renderLoading('LANDING UNAVAILABLE', planet.title, 'The world could not start. Return to space and try again.')
    }
  }

  private showLanding(planet: PlanetDefinition): void {
    if (planet.slug === 'event-horizon') {
      this.landing.hidden = true
      this.worldOverlay.hidden = false
      return
    }
    const project = projects.find(item => item.key === planet.projectKey)
    this.landing.replaceChildren()
    const eyebrow = node('span', 'eyebrow', 'WORLD  /  ' + planet.slug.toUpperCase())
    const title = node('h1', '', planet.title)
    title.dataset.testid = 'world-title'
    const state = node('span', 'development-label', 'World gameplay in development')
    const projectTitle = node('h2', '', project?.title ?? 'Project landing')
    const summary = node('p', 'landing-summary', project?.summary ?? 'Project details coming soon.')
    const tech = node('p', 'landing-tech', project?.tech.join('  /  ') ?? '')
    const links = node('div', 'landing-links')
    if (project?.github) links.append(sourceLink('Original source ↗', project.github))
    if (project?.video) {
      const demo = node('button', 'action-link', 'Watch original demo ↗')
      demo.type = 'button'
      demo.addEventListener('click', () => this.openMedia({
        title: project.title,
        subtitle: project.tech.join(' · '),
        body: [project.summary],
        video: project.video,
        links: project.github ? [{ label: 'Original source ↗', href: project.github }] : [],
        accent: project.color,
        hint: '[Esc] Close',
      }))
      links.append(demo)
    }
    if (!project?.github && !project?.video) {
      links.append(node('span', 'archive-pending', 'Original source and demo pending'))
    }
    const exit = node('button', 'primary-button exit-button', '← Return to space')
    exit.type = 'button'
    exit.dataset.testid = 'exit-world'
    exit.addEventListener('click', () => this.exitToSpace(true))
    this.landing.append(eyebrow, title, state, projectTitle, summary, tech, links, exit)
    this.landing.hidden = false
  }

  private renderLoading(kicker: string, name: string, message: string): void {
    this.loading.replaceChildren(node('span', 'eyebrow', kicker), node('h1', '', name), node('p', '', message))
    if (kicker === 'LANDING UNAVAILABLE') {
      const controls = node('div', 'loading-actions')
      const retry = node('button', 'primary-button', 'Retry')
      retry.type = 'button'
      retry.addEventListener('click', () => void this.retryLoading())
      const back = node('button', 'secondary-button', 'Return to space')
      back.type = 'button'
      back.addEventListener('click', () => this.exitToSpace(true))
      controls.append(retry, back)
      const project = projects.find(item => item.key === this.loadingRoute?.projectKey)
      if (project?.github) controls.append(sourceLink('Original source ↗', project.github))
      this.loading.append(controls)
    }
  }

  private exitToSpace(push: boolean): void {
    if (push) history.pushState({}, '', homePath())
    document.title = HOME_TITLE
    this.canvas.setAttribute('aria-label', SPACE_CANVAS_LABEL)
    this.routeGeneration++
    const previous = this.activePlanet ?? this.loadingRoute
    this.planetSession?.dispose()
    this.planetSession = null
    this.worldOverlay.replaceChildren()
    this.worldOverlay.hidden = true
    this.activePlanet = null
    this.loadingRoute = null
    this.loader.clear()
    if (previous) this.space?.placeOutside(previous)
    this.space?.hold(false)
    this.flightUi.hidden = !this.renderer
    this.worldMapButton.classList.add('is-active')
    this.landing.hidden = true
    this.loading.hidden = true
    this.restoreContext()
    if (this.renderer) this.updateApproach()
    else this.showFallback()
  }

  private routeFromLocation(): void {
    const route = parseRoute(window.location.pathname)
    if (route.kind === 'world') void this.navigateToWorld(route.planet, false)
    else this.exitToSpace(false)
  }

  private readonly onPopState = (): void => { this.routeFromLocation() }

  private openPortfolio(tab: 'projects' | 'experience'): void {
    if (this.media.isOpen) this.media.close()
    this.portfolio.open(tab)
    this.input.setContext('dialog')
    this.space?.hold(true)
  }

  private openMedia(content: Parameters<MediaPopup['open']>[0]): void {
    this.input.setContext('dialog')
    this.space?.hold(true)
    this.media.open(content, () => this.restoreContext())
  }

  private restoreContext(): void {
    this.input.setContext(this.portfolio.isOpen || this.loadingRoute ? 'dialog' : this.planetSession ? 'planet' : 'space')
    if (!this.portfolio.isOpen && !this.media.isOpen && !this.loadingRoute) this.space?.hold(false)
  }

  private onLoadState(_state: LoadState): void {
    if (this.approachPlanet) this.renderApproach()
  }

  private showFallback(planet?: PlanetDefinition): void {
    this.flightUi.hidden = true
    this.landing.hidden = true
    this.worldOverlay.hidden = true
    this.loading.hidden = true
    this.fallback.dataset.testid = 'no-webgl-fallback'
    this.fallback.hidden = false
    this.fallback.replaceChildren(
      node('span', 'eyebrow', 'PORTFOLIO · STATIC VIEW'),
      node('h1', '', planet ? planet.title : 'Game systems. In motion.'),
      node('p', '', 'The 3D view is unavailable here. Every project and career entry remains accessible below.'),
    )
    const grid = node('div', 'fallback-grid')
    for (const project of projects) {
      if (planet && project.key !== planet.projectKey) continue
      const card = node('article', 'fallback-card')
      card.append(node('h2', '', project.title), node('p', '', project.summary), node('p', 'fallback-tech', project.tech.join(' · ')))
      if (project.github) card.append(sourceLink('Original source ↗', project.github))
      if (project.video) card.append(sourceLink('Original demo ↗', project.video))
      if (!project.github && !project.video) card.append(node('span', 'archive-pending', 'Original source and demo pending'))
      grid.append(card)
    }
    if (planet) {
      const all = node('a', 'action-link', 'All projects')
      all.href = homePath()
      all.addEventListener('click', event => {
        event.preventDefault()
        this.exitToSpace(true)
      })
      this.fallback.append(all)
    }
    this.fallback.append(grid)
    const history = node('section', 'fallback-experience')
    history.append(node('h2', '', 'Experience'))
    for (const entry of experience) {
      history.append(node('p', '', entry.role + ' · ' + entry.company + ' · ' + entry.period))
    }
    this.fallback.append(history)
  }

  private applyTheme(theme: ThemeMode, persist: boolean): void {
    this.theme = theme
    document.documentElement.dataset.theme = theme
    this.themeChoice.textContent = theme === 'dark' ? ' / LIGHT' : ' / DARK'
    this.themeButton.setAttribute('aria-label', 'Switch interface to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode. The game stays dark.')
    this.themeButton.setAttribute('aria-pressed', String(theme === 'light'))
    if (persist) {
      try { window.localStorage.setItem(THEME_KEY, theme) } catch { /* Current view still changes. */ }
    }
  }

  private readonly toggleTheme = (): void => {
    this.applyTheme(this.theme === 'dark' ? 'light' : 'dark', true)
  }

  private readonly onResize = (): void => {
    if (!this.renderer) return
    const width = Math.max(1, window.innerWidth)
    const height = Math.max(1, window.innerHeight)
    this.renderer.setSize(width, height, false)
    if (this.space) {
      this.space.camera.aspect = width / height
      this.space.camera.updateProjectionMatrix()
    }
    const camera = this.planetSession?.camera
    if (camera && 'aspect' in camera && 'updateProjectionMatrix' in camera && typeof camera.updateProjectionMatrix === 'function') {
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
  }
}
