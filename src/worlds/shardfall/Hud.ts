import { WEAPONS, type CityDefinition, type CityId, type ShardfallActions, type ShardfallState, type ViewLevel, type WeaponId } from './types.ts'
import './shardfall.css'

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function svg(paths: string, viewBox = '0 0 40 40'): string {
  return `<svg viewBox="${viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
}

const ICONS = {
  impact: svg('<path d="m12 25 13-13 7-3-3 7-13 13-4-4Z"/><path d="m17 20 3 3M13 24H7l5-5m5 9v6l5-5M8 28l-3 7 7-3"/>'),
  cluster: svg('<path d="m10 19 8-8 6-2-2 6-8 8-4-4Zm5 10 8-8 6-2-2 6-8 8-4-4Zm11-16 5-5 5-1-1 5-5 5-4-4Z"/><path d="m7 23-3 5m7 3-3 5m14-20-3 3"/>'),
  drill: svg('<path d="m12 27 9-9 6 6-9 9-6-6Zm9-9 6-9 5-1-1 5-4 11M9 30l-4 5m11-13 6 6m2-14 5 5"/><path d="M3 21h6m20 11v5M5 26h2"/>'),
  laser: svg('<path d="m6 29 7-7 5 5-7 7-5-5Zm7-7 5-5 5 5-5 5M23 17 34 6m-7 13 9-9M21 14l9-9"/><path d="M30 27v6m-3-3h6M7 8v6m-3-3h6"/>'),
  pulse: svg('<path d="m6 27 7-7 7 7-7 7-7-7Zm7-7 5-5 7 7-5 5M21 10a13 13 0 0 1 9 9M24 5a20 20 0 0 1 11 11"/><path d="m22 18 2-2M6 34l-2 2"/>'),
  sound: svg('<path d="M8 16h7l8-7v22l-8-7H8V16Zm20-2a10 10 0 0 1 0 12m4-17a17 17 0 0 1 0 22"/>'),
  muted: svg('<path d="M8 16h7l8-7v22l-8-7H8V16Zm20 0 8 8m0-8-8 8"/>'),
  pause: svg('<path d="M14 10v20m12-20v20" stroke-width="4"/>'),
  play: svg('<path d="m14 9 17 11-17 11V9Z"/>'),
  exit: svg('<path d="M24 10h9v20h-9M8 20h18M8 20l7-7M8 20l7 7"/>'),
  reset: svg('<path d="M10 13a13 13 0 1 1-2 13M10 6v9h9"/>'),
  fire: svg('<circle cx="20" cy="20" r="9"/><path d="M20 4v7m0 18v7M4 20h7m18 0h7"/><circle cx="20" cy="20" r="2" fill="currentColor" stroke="none"/>'),
  orbit: svg('<circle cx="20" cy="20" r="7"/><ellipse cx="20" cy="20" rx="17" ry="7" transform="rotate(-35 20 20)"/>'),
  city: svg('<path d="M7 32V17h8v15m0-21h10v21m0-12h8v12M5 32h30M20 6v5m-2 5h4m-4 5h4m-4 5h4"/>'),
  street: svg('<path d="m12 34 5-28m6 0 5 28M4 6v28m32-28v28M20 9v5m0 7v5m0 5v3M4 13h6m20 0h6M4 23h5m22 0h5"/>'),
} satisfies Record<string, string>

const SKYLINES: Record<CityId, string> = {
  'neon-rift': '<path d="M2 37h60M5 36V19h8v17m3 0V10h10v26m4 0V24h8v12m3 0V5h9v31m4 0V16h7v20M19 14h4m-4 6h4m-4 6h4m-2-16V4m25 1V1M42 12h6m-6 7h6M12 28h5m9-8h15m9 8h5"/><path d="M30 39v3m8-3v3" opacity=".5"/>',
  'dune-halo': '<path d="M2 37h60M8 36l6-17 6 17M24 36l6-27 6 27m-6-27V2m12 34 5-17 5 17"/><ellipse cx="31" cy="18" rx="24" ry="6"/><path d="M58 36a16 16 0 0 1-6-30 17 17 0 0 0 6 30Z"/>',
  tideglass: '<path d="M4 30h56M7 30V18a7 7 0 0 1 14 0v12m5 0V9a8 8 0 0 1 16 0v21m6 0V18a6 6 0 0 1 12 0v12M26 15h16M7 22h14m27 0h12M10 30v5m24-5v5m20-5v5M2 38c5-5 10 5 15 0s10 5 15 0 10 5 15 0 10 5 15 0"/>',
  cloudstack: '<path d="m4 24 14 2 8-4-4 9-10 3-8-10Zm33-12 22 2-5 8-9 3-8-13ZM9 25V12h6v13m2-1V7h5v16m20-10V4h6v9m3 0V1h5v13M24 25l16-8M20 36l25-5 12 4-12 7-25-6Zm10-2v-8h6v7m7-2v-6h7v7"/>',
  'bloom-circuit': '<path d="M2 37h60M8 36V16a7 7 0 0 1 14 0v20m8 0V8a7 7 0 0 1 14 0v28m6 0V24a5 5 0 0 1 10 0v12M15 36V12m-4 9 4 4 5-5m17 16V8m-6 8 6 5 6-5M24 8c-8 0-9-5-9-5 7-3 9 5 9 5Zm23 15c0-7 7-9 7-9 1 7-7 9-7 9Z"/>',
  'ember-forge': '<path d="M2 37h60M5 36V24l9-6 9 6v12m4 0V17l8-5 8 5v19m4 0V25l7-6 7 6v11M11 20V9h5v11m16-5V5h6v10M9 29h10m12-6h8m-8 6h8m12 0h7"/><path d="m7 5 4-4m7 4 4-4m20 4 4-4M3 41h12l4-3 7 4h12l5-4 7 4h12" opacity=".6"/>',
}

function iconButton(label: string, icon: string, onClick: () => void, className = ''): HTMLButtonElement {
  const button = element('button', `sf-icon-button ${className}`)
  button.type = 'button'
  button.innerHTML = icon
  button.setAttribute('aria-label', label)
  button.title = label
  button.addEventListener('click', onClick)
  return button
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text
}

function setPressed(node: HTMLButtonElement, pressed: boolean): void {
  const value = String(pressed)
  if (node.getAttribute('aria-pressed') !== value) node.setAttribute('aria-pressed', value)
}

/** A persistent DOM overlay; simulation updates only the readouts that changed. */
export class ShardfallHud {
  readonly element = element('div', 'shardfall-ui')
  private readonly cityButtons = new Map<CityId, HTMLButtonElement>()
  private readonly weaponButtons = new Map<WeaponId, HTMLButtonElement>()
  private readonly viewButtons = new Map<ViewLevel, HTMLButtonElement>()
  private readonly cityMenu = element('details', 'sf-city-menu')
  private readonly cityName = element('span', 'sf-active-city')
  private readonly citySubtitle = element('span', 'sf-city-subtitle')
  private readonly cityDescription = element('p', 'sf-city-description')
  private readonly planetValue = element('strong', 'sf-integrity-value', '100%')
  private readonly cityValue = element('strong', 'sf-integrity-value', '100%')
  private readonly planetMeter = element('div', 'sf-meter')
  private readonly cityMeter = element('div', 'sf-meter')
  private readonly weaponName = element('strong', 'sf-weapon-name', 'Impact')
  private readonly weaponDescription = element('span', 'sf-weapon-description')
  private readonly status = element('p', 'sf-status')
  private readonly destroyed = element('strong', '', '0')
  private readonly shots = element('strong', '', '0')
  private readonly zoom = element('input', 'sf-zoom-input')
  private readonly zoomValue = element('span', 'sf-zoom-value', 'ORBIT')
  private readonly heat = element('div', 'sf-heat-fill')
  private readonly heatLabel = element('span', 'sf-heat-label', 'READY')
  private readonly pause: HTMLButtonElement
  private readonly sound: HTMLButtonElement
  private readonly fire: HTMLButtonElement
  private readonly mediaQuery = window.matchMedia('(max-width: 700px)')
  private readonly onMediaChange = (): void => { this.cityMenu.open = !this.mediaQuery.matches }
  private lastCity?: CityId
  private lastWeapon?: WeaponId
  private lastPaused?: boolean
  private lastSound?: boolean

  constructor(private readonly cities: CityDefinition[], actions: ShardfallActions) {
    this.element.setAttribute('aria-label', 'Shardfall planet destruction controls')
    const heading = element('header', 'sf-heading')
    const eyebrow = element('p', 'sf-eyebrow', 'Planetary destruction sandbox')
    const title = element('h1', 'sf-title', 'SHARDFALL')
    const coordinates = element('p', 'sf-coordinates')
    coordinates.innerHTML = '<span class="sf-live-dot"></span> VESPER IX <span class="sf-coordinate-divider">/</span> SIX CITIES. ONE FRAGILE WORLD.'
    heading.append(eyebrow, title, coordinates)

    const utility = element('nav', 'sf-utility')
    utility.setAttribute('aria-label', 'World controls')
    this.sound = iconButton('Enable sound', ICONS.muted, actions.toggleSound)
    this.pause = iconButton('Pause simulation', ICONS.pause, actions.togglePause)
    const exit = iconButton('Exit Shardfall', ICONS.exit, actions.exit)
    utility.append(this.sound, this.pause, exit)

    this.cityMenu.open = !this.mediaQuery.matches
    const summary = element('summary', 'sf-city-summary')
    const summaryTitle = element('span', 'sf-section-label', '01 / DESTINATIONS')
    summary.append(summaryTitle, this.cityName, element('span', 'sf-disclosure', '+'))
    const cityGrid = element('div', 'sf-city-list')
    for (const [index, city] of cities.entries()) {
      const button = element('button', 'sf-city-button')
      button.type = 'button'
      button.style.setProperty('--city-color', city.color)
      button.setAttribute('aria-pressed', 'false')
      button.setAttribute('aria-label', `Travel to ${city.name}. ${city.subtitle}`)
      const preview = element('span', 'sf-city-preview')
      preview.innerHTML = svg(SKYLINES[city.id], '0 0 64 44')
      const text = element('span', 'sf-city-copy')
      text.append(element('strong', '', city.name), element('span', '', city.subtitle))
      button.append(preview, text, element('span', 'sf-city-number', String(index + 1).padStart(2, '0')))
      button.addEventListener('click', () => {
        actions.selectCity(city.id)
        if (this.mediaQuery.matches) this.cityMenu.open = false
      })
      cityGrid.append(button)
      this.cityButtons.set(city.id, button)
    }
    const cityNote = element('div', 'sf-city-note')
    cityNote.append(this.citySubtitle, this.cityDescription)
    this.cityMenu.append(summary, cityGrid, cityNote)

    const telemetry = element('aside', 'sf-telemetry')
    telemetry.setAttribute('aria-label', 'Destruction readout')
    telemetry.append(element('p', 'sf-section-label', '02 / SURFACE TELEMETRY'))
    for (const [label, value, meter] of [
      ['Planet integrity', this.planetValue, this.planetMeter],
      ['City integrity', this.cityValue, this.cityMeter],
    ] as const) {
      const row = element('div', 'sf-integrity')
      const labelRow = element('div', 'sf-integrity-label')
      labelRow.append(element('span', '', label), value)
      meter.setAttribute('role', 'meter')
      meter.setAttribute('aria-label', label)
      meter.setAttribute('aria-valuemin', '0')
      meter.setAttribute('aria-valuemax', '100')
      meter.setAttribute('aria-valuenow', '100')
      row.append(labelRow, meter)
      telemetry.append(row)
    }
    const stats = element('div', 'sf-stats')
    const debrisStat = element('span', '')
    debrisStat.append(this.destroyed, element('span', '', 'VOXELS LOST'))
    const shotStat = element('span', '')
    shotStat.append(this.shots, element('span', '', 'SHOTS FIRED'))
    stats.append(debrisStat, shotStat)
    const resets = element('div', 'sf-resets')
    for (const [label, callback] of [['Reset city', actions.resetCity], ['Reset planet', actions.resetPlanet]] as const) {
      const button = element('button', 'sf-reset', label)
      button.type = 'button'
      button.addEventListener('click', callback)
      resets.append(button)
    }
    telemetry.append(stats, resets)

    const navigation = element('div', 'sf-navigation')
    const views = element('div', 'sf-views')
    views.setAttribute('role', 'group')
    views.setAttribute('aria-label', 'Camera distance')
    for (const view of ['orbit', 'city', 'street'] as const) {
      const button = element('button', 'sf-view-button')
      button.type = 'button'
      button.innerHTML = ICONS[view]
      button.append(element('span', '', view))
      button.setAttribute('aria-pressed', String(view === 'orbit'))
      button.addEventListener('click', () => actions.setView(view))
      views.append(button)
      this.viewButtons.set(view, button)
    }
    const zoomControl = element('label', 'sf-zoom')
    zoomControl.append(element('span', 'sf-zoom-caption', 'ZOOM'), this.zoom, this.zoomValue)
    this.zoom.type = 'range'
    this.zoom.min = '0'
    this.zoom.max = '1'
    this.zoom.step = '0.005'
    this.zoom.value = '0'
    this.zoom.setAttribute('aria-label', 'Zoom from orbit into city streets')
    this.zoom.addEventListener('input', () => actions.setZoom(Number(this.zoom.value)))
    navigation.append(views, zoomControl)

    const armory = element('section', 'sf-armory')
    armory.setAttribute('aria-label', 'Weapon selection')
    const selected = element('div', 'sf-selected-weapon')
    const selectedCopy = element('div', 'sf-selected-copy')
    selectedCopy.append(element('span', 'sf-section-label', '03 / ORDNANCE'), this.weaponName, this.weaponDescription)
    const heatReadout = element('div', 'sf-heat')
    heatReadout.setAttribute('aria-label', 'Weapon heat')
    const heatTrack = element('span', 'sf-heat-track')
    heatTrack.append(this.heat)
    heatReadout.append(this.heatLabel, heatTrack)
    selected.append(selectedCopy, heatReadout)
    const weapons = element('div', 'sf-weapons')
    weapons.setAttribute('role', 'group')
    weapons.setAttribute('aria-label', 'Weapons, keyboard shortcuts 1 through 5')
    for (const weapon of WEAPONS) {
      const button = element('button', 'sf-weapon-button')
      button.type = 'button'
      button.style.setProperty('--weapon-color', weapon.color)
      button.setAttribute('aria-label', `${weapon.name}: ${weapon.description} Shortcut ${weapon.key}.`)
      button.setAttribute('aria-keyshortcuts', weapon.key)
      button.setAttribute('aria-pressed', String(weapon.id === 'impact'))
      button.title = `${weapon.label} · ${weapon.description}`
      const icon = element('span', 'sf-weapon-icon')
      icon.innerHTML = ICONS[weapon.id]
      button.append(element('span', 'sf-shortcut', weapon.key), icon, element('strong', '', weapon.name), element('span', 'sf-weapon-type', weapon.label))
      button.addEventListener('click', () => actions.selectWeapon(weapon.id))
      weapons.append(button)
      this.weaponButtons.set(weapon.id, button)
    }
    armory.append(selected, weapons)

    const controls = element('footer', 'sf-controls')
    controls.append(navigation, armory)
    const gestures = element('p', 'sf-gestures')
    gestures.innerHTML = '<span><b>CLICK</b> FIRE <i>·</i> <b>HOLD</b> LASER</span><span><b>RIGHT DRAG / ARROWS</b> ORBIT <i>·</i> <b>SCROLL</b> ZOOM</span>'
    controls.append(gestures)

    this.fire = iconButton('Fire selected weapon at screen center', ICONS.fire, actions.fire, 'sf-fire')
    this.fire.append(element('span', '', 'FIRE'), element('small', '', 'AT CENTER'))
    this.status.setAttribute('role', 'status')
    this.status.setAttribute('aria-live', 'polite')
    this.status.setAttribute('aria-atomic', 'true')
    const reticle = element('div', 'sf-reticle')
    reticle.setAttribute('aria-hidden', 'true')
    reticle.innerHTML = '<span></span><span></span><span></span><span></span>'
    this.element.append(heading, utility, this.cityMenu, telemetry, controls, this.fire, this.status, reticle)
    this.mediaQuery.addEventListener('change', this.onMediaChange)
  }

  update(state: ShardfallState): void {
    if (state.city !== this.lastCity) {
      const city = this.cities.find(candidate => candidate.id === state.city)
      for (const [id, button] of this.cityButtons) setPressed(button, id === state.city)
      if (city) {
        setText(this.cityName, city.name)
        setText(this.citySubtitle, city.subtitle)
        setText(this.cityDescription, city.description)
        this.element.style.setProperty('--city-accent', city.color)
      }
      this.lastCity = state.city
    }
    if (state.weapon !== this.lastWeapon) {
      const weapon = WEAPONS.find(candidate => candidate.id === state.weapon)
      for (const [id, button] of this.weaponButtons) setPressed(button, id === state.weapon)
      if (weapon) {
        setText(this.weaponName, weapon.name)
        setText(this.weaponDescription, weapon.description)
        this.element.style.setProperty('--weapon-accent', weapon.color)
      }
      this.lastWeapon = state.weapon
    }
    for (const [view, button] of this.viewButtons) setPressed(button, view === state.view)
    if (document.activeElement !== this.zoom && Math.abs(Number(this.zoom.value) - state.zoom) > 0.004) this.zoom.value = String(state.zoom)
    setText(this.zoomValue, state.view.toUpperCase())
    for (const [raw, value, meter] of [[state.integrity, this.planetValue, this.planetMeter], [state.cityIntegrity, this.cityValue, this.cityMeter]] as const) {
      const percent = Math.max(0, Math.min(100, Math.round(raw)))
      setText(value, `${percent}%`)
      if (meter.getAttribute('aria-valuenow') !== String(percent)) {
        meter.setAttribute('aria-valuenow', String(percent))
        meter.style.setProperty('--integrity', `${percent}%`)
        meter.classList.toggle('sf-critical', percent < 35)
      }
    }
    setText(this.destroyed, Math.max(0, Math.round(state.destroyed)).toLocaleString())
    setText(this.shots, String(Math.max(0, Math.round(state.shots))))
    setText(this.status, state.message)
    const heat = Math.max(0, Math.min(1, state.heat / 100))
    const heatPercent = `${Math.round(heat * 100)}%`
    if (this.heat.style.width !== heatPercent) this.heat.style.width = heatPercent
    setText(this.heatLabel, state.paused ? 'PAUSED' : heat > 0.92 ? 'COOLING' : heat > 0.05 ? 'HEAT' : 'READY')
    this.fire.disabled = state.paused
    if (state.paused !== this.lastPaused) {
      this.pause.innerHTML = state.paused ? ICONS.play : ICONS.pause
      this.pause.setAttribute('aria-label', state.paused ? 'Resume simulation' : 'Pause simulation')
      this.pause.title = state.paused ? 'Resume simulation' : 'Pause simulation'
      setPressed(this.pause, state.paused)
      this.element.classList.toggle('sf-paused', state.paused)
      this.lastPaused = state.paused
    }
    if (state.sound !== this.lastSound) {
      this.sound.innerHTML = state.sound ? ICONS.sound : ICONS.muted
      this.sound.setAttribute('aria-label', state.sound ? 'Mute sound' : 'Enable sound')
      this.sound.title = state.sound ? 'Mute sound' : 'Enable sound'
      setPressed(this.sound, state.sound)
      this.lastSound = state.sound
    }
  }

  dispose(): void {
    this.mediaQuery.removeEventListener('change', this.onMediaChange)
    this.element.remove()
  }
}
