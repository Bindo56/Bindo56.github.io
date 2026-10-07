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
const APPROACH_RADIUS = 180
const ENTER_RADIUS = 115

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
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
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
  private readonly loading = node('div', 'loading-panel')
  private readonly fallback = node('div', 'no-webgl-fallback')
  private readonly themeButton = node('button', 'theme-button')
  private readonly archiveButton = node('button', 'nav-button', 'Projects')
  private readonly experienceButton = node('button', 'nav-button', 'Experience')
  private readonly location = node('span', 'sector-readout', 'SECTOR 0 · 0 · 0')
  private readonly heading = node('span', 'heading-readout', 'NOSE 0 · 0 · -1')
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
    this.ui.append(this.buildHeader(), this.flightUi, this.approach, this.landing, this.loading, this.fallback)
    root.append(this.stage, this.ui)
    this.buildFlightUi()
    this.buildApproach()
    this.buildLanding()
    this.buildLoading()
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
      this.stage.append(this.canvas)
      this.space = new SpaceSession(planetDefinitions, this.theme)
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
    brand.append(node('span', 'brand-mark', 'S/0'), node('span', 'brand-name', 'SYSTEM ZERO'))
    brand.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      this.exitToSpace(true)
    })
    const nav = node('nav', 'site-nav')
    nav.setAttribute('aria-label', 'Portfolio')
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
    nav.append(this.archiveButton, this.experienceButton, contact, this.themeButton)
    header.append(brand, nav)
    return header
  }

  private buildFlightUi(): void {
    const hero = node('section', 'flight-hero')
    hero.append(
      node('span', 'eyebrow', 'AN INTERACTIVE GAME DEVELOPMENT PORTFOLIO'),
      node('h1', '', 'Explore the work.'),
      node('p', '', 'Pilot a small ship across nine worlds inspired by my game systems, tools, and simulations. Each landing connects to the original project.'),
    )
    const orbitLabel = node('div', 'orbit-label')
    orbitLabel.append(node('span', 'status-dot'), node('span', '', 'OPEN SPACE · NINE WORLDS'))
    hero.append(orbitLabel)

    const atlasTitle = node('div', 'atlas-title')
    this.atlasToggle.type = 'button'
    this.atlasToggle.setAttribute('aria-expanded', 'false')
    this.atlasToggle.addEventListener('click', () => {
      const compact = this.atlas.classList.toggle('compact')
      this.atlasToggle.setAttribute('aria-expanded', String(!compact))
      this.atlasToggle.textContent = compact ? 'Destinations ▾' : 'Close chart ▴'
    })
    this.atlas.classList.add('compact')
    atlasTitle.append(node('span', 'eyebrow', 'STAR CHART'), node('h2', '', 'Choose a destination'), this.atlasToggle)
    this.atlas.append(atlasTitle, this.worldList)
    for (const [index, planet] of planetDefinitions.entries()) {
      const row = node('div', 'world-row')
      const glyph = node('span', 'world-glyph')
      glyph.style.setProperty('--planet-color', '#' + planet.color.toString(16).padStart(6, '0'))
      glyph.textContent = String(index + 1).padStart(2, '0')
      const name = node('span', 'world-row-name', planet.title)
      const fly = node('button', 'world-fly', 'Fly')
      fly.type = 'button'
      fly.setAttribute('aria-label', 'Warp to orbit around ' + planet.title)
      fly.addEventListener('click', () => this.warpTo(planet))
      const link = node('a', 'world-direct', 'Open ↗')
      link.href = pathForPlanet(planet)
      link.setAttribute('aria-label', 'Open ' + planet.title + ' landing')
      link.addEventListener('click', event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        void this.navigateToWorld(planet, true)
      })
      row.append(glyph, name, fly, link)
      this.worldList.append(row)
    }

    const center = node('div', 'reticle')
    center.setAttribute('aria-hidden', 'true')
    center.append(node('span', 'reticle-line horizontal'), node('span', 'reticle-line vertical'), node('span', 'reticle-dot'))

    const hud = node('div', 'flight-hud')
    this.location.dataset.testid = 'ship-position'
    this.heading.dataset.testid = 'ship-heading'
    const telemetry = node('div', 'flight-telemetry')
    telemetry.append(this.location, this.heading)
    const controls = node('p', 'flight-controls', 'W/S thrust · A/D strafe · R/F lift · Move mouse/Arrows steer · Q/E roll · Shift boost · Space brake · Click view for pointer lock')
    hud.append(telemetry, controls)
    this.buildTouchControls()
    this.flightUi.append(hero, this.atlas, center, hud, this.touchControls)
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
      this.space.hold(this.portfolio.isOpen || this.media.isOpen)
      if (this.loader.state.status !== 'idle') this.loader.clear()
      if (distance > (nearest?.radius ?? 0) + APPROACH_RADIUS) this.dismissedApproach = null
      return
    }

    this.approachPlanet = nearest
    this.approachDistanceValue = distance
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
    this.dismissedApproach = null
    this.loader.clear()
    this.space?.placeOutside(planet)
    this.space?.hold(false)
    this.updateApproach()
  }

  private async navigateToWorld(planet: PlanetDefinition, push: boolean): Promise<void> {
    if (push) history.pushState({ world: planet.slug }, '', pathForPlanet(planet))
    if (!this.renderer || !this.space) {
      this.showFallback(planet)
      return
    }
    if (this.activePlanet?.slug === planet.slug && this.planetSession) return

    const generation = ++this.routeGeneration
    this.planetSession?.dispose()
    this.planetSession = null
    this.activePlanet = null
    this.loadingRoute = planet
    this.approachPlanet = null
    this.approach.hidden = true
    this.landing.hidden = true
    this.flightUi.hidden = true
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
      this.planetSession = ready.module.mount(ready.prepared)
      this.planetSession.setTheme(this.theme)
      this.activePlanet = planet
      this.loadingRoute = null
      this.loading.hidden = true
      this.showLanding(planet)
      this.input.setContext('planet')
      this.onResize()
    } catch (error) {
      ready.prepared.dispose()
      console.error('Planet mount failed', error)
      this.renderLoading('LANDING UNAVAILABLE', planet.title, 'The world could not start. Return to space and try again.')
    }
  }

  private showLanding(planet: PlanetDefinition): void {
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
    this.routeGeneration++
    const previous = this.activePlanet ?? this.loadingRoute
    this.planetSession?.dispose()
    this.planetSession = null
    this.activePlanet = null
    this.loadingRoute = null
    this.loader.clear()
    if (previous) this.space?.placeOutside(previous)
    this.space?.hold(false)
    this.flightUi.hidden = !this.renderer
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
    this.loading.hidden = true
    this.fallback.dataset.testid = 'no-webgl-fallback'
    this.fallback.hidden = false
    this.fallback.replaceChildren(
      node('span', 'eyebrow', 'PORTFOLIO · STATIC VIEW'),
      node('h1', '', planet ? planet.title : 'Explore the work.'),
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
    this.themeButton.textContent = theme === 'dark' ? '☀ Light' : '☾ Dark'
    this.themeButton.setAttribute('aria-label', 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode')
    this.themeButton.setAttribute('aria-pressed', String(theme === 'light'))
    this.space?.setTheme(theme)
    this.planetSession?.setTheme(theme)
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
