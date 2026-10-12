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
    root.setAttribute('aria-label', 'Warfront planet battle')

    const intro = el('section', 'warfront-observer-card')
    intro.append(
      el('span', 'warfront-kicker', 'SYSTEM ZERO / WARFRONT'),
      el('h1', '', 'A planet at war.'),
      el('p', '', 'Orbit the scorched world. Blue and Red squads fight across its surface among craters, ruins, fire, and smoke. Zoom in anywhere the battle glows.'),
    )
    const legend = el('div', 'warfront-legend')
    legend.append(el('span', 'is-blue', 'BLUE SQUADS'), el('span', 'is-red', 'RED SQUADS'), el('span', 'warfront-observer-tag', 'OBSERVER MODE'))
    intro.append(legend)

    const jumpIn = el('button', 'warfront-jump-in', 'Jump into battle ↓')
    jumpIn.type = 'button'
    jumpIn.addEventListener('click', () => {
      if (!host.isInteractive()) return
      visual.enterRandomSoldier()
      syncMode()
      lockAim()
    })
    intro.append(jumpIn)

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

    const soldierHud = el('section', 'warfront-soldier-hud')
    const teamLabel = el('span', 'warfront-soldier-team')
    const weaponLabel = el('span', 'warfront-soldier-weapon')
    const killLabel = el('strong', 'warfront-kill-count')
    killLabel.setAttribute('aria-live', 'polite')
    const soldierHelp = el('p', '', 'WASD MOVE · MOUSE AIM · LEFT CLICK FIRE · SPACE HOP · 1 / 2 WEAPONS · V ORBIT')
    const weaponControls = el('div', 'warfront-soldier-actions')
    const rifle = el('button', 'warfront-button', '1  Assault rifle')
    const rocket = el('button', 'warfront-button', '2  Rocket launcher')
    const leave = el('button', 'warfront-button', '↑ Observe planet')
    for (const button of [rifle, rocket, leave]) button.type = 'button'
    rifle.addEventListener('click', () => { visual.equip('rifle'); syncMode() })
    rocket.addEventListener('click', () => { visual.equip('rocket'); syncMode() })
    leave.addEventListener('click', () => { releaseAim(); visual.leaveSoldier(); syncMode() })
    weaponControls.append(rifle, rocket, leave)
    soldierHud.append(teamLabel, weaponLabel, killLabel, soldierHelp, weaponControls)

    const touchControls = el('div', 'warfront-touch-controls')
    const touchPad = el('div', 'warfront-touch-pad')
    const touchActions = el('div', 'warfront-touch-actions')
    const held = new Set<string>()
    let mouseFiring = false
    const bindHold = (button: HTMLButtonElement, action: string): void => {
      button.type = 'button'
      button.addEventListener('pointerdown', event => {
        if (!visual.isPlaying || !host.isInteractive()) return
        event.preventDefault()
        button.setPointerCapture(event.pointerId)
        held.add(action)
        syncMovement()
      })
      const release = (): void => { held.delete(action); syncMovement() }
      button.addEventListener('pointerup', release)
      button.addEventListener('pointercancel', release)
      button.addEventListener('lostpointercapture', release)
    }
    for (const [label, action] of [['▲', 'forward'], ['◀', 'left'], ['▼', 'back'], ['▶', 'right']] as const) {
      const button = el('button', 'warfront-touch-button', label)
      button.setAttribute('aria-label', action)
      bindHold(button, action)
      touchPad.append(button)
    }
    const fireButton = el('button', 'warfront-touch-button is-fire', 'FIRE')
    bindHold(fireButton, 'fire')
    const hopButton = el('button', 'warfront-touch-button', 'HOP')
    hopButton.type = 'button'
    hopButton.addEventListener('click', () => { if (host.isInteractive()) visual.jump() })
    const swapButton = el('button', 'warfront-touch-button', 'SWAP')
    swapButton.type = 'button'
    swapButton.addEventListener('click', () => { if (host.isInteractive()) { visual.equip(visual.currentWeapon === 'rifle' ? 'rocket' : 'rifle'); syncMode() } })
    touchActions.append(fireButton, hopButton, swapButton)
    touchControls.append(touchPad, touchActions)

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
    root.append(intro, controls, soldierHud, touchControls, footer)
    host.uiRoot.replaceChildren(root)

    function updateZoom(): void {
      zoomValue.textContent = `ZOOM ${visual.zoomPercent}%`
    }
    function syncMode(): void {
      const playing = visual.isPlaying
      root.classList.toggle('is-playing', playing)
      root.dataset.testid = playing ? 'warfront-soldier' : 'warfront-observer'
      teamLabel.textContent = playing ? `${visual.playerTeam?.toUpperCase()} SQUAD · YOU ARE ON THE GROUND` : ''
      teamLabel.classList.toggle('is-red', visual.playerTeam === 'red')
      weaponLabel.textContent = visual.currentWeapon === 'rifle' ? 'ASSAULT RIFLE · AUTO' : 'ROCKET LAUNCHER · HEAVY'
      updateKills()
      rifle.classList.toggle('is-primary', visual.currentWeapon === 'rifle')
      rocket.classList.toggle('is-primary', visual.currentWeapon === 'rocket')
      soldierHelp.textContent = document.pointerLockElement === host.canvas
        ? 'WASD MOVE · MOUSE AIM · LEFT CLICK FIRE · SPACE HOP · 1 / 2 WEAPONS · V ORBIT · ESC UNLOCK'
        : 'CLICK BATTLE TO LOCK AIM · WASD MOVE · LEFT CLICK FIRE · SPACE HOP · 1 / 2 WEAPONS · V ORBIT'
      if (!playing) { held.clear(); mouseFiring = false; visual.setFiring(false); visual.setMovement(0, 0, 0); updateZoom() }
    }
    updateZoom()

    function updateKills(): void {
      if (!visual.isPlaying) return
      const label = `${visual.enemyTeam?.toUpperCase()} ELIMINATED  ${visual.enemyKills}`
      if (killLabel.textContent !== label) killLabel.textContent = label
    }

    function lockAim(): void {
      if (!visual.isPlaying || !host.isInteractive() || !window.matchMedia('(pointer: fine)').matches || document.pointerLockElement === host.canvas) return
      try { void Promise.resolve(host.canvas.requestPointerLock()).catch(() => { syncMode() }) }
      catch { syncMode() }
    }
    function releaseAim(): void {
      if (document.pointerLockElement === host.canvas) document.exitPointerLock()
    }
    const pointerLockChange = (): void => {
      if (document.pointerLockElement !== host.canvas) { mouseFiring = false; syncMovement() }
      syncMode()
    }
    document.addEventListener('pointerlockchange', pointerLockChange)

    const keys = new Set<string>()
    function syncMovement(): void {
      if (!visual.isPlaying || !host.isInteractive()) { visual.setMovement(0, 0, 0); visual.setFiring(false); return }
      const forward = Number(keys.has('KeyW') || keys.has('ArrowUp') || held.has('forward')) - Number(keys.has('KeyS') || keys.has('ArrowDown') || held.has('back'))
      const strafe = Number(keys.has('KeyD') || held.has('right')) - Number(keys.has('KeyA') || held.has('left'))
      const turn = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'))
      visual.setMovement(forward, strafe, turn)
      visual.setFiring(held.has('fire') || mouseFiring)
    }
    const keyDown = (event: KeyboardEvent): void => {
      if (!visual.isPlaying || !host.isInteractive() || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault()
      if (event.code === 'Space' && !event.repeat) visual.jump()
      if (event.code === 'Digit1') { visual.equip('rifle'); syncMode() }
      if (event.code === 'Digit2') { visual.equip('rocket'); syncMode() }
      if (event.code === 'KeyV') { releaseAim(); visual.leaveSoldier(); syncMode(); return }
      keys.add(event.code)
      syncMovement()
    }
    const keyUp = (event: KeyboardEvent): void => { keys.delete(event.code); syncMovement() }
    const blur = (): void => { keys.clear(); held.clear(); mouseFiring = false; visual.setMovement(0, 0, 0); visual.setFiring(false) }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', blur)

    const pointers = new Map<number, { x: number; y: number }>()
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y)
    const pointerDown = (event: PointerEvent): void => {
      if (!host.isInteractive()) return
      if (visual.isPlaying && event.pointerType === 'mouse') {
        if (document.pointerLockElement !== host.canvas) lockAim()
        if (event.button === 0) { mouseFiring = true; syncMovement() }
        return
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      host.canvas.setPointerCapture(event.pointerId)
    }
    const pointerMove = (event: PointerEvent): void => {
      if (!host.isInteractive()) return
      if (visual.isPlaying && document.pointerLockElement === host.canvas) {
        visual.aim(event.movementX, event.movementY)
        return
      }
      const previous = pointers.get(event.pointerId)
      if (!previous) return
      const current = { x: event.clientX, y: event.clientY }
      if (visual.isPlaying) visual.aim(current.x - previous.x, current.y - previous.y)
      else if (pointers.size === 1) visual.orbit(current.x - previous.x, current.y - previous.y)
      else if (pointers.size === 2) {
        const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1]
        if (other) { visual.zoom((distance(previous, other) - distance(current, other)) * 2); updateZoom() }
      }
      pointers.set(event.pointerId, current)
    }
    const pointerEnd = (event: PointerEvent): void => {
      if (visual.isPlaying && event.pointerType === 'mouse') { mouseFiring = false; syncMovement(); return }
      pointers.delete(event.pointerId)
      if (host.canvas.hasPointerCapture(event.pointerId)) host.canvas.releasePointerCapture(event.pointerId)
    }
    const wheel = (event: WheelEvent): void => {
      if (!host.isInteractive()) return
      event.preventDefault()
      visual.zoom(event.deltaY)
      updateZoom()
    }
    const contextMenu = (event: MouseEvent): void => { if (visual.isPlaying) event.preventDefault() }
    const mouseUp = (): void => { if (mouseFiring) { mouseFiring = false; syncMovement() } }
    host.canvas.addEventListener('pointerdown', pointerDown)
    host.canvas.addEventListener('pointermove', pointerMove)
    host.canvas.addEventListener('pointerup', pointerEnd)
    host.canvas.addEventListener('pointercancel', pointerEnd)
    host.canvas.addEventListener('wheel', wheel, { passive: false })
    host.canvas.addEventListener('contextmenu', contextMenu)
    window.addEventListener('mouseup', mouseUp)

    let disposed = false
    return {
      scene: visual.scene,
      camera: visual.camera,
      update(dt: number) { if (!host.isInteractive()) { releaseAim(); syncMovement() } visual.update(dt); updateKills() },
      dispose() {
        if (disposed) return
        disposed = true
        releaseAim()
        host.canvas.removeEventListener('pointerdown', pointerDown)
        host.canvas.removeEventListener('pointermove', pointerMove)
        host.canvas.removeEventListener('pointerup', pointerEnd)
        host.canvas.removeEventListener('pointercancel', pointerEnd)
        host.canvas.removeEventListener('wheel', wheel)
        host.canvas.removeEventListener('contextmenu', contextMenu)
        window.removeEventListener('mouseup', mouseUp)
        window.removeEventListener('keydown', keyDown)
        window.removeEventListener('keyup', keyUp)
        window.removeEventListener('blur', blur)
        document.removeEventListener('pointerlockchange', pointerLockChange)
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
