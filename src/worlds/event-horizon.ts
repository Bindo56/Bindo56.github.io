import { projects } from '../data/projects.ts'
import type { PlanetDefinition, PlanetHost, PlanetModule, PlanetSession, PreparedPlanet } from '../app/PlanetContracts.ts'
import { SolarSimulation, type SolarPreset } from './solar-dots/SolarSimulation.ts'
import { SolarVisual } from './solar-dots/SolarVisual.ts'

interface PreparedSolar extends PreparedPlanet {
  simulation: SolarSimulation
  visual: SolarVisual
  capacity: number
}

const PRESETS: readonly [SolarPreset, string, string][] = [
  ['orbit', 'Orbit', 'A tangential launch keeps most bodies in motion.'],
  ['plunge', 'Plunge', 'A slower launch pulls the swarm toward the center.'],
  ['escape', 'Escape', 'A faster launch sends bodies beyond the field.'],
]

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag)
  item.className = className
  if (text !== undefined) item.textContent = text
  return item
}

function external(label: string, href: string): HTMLAnchorElement {
  const link = el('a', '', label)
  link.href = href
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  return link
}

function particleBudget(): number {
  return window.innerWidth < 700 || window.matchMedia('(pointer: coarse)').matches ? 3500 : 9000
}

const module: PlanetModule = {
  async prepare(_definition: PlanetDefinition, signal: AbortSignal): Promise<PreparedPlanet> {
    if (signal.aborted) throw new DOMException('Solar DOTS preparation cancelled', 'AbortError')
    await Promise.resolve()
    if (signal.aborted) throw new DOMException('Solar DOTS preparation cancelled', 'AbortError')

    const capacity = particleBudget()
    const simulation = new SolarSimulation(capacity, 7057)
    simulation.launch('orbit', 650, 1, capacity)
    const visual = new SolarVisual(capacity)
    visual.setParticles(simulation.positions, simulation.states, simulation.count, simulation.velocities)
    let disposed = false
    const prepared: PreparedSolar = {
      scene: visual.scene,
      camera: visual.camera,
      simulation,
      visual,
      capacity,
      dispose() {
        if (disposed) return
        disposed = true
        visual.dispose()
      },
    }
    if (signal.aborted) {
      prepared.dispose()
      throw new DOMException('Solar DOTS preparation cancelled', 'AbortError')
    }
    return prepared
  },

  mount(prepared: PreparedPlanet, host: PlanetHost): PlanetSession {
    const world = prepared as PreparedSolar
    const { simulation, visual } = world
    const project = projects.find(item => item.key === 'dots-solar-system')
    let preset: SolarPreset = 'orbit'
    let started = false
    let paused = false
    let disposed = false
    let dragging = false
    let lastX = 0
    let lastY = 0
    let statsClock = 0
    let stableClock = 0
    let challengeComplete = false
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const root = el('div', 'solar-ui')
    root.dataset.testid = 'solar-world'
    root.setAttribute('aria-label', 'Solar DOTS interactive gravity lab')
    const intro = el('section', 'solar-intro')
    const title = el('h1', '', 'Solar DOTS')
    title.dataset.testid = 'world-title'
    intro.append(
      el('span', 'eyebrow', 'PLAYABLE WORLD / UNITY DOTS PROJECT'),
      title,
      el('p', '', 'Launch a swarm. Change its speed and gravity. Watch thousands of bodies orbit, fall inward, or escape.'),
      el('p', 'solar-intro-note', 'Inspired by my Unity ECS and Burst solar-system simulation. This playable version runs in Three.js.'),
    )
    const start = el('button', 'primary-button', 'Start experimenting ↗')
    start.type = 'button'
    start.dataset.testid = 'solar-start'
    const introLinks = el('div', 'solar-links')
    if (project?.github) introLinks.append(external('Unity DOTS source ↗', project.github))
    if (project?.video) introLinks.append(external('Watch original video ↗', project.video))
    const exit = el('button', 'secondary-button', '← Return to space')
    exit.type = 'button'
    exit.dataset.testid = 'exit-world'
    exit.addEventListener('click', host.onExit)
    intro.append(start, introLinks, exit)

    const controls = el('section', 'solar-control-panel')
    controls.hidden = true
    controls.append(
      el('span', 'eyebrow', 'EXPERIMENT 001 / CENTRAL GRAVITY'),
      el('h2', '', 'Solar DOTS'),
      el('p', '', 'Choose a path, tune the launch, and watch the swarm respond.'),
    )
    const presets = el('div', 'solar-presets')
    presets.setAttribute('role', 'group')
    presets.setAttribute('aria-label', 'Launch presets')
    const presetButtons = new Map<SolarPreset, HTMLButtonElement>()
    for (const [value, label] of PRESETS) {
      const button = el('button', '', label)
      button.type = 'button'
      button.setAttribute('aria-pressed', String(value === preset))
      button.addEventListener('click', () => {
        preset = value
        for (const [key, item] of presetButtons) item.setAttribute('aria-pressed', String(key === value))
        launch()
      })
      presets.append(button)
      presetButtons.set(value, button)
    }
    const sliders = el('div', 'solar-sliders')
    const gravityLabel = el('label', '', 'Gravity')
    const gravityOutput = el('output', '', '650')
    const gravityInput = el('input', '')
    gravityInput.type = 'range'
    gravityInput.min = '350'
    gravityInput.max = '1100'
    gravityInput.step = '25'
    gravityInput.value = '650'
    gravityInput.id = 'solar-gravity'
    gravityInput.dataset.testid = 'solar-gravity'
    gravityLabel.htmlFor = gravityInput.id
    gravityLabel.append(gravityOutput, gravityInput)
    const speedLabel = el('label', '', 'Launch speed')
    const speedOutput = el('output', '', '1.00×')
    const speedInput = el('input', '')
    speedInput.type = 'range'
    speedInput.min = '0.6'
    speedInput.max = '1.8'
    speedInput.step = '0.05'
    speedInput.value = '1'
    speedInput.id = 'solar-speed'
    speedInput.dataset.testid = 'solar-speed'
    speedLabel.htmlFor = speedInput.id
    speedLabel.append(speedOutput, speedInput)
    gravityInput.addEventListener('input', () => {
      gravityOutput.textContent = gravityInput.value
      status.textContent = 'Gravity set. Launch the swarm to apply it.'
    })
    speedInput.addEventListener('input', () => {
      speedOutput.textContent = Number(speedInput.value).toFixed(2) + '×'
      status.textContent = 'Speed set. Launch the swarm to apply it.'
    })
    sliders.append(gravityLabel, speedLabel)

    const actions = el('div', 'solar-actions')
    const launchButton = el('button', 'primary-button', 'Launch swarm ↗')
    launchButton.type = 'button'
    launchButton.dataset.testid = 'solar-launch'
    const pauseButton = el('button', 'secondary-button', 'Pause')
    pauseButton.type = 'button'
    pauseButton.dataset.testid = 'solar-pause'
    const resetButton = el('button', 'secondary-button', 'Reset')
    resetButton.type = 'button'
    actions.append(launchButton, pauseButton, resetButton)
    const status = el('p', 'solar-feedback', PRESETS[0][2])
    status.setAttribute('role', 'status')
    const stats = el('div', 'solar-stat-grid')
    const orbiting = metric(stats, 'Orbiting')
    const captured = metric(stats, 'Captured')
    const escaped = metric(stats, 'Escaped')
    const elapsed = metric(stats, 'Elapsed')
    const controlsLinks = el('div', 'solar-links')
    if (project?.github) controlsLinks.append(external('Original Unity source ↗', project.github))
    if (project?.video) controlsLinks.append(external('Original video ↗', project.video))
    const proof = el('p', 'solar-proof', 'Original: Unity ECS + Burst. Interactive adaptation: Three.js.')
    const buildNotes = el('details', 'solar-build-notes')
    buildNotes.append(
      el('summary', '', 'How the original works'),
      el('p', '', 'The Unity version updates many entities with ECS systems and Burst jobs. Each body accelerates toward a fixed center, then exits the simulation at an inner or outer boundary.'),
      el('p', '', 'This browser version recreates that central-gravity experiment with typed arrays and batched Three.js particles.'),
    )
    controls.append(presets, sliders, actions, status, stats, controlsLinks, proof, buildNotes)

    const mini = el('aside', 'solar-mini-hud')
    mini.setAttribute('aria-label', 'Browser simulation status')
    mini.append(el('span', '', 'BROWSER SIMULATION'), document.createElement('br'))
    const miniCount = el('strong', '', world.capacity.toLocaleString() + ' BODIES')
    mini.append(miniCount, document.createElement('br'), el('small', '', 'DRAG TO ORBIT · SCROLL TO ZOOM'))
    root.append(intro, controls, mini)
    host.uiRoot.replaceChildren(root)

    function renderStats(): void {
      orbiting.textContent = simulation.orbiting.toLocaleString()
      captured.textContent = simulation.captured.toLocaleString()
      escaped.textContent = simulation.escaped.toLocaleString()
      elapsed.textContent = simulation.elapsed.toFixed(1) + 's'
      miniCount.textContent = simulation.count.toLocaleString() + ' BODIES'
    }

    function launch(): void {
      if (disposed) return
      simulation.launch(preset, Number(gravityInput.value), Number(speedInput.value), world.capacity)
      paused = false
      stableClock = 0
      challengeComplete = false
      pauseButton.textContent = 'Pause'
      status.textContent = PRESETS.find(item => item[0] === preset)?.[2] ?? ''
      visual.setParticles(simulation.positions, simulation.states, simulation.count, simulation.velocities)
      renderStats()
    }

    start.addEventListener('click', () => {
      started = true
      intro.hidden = true
      controls.hidden = false
      controls.append(exit)
      launch()
      launchButton.focus({ preventScroll: true })
    })
    launchButton.addEventListener('click', launch)
    pauseButton.addEventListener('click', () => {
      paused = !paused
      pauseButton.textContent = paused ? 'Resume' : 'Pause'
      status.textContent = paused ? 'Simulation paused.' : 'Simulation running.'
    })
    resetButton.addEventListener('click', () => {
      gravityInput.value = '650'
      speedInput.value = '1'
      gravityOutput.textContent = '650'
      speedOutput.textContent = '1.00×'
      launch()
    })

    const onPointerDown = (event: PointerEvent): void => {
      if (!started || !host.isInteractive()) return
      dragging = true
      lastX = event.clientX
      lastY = event.clientY
      host.canvas.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent): void => {
      if (!dragging || !host.isInteractive()) return
      visual.orbit(event.clientX - lastX, event.clientY - lastY)
      lastX = event.clientX
      lastY = event.clientY
    }
    const onPointerUp = (): void => { dragging = false }
    const onWheel = (event: WheelEvent): void => {
      if (!started || !host.isInteractive()) return
      event.preventDefault()
      visual.zoom(event.deltaY)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!started || !host.isInteractive() || (event.target instanceof HTMLElement && /INPUT|BUTTON|A|SELECT|TEXTAREA/.test(event.target.tagName))) return
      if (event.code === 'Space') {
        event.preventDefault()
        pauseButton.click()
      } else if (event.code === 'KeyL') launch()
      else if (event.code === 'Digit1' || event.code === 'Digit2' || event.code === 'Digit3') {
        presetButtons.get(PRESETS[Number(event.code.slice(-1)) - 1][0])?.click()
      } else if (event.code === 'ArrowLeft') visual.orbit(-12, 0)
      else if (event.code === 'ArrowRight') visual.orbit(12, 0)
      else if (event.code === 'ArrowUp') visual.orbit(0, -12)
      else if (event.code === 'ArrowDown') visual.orbit(0, 12)
    }
    host.canvas.addEventListener('pointerdown', onPointerDown)
    host.canvas.addEventListener('pointermove', onPointerMove)
    host.canvas.addEventListener('pointerup', onPointerUp)
    host.canvas.addEventListener('pointercancel', onPointerUp)
    host.canvas.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onPointerUp)
    renderStats()

    return {
      scene: visual.scene,
      camera: visual.camera,
      update(dt: number) {
        if (disposed) return
        const interactive = host.isInteractive() && !document.hidden
        const step = started
          ? (interactive && !paused ? dt * (reducedMotion ? 0.3 : 1) : 0)
          : (interactive && !reducedMotion ? dt * 0.28 : 0)
        if (step > 0) {
          simulation.update(step)
          visual.setParticles(simulation.positions, simulation.states, simulation.count, simulation.velocities)
        }
        visual.update(reducedMotion ? 0 : interactive ? dt : 0)
        if (started && step > 0 && preset === 'orbit' && !challengeComplete) {
          stableClock = simulation.orbiting / Math.max(1, simulation.count) > 0.65 ? stableClock + step : 0
          if (stableClock >= 10) {
            challengeComplete = true
            status.textContent = 'Orbit locked for 10 seconds. Try Plunge or Escape next.'
          }
        }
        statsClock += dt
        if (statsClock >= 0.15) { renderStats(); statsClock = 0 }
      },
      dispose() {
        if (disposed) return
        disposed = true
        host.canvas.removeEventListener('pointerdown', onPointerDown)
        host.canvas.removeEventListener('pointermove', onPointerMove)
        host.canvas.removeEventListener('pointerup', onPointerUp)
        host.canvas.removeEventListener('pointercancel', onPointerUp)
        host.canvas.removeEventListener('wheel', onWheel)
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('blur', onPointerUp)
        host.uiRoot.replaceChildren()
        world.dispose()
      },
    }
  },
}

function metric(parent: HTMLElement, label: string): HTMLOutputElement {
  const card = el('div', '')
  const value = el('output', '', '0')
  card.append(el('span', '', label), value)
  parent.append(card)
  return value
}

export default module
