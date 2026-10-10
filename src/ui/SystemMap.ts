import type { PlanetDefinition } from '../app/PlanetContracts.ts'
import { differenceSpacePosition } from '../space/SpacePosition.ts'
import type { OrbitSystem } from '../space/OrbitSystem.ts'
import { projects } from '../data/projects.ts'
import { pathForPlanet } from '../worlds/registry.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'
const GROUPS = [
  { key: 'gameplay', label: '01 / GAMEPLAY + ANIMATION', caption: 'Worlds built to play' },
  { key: 'simulation', label: '02 / AI + SIMULATION', caption: 'Worlds that think and move' },
  { key: 'engineering', label: '03 / ENGINEERING + TOOLS', caption: 'Systems behind the worlds' },
] as const

interface SystemMapActions {
  onSelect(planet: PlanetDefinition): void
  onWarp(planet: PlanetDefinition): void
  onOpen(planet: PlanetDefinition): void
  onClose(): void
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag)
  result.className = className
  if (text !== undefined) result.textContent = text
  return result
}

/** Top-down flight chart. All marker positions come from the live OrbitSystem. */
export class SystemMap {
  readonly element = element('section', 'system-map')
  private readonly chart = element('div', 'system-map-chart')
  private readonly markers = new Map<string, HTMLButtonElement>()
  private readonly listButtons = new Map<string, HTMLButtonElement>()
  private readonly rings = new Map<string, SVGCircleElement>()
  private readonly detail = element('article', 'system-map-detail')
  private readonly closeButton = element('button', 'system-map-close', 'Close map ×')
  private selected: PlanetDefinition
  private readonly maxRadius: number

  constructor(private readonly planets: readonly PlanetDefinition[], private readonly actions: SystemMapActions) {
    this.selected = planets[0]
    this.maxRadius = Math.max(...planets.map(planet => planet.orbit.radius))
    this.element.hidden = true
    this.element.setAttribute('aria-label', 'System Zero orbit map with nine project worlds around a central black hole')
    this.element.setAttribute('role', 'dialog')
    this.element.setAttribute('aria-modal', 'false')
    this.closeButton.type = 'button'
    this.closeButton.addEventListener('click', actions.onClose)

    const heading = element('header', 'system-map-heading')
    const headingText = element('div', '')
    headingText.append(element('span', 'eyebrow', 'SYSTEM ZERO / FLIGHT CHART'), element('h2', '', 'Nine worlds in motion.'))
    heading.append(headingText, this.closeButton)

    const body = element('div', 'system-map-body')
    this.buildChart()
    this.buildIndex()
    body.append(this.chart, this.detail)
    this.element.append(heading, body)
    this.select(this.selected)
  }

  get isOpen(): boolean { return !this.element.hidden }

  open(): void {
    this.element.hidden = false
    this.closeButton.focus()
  }

  close(): void { this.element.hidden = true }

  select(planet: PlanetDefinition): void {
    this.selected = planet
    for (const [slug, button] of this.markers) {
      button.classList.toggle('is-selected', slug === planet.slug)
      button.setAttribute('aria-pressed', String(slug === planet.slug))
    }
    for (const [slug, button] of this.listButtons) {
      button.classList.toggle('is-selected', slug === planet.slug)
      button.setAttribute('aria-pressed', String(slug === planet.slug))
    }
    for (const [slug, ring] of this.rings) ring.classList.toggle('is-selected', slug === planet.slug)
    this.renderDetail(planet)
  }

  update(orbits: OrbitSystem): void {
    if (!this.isOpen) return
    const center = orbits.getCenter()
    for (const planet of this.planets) {
      const button = this.markers.get(planet.slug)
      if (!button) continue
      const [x, , z] = differenceSpacePosition(center, orbits.getPosition(planet))
      const scale = 43 / this.maxRadius
      button.style.left = `${50 + x * scale}%`
      button.style.top = `${50 + z * scale}%`
    }
  }

  private buildChart(): void {
    const heading = element('div', 'system-map-chart-caption')
    heading.append(element('span', '', 'TOP-DOWN ORBIT VIEW'), element('span', '', 'PLANETS MOVE IN REAL TIME'))
    const field = element('div', 'system-map-field')
    const orbitSvg = document.createElementNS(SVG_NS, 'svg')
    orbitSvg.setAttribute('viewBox', '0 0 1000 1000')
    orbitSvg.setAttribute('class', 'system-map-orbits')
    orbitSvg.setAttribute('aria-hidden', 'true')
    for (const planet of this.planets) {
      const ring = document.createElementNS(SVG_NS, 'circle')
      ring.setAttribute('cx', '500')
      ring.setAttribute('cy', '500')
      ring.setAttribute('r', String(planet.orbit.radius / this.maxRadius * 430))
      ring.setAttribute('class', `system-map-ring group-${planet.orbit.group} pattern-${planet.orbit.linePattern}`)
      this.rings.set(planet.slug, ring)
      orbitSvg.append(ring)
    }
    field.append(orbitSvg)
    const core = element('div', 'system-map-core')
    core.setAttribute('role', 'img')
    core.setAttribute('aria-label', 'Central black hole')
    core.append(element('span', 'system-map-core-symbol', 'S/0'), element('span', 'system-map-core-label', 'BLACK HOLE'))
    field.append(core)
    this.planets.forEach((planet, index) => {
      const button = element('button', `system-map-marker group-${planet.orbit.group}`)
      button.type = 'button'
      button.style.setProperty('--world-color', `#${planet.color.toString(16).padStart(6, '0')}`)
      button.setAttribute('aria-label', `Select ${planet.title} on the system map`)
      button.append(element('span', 'system-map-marker-symbol', planet.orbit.glyph), element('span', 'system-map-marker-index', String(index + 1).padStart(2, '0')))
      button.addEventListener('click', () => {
        this.select(planet)
        this.actions.onSelect(planet)
      })
      this.markers.set(planet.slug, button)
      field.append(button)
    })
    this.chart.append(heading, field)
  }

  private buildIndex(): void {
    const index = element('div', 'system-map-index')
    for (const group of GROUPS) {
      const section = element('section', `system-map-group group-${group.key}`)
      section.append(element('h3', '', group.label), element('p', '', group.caption))
      for (const planet of this.planets.filter(item => item.orbit.group === group.key)) {
        const button = element('button', 'system-map-index-button')
        button.type = 'button'
        button.append(element('span', 'system-map-index-glyph', planet.orbit.glyph), element('span', '', planet.title))
        button.addEventListener('click', () => {
          this.select(planet)
          this.actions.onSelect(planet)
        })
        this.listButtons.set(planet.slug, button)
        section.append(button)
      }
      index.append(section)
    }
    this.detail.append(index)
  }

  private renderDetail(planet: PlanetDefinition): void {
    const old = this.detail.querySelector('.system-map-selection')
    old?.remove()
    const project = projects.find(item => item.key === planet.projectKey)
    const group = GROUPS.find(item => item.key === planet.orbit.group)
    const selection = element('section', 'system-map-selection')
    selection.append(
      element('span', 'eyebrow', `${group?.label ?? 'PROJECT WORLD'} / ${planet.orbit.glyph}`),
      element('h3', '', planet.title),
      element('p', '', project?.summary ?? 'Explore this project world.'),
    )
    const actions = element('div', 'system-map-actions')
    const warp = element('button', 'primary-button', 'Warp to orbit ↗')
    warp.type = 'button'
    warp.addEventListener('click', () => this.actions.onWarp(planet))
    const open = element('a', 'secondary-button', planet.slug === 'event-horizon' ? 'Play world ↗' : 'Open world ↗')
    open.href = pathForPlanet(planet)
    open.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      this.actions.onOpen(planet)
    })
    actions.append(warp, open)
    if (project?.github) {
      const source = element('a', 'system-map-source', 'Original project ↗')
      source.href = project.github
      source.target = '_blank'
      source.rel = 'noopener noreferrer'
      actions.append(source)
    }
    selection.append(actions)
    this.detail.prepend(selection)
  }
}
