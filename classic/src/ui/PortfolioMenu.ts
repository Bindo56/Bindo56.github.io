import type { Input } from '../core/Input.ts'
import type { Experience } from '../data/experience.ts'
import type { Project } from '../data/projects.ts'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** The full-screen portfolio: every project and every role. M toggles it; Escape closes. */
export class PortfolioMenu {
  private readonly root: HTMLDivElement
  private readonly input: Input
  private readonly onProject: (project: Project, index: number) => void
  private readonly closeButton: HTMLButtonElement
  private previousFocus: HTMLElement | null = null
  /** Keyed by the project itself: ids are display tags and may repeat. */
  private readonly statusByProject = new Map<Project, HTMLSpanElement>()

  constructor(
    parent: HTMLElement, input: Input, projects: readonly Project[], experience: readonly Experience[],
    onProject: (project: Project, index: number) => void,
  ) {
    this.input = input
    this.onProject = onProject
    this.root = el('div', 'menu')
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-modal', 'true')
    this.root.setAttribute('aria-label', 'Project archive')
    this.root.addEventListener('keydown', this.onKeyDown)

    const panel = el('div', 'menu-panel')

    const header = el('header', 'menu-header')
    this.closeButton = el('button', 'menu-close', '×')
    this.closeButton.type = 'button'
    this.closeButton.setAttribute('aria-label', 'Close project archive')
    this.closeButton.addEventListener('click', () => this.close())
    header.append(el('h1', undefined, 'Project archive'), el('span', 'menu-hint', '[M] / [Esc] close'), this.closeButton)

    panel.append(header, this.buildProjects(projects), this.buildExperience(experience))
    this.root.append(panel)
    parent.append(this.root)
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open')
  }

  open(): void {
    if (this.isOpen) return
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    this.root.classList.add('open')
    this.closeButton.focus({ preventScroll: true })
  }

  close(): void {
    if (!this.isOpen) return
    this.root.classList.remove('open')
    const target = this.previousFocus?.isConnected && this.previousFocus !== document.body
      ? this.previousFocus
      : document.querySelector<HTMLCanvasElement>('canvas')
    target?.focus({ preventScroll: true })
    this.previousFocus = null
  }

  toggle(): void {
    if (this.isOpen) this.close()
    else this.open()
  }

  /** Marks which projects the player has already inspected in the world. */
  setVisited(visitedProjects: ReadonlySet<Project>): void {
    for (const [project, status] of this.statusByProject) {
      const visited = visitedProjects.has(project)
      status.textContent = visited ? 'Discovered' : 'Undiscovered'
      status.classList.toggle('visited', visited)
    }
  }

  update(): void {
    if (this.input.consume('KeyM')) {
      this.toggle()
      return
    }

    if (this.isOpen && this.input.consume('Escape')) this.close()
  }

  dispose(): void {
    this.root.removeEventListener('keydown', this.onKeyDown)
    this.root.remove()
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return
    const focusable = [...this.root.querySelectorAll<HTMLElement>('button, a[href]')]
    if (focusable.length === 0) return
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

  private buildProjects(projects: readonly Project[]): HTMLElement {
    const section = el('section', 'menu-section')
    const list = el('ul', 'menu-list')

    for (const [index, project] of projects.entries()) {
      const status = el('span', 'menu-status', 'Undiscovered')
      this.statusByProject.set(project, status)

      const top = el('div', 'menu-item-top')
      top.append(el('h3', undefined, project.title), status)

      const item = el('li', 'menu-item')
      item.append(top, el('p', 'menu-meta', project.tech.join(' · ')), el('p', undefined, project.summary))

      const detail = el('button', 'menu-detail-button', 'View project details')
      detail.type = 'button'
      detail.addEventListener('click', () => this.onProject(project, index))
      item.append(detail)

      if (project.github) {
        const link = el('a', undefined, project.github.includes('github.com') ? 'Source on GitHub ↗' : 'Project link ↗')
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
      item.append(top)
      if (entry.highlights.length > 0) item.append(highlights)

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
