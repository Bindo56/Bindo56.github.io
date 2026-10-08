import { projects, type Project } from '../data/projects.ts'
import { experience, type Experience } from '../data/experience.ts'
import type { MediaPopupContent } from '../ui/MediaPopup.ts'
import { planetDefinitions, pathForPlanet } from '../worlds/registry.ts'
import type { PlanetDefinition } from './PlanetContracts.ts'

type Tab = 'projects' | 'experience'

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function outbound(label: string, href: string): HTMLAnchorElement {
  const link = element('a', 'archive-link', label)
  link.href = href
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  return link
}

/** The complete original project archive and career history, available from the header. */
export class PortfolioView {
  readonly root = element('div', 'archive-overlay')
  private readonly panel = element('section', 'archive-panel')
  private readonly content = element('div', 'archive-content')
  private readonly closeButton = element('button', 'icon-button', '×')
  private readonly projectTab = element('button', 'archive-tab', 'Projects')
  private readonly experienceTab = element('button', 'archive-tab', 'Experience')
  private previousFocus: HTMLElement | null = null

  constructor(
    parent: HTMLElement,
    private readonly onClose: () => void,
    private readonly onMedia: (content: MediaPopupContent) => void,
    private readonly onWorld: (planet: PlanetDefinition) => void,
  ) {
    this.root.setAttribute('aria-hidden', 'true')
    this.root.addEventListener('click', event => {
      if (event.target === this.root) this.close()
    })
    this.root.addEventListener('keydown', this.onKeyDown)
    this.panel.setAttribute('role', 'dialog')
    this.panel.setAttribute('aria-modal', 'true')
    this.panel.setAttribute('aria-label', 'Portfolio archive')
    this.panel.dataset.testid = 'portfolio-panel'
    this.panel.tabIndex = -1

    const header = element('header', 'archive-header')
    const heading = element('div', 'archive-heading')
    heading.append(element('span', 'eyebrow', 'THE WORK BEHIND THE WORLDS'), element('h2', '', 'Portfolio archive'))
    this.closeButton.type = 'button'
    this.closeButton.setAttribute('aria-label', 'Close portfolio')
    this.closeButton.addEventListener('click', () => this.close())
    header.append(heading, this.closeButton)

    const tabs = element('div', 'archive-tabs')
    this.projectTab.type = 'button'
    this.experienceTab.type = 'button'
    this.projectTab.addEventListener('click', () => this.show('projects'))
    this.experienceTab.addEventListener('click', () => this.show('experience'))
    tabs.append(this.projectTab, this.experienceTab)
    this.panel.append(header, tabs, this.content)
    this.root.append(this.panel)
    parent.append(this.root)
    this.show('projects')
  }

  get isOpen(): boolean { return this.root.classList.contains('open') }

  open(tab: Tab = 'projects'): void {
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    this.show(tab)
    this.root.classList.add('open')
    this.root.setAttribute('aria-hidden', 'false')
    this.closeButton.focus({ preventScroll: true })
  }

  close(): void {
    if (!this.isOpen) return
    this.root.classList.remove('open')
    this.root.setAttribute('aria-hidden', 'true')
    this.previousFocus?.focus({ preventScroll: true })
    this.previousFocus = null
    this.onClose()
  }

  dispose(): void { this.root.remove() }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.close()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...this.panel.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')]
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  private show(tab: Tab): void {
    this.projectTab.setAttribute('aria-selected', String(tab === 'projects'))
    this.experienceTab.setAttribute('aria-selected', String(tab === 'experience'))
    this.content.replaceChildren(tab === 'projects' ? this.buildProjects() : this.buildExperience())
  }

  private buildProjects(): HTMLElement {
    const grid = element('div', 'archive-grid')
    for (const project of projects) {
      const article = element('article', 'archive-card')
      article.style.setProperty('--card-accent', '#' + project.color.toString(16).padStart(6, '0'))
      article.append(element('span', 'eyebrow', project.id), element('h3', '', project.title))
      article.append(element('p', 'archive-summary', project.summary))
      article.append(element('p', 'archive-tech', project.tech.join('  /  ')))

      const actions = element('div', 'archive-actions')
      const planet = planetDefinitions.find(item => item.projectKey === project.key)
      if (planet) {
        const world = element('a', 'archive-link primary', planet.slug === 'event-horizon' ? 'Play Solar DOTS ↗' : 'Explore ' + planet.title)
        world.href = pathForPlanet(planet)
        world.addEventListener('click', event => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
          event.preventDefault()
          this.close()
          this.onWorld(planet)
        })
        actions.append(world)
      }
      if (project.github) actions.append(outbound('Original source ↗', project.github))
      if (project.video) {
        const demo = element('button', 'archive-link', 'Watch demo ↗')
        demo.type = 'button'
        demo.addEventListener('click', () => this.onMedia(this.projectMedia(project)))
        actions.append(demo)
      }
      if (!project.github && !project.video) {
        actions.append(element('span', 'archive-pending', 'Original source and demo pending'))
      }
      article.append(actions)
      grid.append(article)
    }
    return grid
  }

  private buildExperience(): HTMLElement {
    const grid = element('div', 'archive-grid experience-grid')
    for (const item of experience) {
      const article = element('article', 'archive-card')
      article.append(element('span', 'eyebrow', item.period), element('h3', '', item.role))
      article.append(element('p', 'archive-company', item.company))
      const list = element('ul', 'archive-highlights')
      for (const highlight of item.highlights) list.append(element('li', '', highlight))
      article.append(list)
      const actions = element('div', 'archive-actions')
      if (item.website) actions.append(outbound('Website ↗', item.website))
      if (item.video) {
        const demo = element('button', 'archive-link', 'Watch media ↗')
        demo.type = 'button'
        demo.addEventListener('click', () => this.onMedia(this.experienceMedia(item)))
        actions.append(demo)
      }
      article.append(actions)
      grid.append(article)
    }
    return grid
  }

  private projectMedia(project: Project): MediaPopupContent {
    return {
      title: project.title,
      subtitle: project.tech.join(' · '),
      body: [project.summary],
      video: project.video,
      links: project.github ? [{ label: 'Original source ↗', href: project.github }] : [],
      accent: project.color,
      hint: '[Esc] Close',
    }
  }

  private experienceMedia(item: Experience): MediaPopupContent {
    return {
      title: item.role + ' · ' + item.company,
      subtitle: item.period,
      body: item.highlights,
      bulleted: true,
      video: item.video,
      links: item.website ? [{ label: 'Website ↗', href: item.website }] : [],
      accent: 0x4f8cff,
      hint: '[Esc] Close',
    }
  }
}
