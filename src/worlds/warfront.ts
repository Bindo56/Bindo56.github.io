import type { PlanetDefinition, PlanetHost, PlanetModule, PlanetSession, PreparedPlanet } from '../app/PlanetContracts.ts'
import { projects } from '../data/projects.ts'
import { WarfrontVisual } from './warfront/WarfrontVisual.ts'

interface PreparedWarfront extends PreparedPlanet {
  visual: WarfrontVisual
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, content?: string): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag)
  item.className = className
  if (content !== undefined) item.textContent = content
  return item
}

function external(label: string, href: string): HTMLAnchorElement {
  const link = el('a', 'warfront-link', label)
  link.href = href
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  return link
}

const module: PlanetModule = {
  async prepare(_definition: PlanetDefinition, signal: AbortSignal): Promise<PreparedPlanet> {
    if (signal.aborted) throw new DOMException('Warfront preparation cancelled', 'AbortError')
    await Promise.resolve()
    if (signal.aborted) throw new DOMException('Warfront preparation cancelled', 'AbortError')
    const visual = new WarfrontVisual()
    let disposed = false
    const prepared: PreparedWarfront = {
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
      throw new DOMException('Warfront preparation cancelled', 'AbortError')
    }
    return prepared
  },

  mount(prepared: PreparedPlanet, host: PlanetHost): PlanetSession {
    const world = prepared as PreparedWarfront
    const { visual } = world
    const project = projects.find(item => item.key === 'survival-multiplayer')
    const root = el('div', 'warfront-ui')
    root.dataset.testid = 'warfront-observer'
    root.setAttribute('aria-label', 'Warfront planet battle observer')

    const intro = el('section', 'warfront-observer-card')
    intro.append(
      el('span', 'warfront-kicker', 'SYSTEM ZERO / WARFRONT'),
      el('h1', '', 'A planet at war.'),
      el('p', '', 'Orbit the scorched globe. Zoom toward a battle sector to watch tiny block soldiers cross fire between Blue and Red.'),
    )
    const legend = el('div', 'warfront-legend')
    legend.append(el('span', 'is-blue', 'BLUE SQUADS'), el('span', 'is-red', 'RED SQUADS'), el('span', 'warfront-observer-tag', 'OBSERVER MODE'))
    intro.append(legend)

    const controls = el('nav', 'warfront-controls')
    controls.setAttribute('aria-label', 'Warfront spectator camera')
    const planet = el('button', 'warfront-button', 'Planet view')
    const battle = el('button', 'warfront-button is-primary', 'Zoom to battle')
    const zoomOut = el('button', 'warfront-button warfront-zoom', '−')
    const zoomIn = el('button', 'warfront-button warfront-zoom', '+')
    const zoomValue = el('span', 'warfront-zoom-value', 'ZOOM 21%')
    zoomValue.setAttribute('aria-live', 'off')
    for (const button of [planet, battle, zoomOut, zoomIn]) button.type = 'button'
    zoomOut.setAttribute('aria-label', 'Zoom out from the planet')
    zoomIn.setAttribute('aria-label', 'Zoom in toward the planet')
    planet.addEventListener('click', () => { if (host.isInteractive()) { visual.showPlanet(); updateZoom() } })
    battle.addEventListener('click', () => { if (host.isInteractive()) { visual.focusBattle(); updateZoom() } })
    zoomOut.addEventListener('click', () => { if (host.isInteractive()) { visual.zoom(100); updateZoom() } })
    zoomIn.addEventListener('click', () => { if (host.isInteractive()) { visual.zoom(-100); updateZoom() } })
    controls.append(planet, battle, zoomOut, zoomValue, zoomIn)

    const footer = el('aside', 'warfront-footer')
    footer.append(el('span', '', 'DRAG TO ORBIT  ·  SCROLL / PINCH TO ZOOM  ·  WATCH THE BATTLE'))
    const links = el('div', 'warfront-links')
    if (project?.github) links.append(external('Original Unreal source ↗', project.github))
    if (project?.video) links.append(external('Original project video ↗', project.video))
    const exit = el('button', 'warfront-exit', '← Return to space')
    exit.type = 'button'
    exit.dataset.testid = 'exit-world'
    exit.addEventListener('click', () => host.onExit())
    links.append(exit)
    footer.append(links)
    root.append(intro, controls, footer)
    host.uiRoot.replaceChildren(root)

    function updateZoom(): void {
      zoomValue.textContent = `ZOOM ${visual.zoomPercent}%`
    }
    updateZoom()

    const pointers = new Map<number, { x: number; y: number }>()
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y)
    const pointerDown = (event: PointerEvent): void => {
      if (!host.isInteractive()) return
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      host.canvas.setPointerCapture(event.pointerId)
    }
    const pointerMove = (event: PointerEvent): void => {
      if (!host.isInteractive()) return
      const previous = pointers.get(event.pointerId)
      if (!previous) return
      const current = { x: event.clientX, y: event.clientY }
      if (pointers.size === 1) visual.orbit(current.x - previous.x, current.y - previous.y)
      else if (pointers.size === 2) {
        const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1]
        if (other) { visual.zoom((distance(previous, other) - distance(current, other)) * 2); updateZoom() }
      }
      pointers.set(event.pointerId, current)
    }
    const pointerEnd = (event: PointerEvent): void => {
      pointers.delete(event.pointerId)
      if (host.canvas.hasPointerCapture(event.pointerId)) host.canvas.releasePointerCapture(event.pointerId)
    }
    const wheel = (event: WheelEvent): void => {
      if (!host.isInteractive()) return
      event.preventDefault()
      visual.zoom(event.deltaY)
      updateZoom()
    }
    host.canvas.addEventListener('pointerdown', pointerDown)
    host.canvas.addEventListener('pointermove', pointerMove)
    host.canvas.addEventListener('pointerup', pointerEnd)
    host.canvas.addEventListener('pointercancel', pointerEnd)
    host.canvas.addEventListener('wheel', wheel, { passive: false })

    let disposed = false
    return {
      scene: visual.scene,
      camera: visual.camera,
      update(dt: number) { visual.update(dt) },
      dispose() {
        if (disposed) return
        disposed = true
        host.canvas.removeEventListener('pointerdown', pointerDown)
        host.canvas.removeEventListener('pointermove', pointerMove)
        host.canvas.removeEventListener('pointerup', pointerEnd)
        host.canvas.removeEventListener('pointercancel', pointerEnd)
        host.canvas.removeEventListener('wheel', wheel)
        for (const pointerId of pointers.keys()) {
          if (host.canvas.hasPointerCapture(pointerId)) host.canvas.releasePointerCapture(pointerId)
        }
        pointers.clear()
        root.remove()
        world.dispose()
      },
    }
  },
}

export default module
