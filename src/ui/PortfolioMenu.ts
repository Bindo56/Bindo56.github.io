import type { Input } from '../core/Input.ts'
import type { Experience } from '../data/experience.ts'
import type { Project } from '../data/projects.ts'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** The full-screen portfolio: every project and every role. Tab or M toggles it; Escape closes. */
export class PortfolioMenu {
  private readonly root: HTMLDivElement
  private readonly input: Input
  /** Keyed by the project itself: ids are display tags and may repeat. */
  private readonly statusByProject = new Map<Project, HTMLSpanElement>()

  constructor(parent: HTMLElement, input: Input, projects: readonly Project[], experience: readonly Experience[]) {
    this.input = input
    this.root = el('div', 'menu')

    const panel = el('div', 'menu-panel')

    const header = el('header', 'menu-header')
    header.append(el('h1', undefined, 'Portfolio'), el('span', 'menu-hint', '[Tab] close'))

    panel.append(header, this.buildProjects(projects), this.buildExperience(experience))
    this.root.append(panel)
    parent.append(this.root)
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open')
  }

  open(): void {
    this.root.classList.add('open')
  }

  close(): void {
    this.root.classList.remove('open')
  }

  toggle(): void {
    this.root.classList.toggle('open')
  }

  /** Marks which projects the player has already inspected in the world. */
  setVisited(visitedProjects: ReadonlySet<Project>): void {
    for (const [project, status] of this.statusByProject) {
      const visited = visitedProjects.has(project)
      status.textContent = visited ? 'Inspected' : 'Not inspected'
      status.classList.toggle('visited', visited)
    }
  }

  update(): void {
    if (this.input.consume('Tab') || this.input.consume('KeyM')) {
      this.toggle()
      return
    }

    if (this.isOpen && this.input.consume('Escape')) this.close()
  }

  dispose(): void {
    this.root.remove()
  }

  private buildProjects(projects: readonly Project[]): HTMLElement {
    const section = el('section', 'menu-section')
    const list = el('ul', 'menu-list')

    for (const project of projects) {
      const status = el('span', 'menu-status', 'Not inspected')
      this.statusByProject.set(project, status)

      const top = el('div', 'menu-item-top')
      top.append(el('h3', undefined, project.title), status)

      const item = el('li', 'menu-item')
      item.append(top, el('p', 'menu-meta', project.tech.join(' · ')), el('p', undefined, project.summary))

      if (project.github) {
        const link = el('a', undefined, 'GitHub ↗')
        link.href = project.github
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        item.append(link)
      }

      list.append(item)
    }

    section.append(el('h2', undefined, 'Projects'), list)
    return section
  }

  private buildExperience(experience: readonly Experience[]): HTMLElement {
    const section = el('section', 'menu-section')
    const list = el('ul', 'menu-list')

    for (const entry of experience) {
      const top = el('div', 'menu-item-top')
      top.append(el('h3', undefined, `${entry.role} · ${entry.company}`), el('span', 'menu-status', entry.period))

      const highlights = el('ul')
      for (const highlight of entry.highlights) highlights.append(el('li', undefined, highlight))

      const item = el('li', 'menu-item')
      item.append(top, highlights)

      if (entry.website) {
        const link = el('a', undefined, 'Website ↗')
        link.href = entry.website
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        item.append(link)
      }

      list.append(item)
    }

    section.append(el('h2', undefined, 'Experience'), list)
    return section
  }
}
