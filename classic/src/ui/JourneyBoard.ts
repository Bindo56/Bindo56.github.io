export type JourneyRoute = 'projects' | 'career' | 'arena'

interface JourneyProgress {
  projects: number
  totalProjects: number
  career: number
  totalCareer: number
  sentinels: number
  totalSentinels: number
  waves: number
  totalWaves: number
}

interface JourneyHandlers {
  onRoute: (route: JourneyRoute) => void
  onPortfolio: () => void
}

const SEEN_KEY = 'system-zero-guide-seen'
let seenThisSession = false
let nextGuideId = 0

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function count(value: number, total: number): { value: number; total: number } {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(safeTotal, Math.floor(value))) : 0
  return { value: safeValue, total: safeTotal }
}

/** A first-visit route selector that can be reopened from the always-visible Guide button. */
export class JourneyBoard {
  private readonly overlay: HTMLDivElement
  private readonly panel: HTMLDivElement
  private readonly guideButton: HTMLButtonElement
  private readonly gameCanvas: HTMLCanvasElement | null
  private readonly routeCounts: Record<JourneyRoute, HTMLSpanElement>
  private readonly statCounts: Record<'projects' | 'career' | 'sentinels' | 'waves', HTMLSpanElement>
  private previousFocus: HTMLElement | null = null

  constructor(parent: HTMLElement, handlers: JourneyHandlers) {
    const id = ++nextGuideId
    this.gameCanvas = parent.parentElement?.querySelector('canvas') ?? null
    if (this.gameCanvas && !this.gameCanvas.hasAttribute('tabindex')) this.gameCanvas.tabIndex = -1

    this.guideButton = el('button', 'journey-guide-button', 'Guide')
    this.guideButton.type = 'button'
    this.guideButton.setAttribute('aria-label', 'Open visitor guide')
    this.guideButton.addEventListener('click', () => this.open())
    // Game input listens on window; focused guide controls should keep their native keyboard behavior.
    this.guideButton.addEventListener('keydown', (event) => event.stopPropagation())

    this.overlay = el('div', 'journey-overlay')
    this.overlay.hidden = true
    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) this.close()
    })
    this.overlay.addEventListener('keydown', this.onKeyDown)

    this.panel = el('div', 'journey-panel')
    this.panel.setAttribute('role', 'dialog')
    this.panel.setAttribute('aria-modal', 'true')
    this.panel.setAttribute('aria-labelledby', `journey-title-${id}`)
    this.panel.setAttribute('aria-describedby', `journey-intro-${id}`)
    this.panel.tabIndex = -1

    const header = el('header', 'journey-header')
    const headingGroup = el('div', 'journey-heading-group')
    headingGroup.append(el('p', 'journey-eyebrow', 'SYSTEM ZERO  /  VISITOR GUIDE'))
    const title = el('h1', 'journey-title', 'Choose where to begin.')
    title.id = `journey-title-${id}`
    const intro = el('p', 'journey-intro', 'Walk through the work, ride through the career, or test your aim. Start anywhere.')
    intro.id = `journey-intro-${id}`
    headingGroup.append(title, intro)

    const closeButton = el('button', 'journey-close', '×')
    closeButton.type = 'button'
    closeButton.setAttribute('aria-label', 'Close visitor guide')
    closeButton.addEventListener('click', () => this.close())
    header.append(headingGroup, closeButton)

    const routes = el('section', 'journey-routes')
    routes.setAttribute('aria-label', 'Choose a route')
    const projectCard = this.createRouteCard(
      'projects', '01 / DISCOVER', 'Project lab',
      'Browse the builds in the Control Center hologram carousel. Open any project for its details and media.',
      'Explore projects', handlers.onRoute,
    )
    const careerCard = this.createRouteCard(
      'career', '02 / TRACE', 'Career slide',
      'Take the slide through the roles and teams behind the work.',
      'Ride the career slide', handlers.onRoute,
    )
    const arenaCard = this.createRouteCard(
      'arena', '03 / PLAY', 'Swarm arena',
      'Jump straight into the arena and take on the swarm waves.',
      'Enter the arena', handlers.onRoute,
    )
    routes.append(projectCard.card, careerCard.card, arenaCard.card)
    this.routeCounts = {
      projects: projectCard.progress,
      career: careerCard.progress,
      arena: arenaCard.progress,
    }

    const controls = el('section', 'journey-controls')
    const controlsTitle = el('h2', undefined, 'While exploring')
    const controlList = el('ul', 'journey-controls-list')
    for (const [key, action] of [
      ['WASD / arrows', 'Move'],
      ['E', 'Interact'],
      ['Space', 'Pulse'],
      ['M', 'Portfolio'],
      ['H', 'Guide'],
      ['T', 'Theme'],
    ]) {
      const item = el('li')
      item.append(el('kbd', undefined, key), el('span', undefined, action))
      controlList.append(item)
    }
    controls.append(controlsTitle, controlList)

    const trail = el('section', 'journey-trail')
    const trailHeader = el('div', 'journey-trail-header')
    trailHeader.append(el('h2', undefined, 'Your trail'), el('p', undefined, 'Return anytime and pick another path.'))
    const stats = el('div', 'journey-stats')
    const projectStat = this.createStat('Projects inspected')
    const careerStat = this.createStat('Career stops')
    const sentinelStat = this.createStat('Sentinels disabled')
    const waveStat = this.createStat('Waves cleared')
    stats.append(projectStat.root, careerStat.root, sentinelStat.root, waveStat.root)
    this.statCounts = {
      projects: projectStat.value,
      career: careerStat.value,
      sentinels: sentinelStat.value,
      waves: waveStat.value,
    }
    trail.append(trailHeader, stats)

    const footer = el('footer', 'journey-footer')
    const footerCopy = el('p', undefined, 'Want the whole story now? Open the full portfolio from here or with M in the world.')
    const footerActions = el('div', 'journey-footer-actions')
    const portfolioButton = el('button', 'journey-portfolio-button', 'View full portfolio')
    portfolioButton.type = 'button'
    portfolioButton.addEventListener('click', () => {
      this.close()
      handlers.onPortfolio()
    })
    const exploreButton = el('button', 'journey-explore-button', 'Explore the world')
    exploreButton.type = 'button'
    exploreButton.addEventListener('click', () => this.close())
    footerActions.append(portfolioButton, exploreButton)
    footer.append(footerCopy, footerActions)

    this.panel.append(header, routes, controls, trail, footer)
    this.overlay.append(this.panel)
    parent.append(this.guideButton, this.overlay)

    if (this.isFirstVisit()) this.open()
  }

  get isOpen(): boolean {
    return !this.overlay.hidden
  }

  open(): void {
    if (this.isOpen) return
    const active = document.activeElement
    this.previousFocus = active instanceof HTMLElement && active !== document.body ? active : this.guideButton
    this.guideButton.hidden = true
    this.overlay.hidden = false
    this.markSeen()
    this.panel.focus({ preventScroll: true })
  }

  close(): void {
    if (!this.isOpen) return
    this.overlay.hidden = true
    this.guideButton.hidden = false
    const target = this.previousFocus?.isConnected ? this.previousFocus : this.guideButton
    if (target === this.guideButton) this.focusGame()
    else target.focus({ preventScroll: true })
    this.previousFocus = null
  }

  setProgress(progress: JourneyProgress): void {
    const projects = count(progress.projects, progress.totalProjects)
    const career = count(progress.career, progress.totalCareer)
    const sentinels = count(progress.sentinels, progress.totalSentinels)
    const waves = count(progress.waves, progress.totalWaves)

    this.routeCounts.projects.textContent = `${projects.value}/${projects.total} inspected`
    this.routeCounts.career.textContent = `${career.value}/${career.total} stops visited`
    this.routeCounts.arena.textContent = `${waves.value}/${waves.total} waves cleared`

    this.statCounts.projects.textContent = `${projects.value}/${projects.total}`
    this.statCounts.career.textContent = `${career.value}/${career.total}`
    this.statCounts.sentinels.textContent = `${sentinels.value}/${sentinels.total}`
    this.statCounts.waves.textContent = `${waves.value}/${waves.total}`
  }

  dispose(): void {
    this.overlay.removeEventListener('keydown', this.onKeyDown)
    this.overlay.remove()
    this.guideButton.remove()
  }

  private createRouteCard(
    route: JourneyRoute,
    eyebrow: string,
    title: string,
    description: string,
    action: string,
    onRoute: JourneyHandlers['onRoute'],
  ): { card: HTMLElement; progress: HTMLSpanElement } {
    const card = el('article', `journey-card journey-card-${route}`)
    card.append(el('p', 'journey-card-eyebrow', eyebrow), el('h3', undefined, title), el('p', 'journey-card-copy', description))
    const bottom = el('div', 'journey-card-bottom')
    const progress = el('span', 'journey-card-progress', 'Ready to explore')
    const button = el('button', 'journey-route-button', `${action} →`)
    button.type = 'button'
    button.addEventListener('click', () => {
      this.close()
      // A route always hands keyboard control back to the game, regardless of what opened the guide.
      this.focusGame()
      onRoute(route)
    })
    bottom.append(progress, button)
    card.append(bottom)
    return { card, progress }
  }

  private createStat(label: string): { root: HTMLDivElement; value: HTMLSpanElement } {
    const root = el('div', 'journey-stat')
    const value = el('span', 'journey-stat-value', '—')
    root.append(value, el('span', 'journey-stat-label', label))
    return { root, value }
  }

  private focusGame(): void {
    if (this.gameCanvas?.isConnected) this.gameCanvas.focus({ preventScroll: true })
    else {
      this.guideButton.focus({ preventScroll: true })
      this.guideButton.blur()
    }
  }

  private isFirstVisit(): boolean {
    if (seenThisSession) return false
    try {
      return window.localStorage.getItem(SEEN_KEY) === null
    } catch {
      // Private browsing and embedded frames can deny storage. The guide still works this session.
      return true
    }
  }

  private markSeen(): void {
    seenThisSession = true
    try {
      window.localStorage.setItem(SEEN_KEY, '1')
    } catch {
      // Keep the guide usable even when storage is unavailable.
    }
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // Let button defaults work, but keep game keyboard shortcuts from firing behind the dialog.
    event.stopPropagation()
    if (event.key === 'Escape' || event.code === 'KeyH') {
      event.preventDefault()
      this.close()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = Array.from(this.panel.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
    if (focusable.length === 0) {
      event.preventDefault()
      this.panel.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === this.panel)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }
}
