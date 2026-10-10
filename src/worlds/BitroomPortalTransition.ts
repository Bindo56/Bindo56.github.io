const NORMAL_DURATION_MS = 2000
const REDUCED_DURATION_MS = 320

const STREAK_COLORS = ['#99f7fb', '#e5a3e9', '#ffdfa0', '#b5d7ff', '#d8f6bd'] as const

const BINARY_STREAMS = [
  { angle: -156, delay: -120, digits: '01010110' },
  { angle: -122, delay: -430, digits: '101001' },
  { angle: -62, delay: -230, digits: '0010110' },
  { angle: -28, delay: -620, digits: '010101' },
  { angle: 24, delay: -350, digits: '1100101' },
  { angle: 55, delay: -690, digits: '010110' },
  { angle: 118, delay: -510, digits: '1010110' },
  { angle: 153, delay: -40, digits: '001101' },
] as const

const BOARD_ROWS = [
  '01010110',
  '10100101',
  '01101001',
  '11000011',
  '00111100',
  '10010110',
  '10100101',
  '01010110',
] as const

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** One reusable DOM overlay for the BitRoom arrival cutscene. */
export class BitroomPortalTransition {
  readonly element: HTMLElement

  private timer: number | null = null
  private resolvePending: (() => void) | null = null
  private runId = 0
  private disposed = false
  private announcement: HTMLElement

  constructor() {
    const root = element('div', 'bitroom-portal')
    root.hidden = true
    root.setAttribute('role', 'status')
    root.setAttribute('aria-live', 'polite')
    root.dataset.testid = 'bitroom-portal'

    this.announcement = element('span', 'bitroom-portal-sr-only')

    const artwork = element('div', 'bitroom-portal-artwork')
    artwork.setAttribute('aria-hidden', 'true')
    artwork.append(element('div', 'bitroom-portal-field'))

    const tunnel = element('div', 'bitroom-portal-tunnel')
    const ribbons = element('div', 'bitroom-portal-ribbons')
    for (let index = 0; index < 12; index++) {
      const ribbon = element('span', 'bitroom-portal-ribbon')
      ribbon.style.setProperty('--angle', `${(index * 137.5 + 18) % 360}deg`)
      ribbon.style.setProperty('--tone', STREAK_COLORS[index % STREAK_COLORS.length] ?? '#99f7fb')
      ribbon.style.setProperty('--delay', `${-index * 91}ms`)
      ribbon.style.setProperty('--thickness', `${2 + index % 4}vmax`)
      ribbons.append(ribbon)
    }

    const streaks = element('div', 'bitroom-portal-streaks')
    for (let index = 0; index < 56; index++) {
      const streak = element('span', 'bitroom-portal-streak')
      streak.style.setProperty('--angle', `${(index * 137.5) % 360}deg`)
      streak.style.setProperty('--tone', STREAK_COLORS[index % STREAK_COLORS.length] ?? '#99f7fb')
      streak.style.setProperty('--delay', `${-((index * 173) % 1060)}ms`)
      streak.style.setProperty('--duration', `${800 + (index * 67) % 480}ms`)
      streak.style.setProperty('--thickness', `${index % 9 === 0 ? 4 : index % 3 === 0 ? 2 : 1}px`)
      streaks.append(streak)
    }

    const codes = element('div', 'bitroom-portal-codes')
    for (const stream of BINARY_STREAMS) {
      const code = element('span', 'bitroom-portal-code', stream.digits)
      code.style.setProperty('--angle', `${stream.angle}deg`)
      code.style.setProperty('--delay', `${stream.delay}ms`)
      codes.append(code)
    }

    tunnel.append(ribbons, streaks, codes, element('div', 'bitroom-portal-core'))

    const ship = element('div', 'bitroom-portal-ship')
    ship.append(
      element('span', 'bitroom-portal-ship-hull'),
      element('span', 'bitroom-portal-ship-engine is-left'),
      element('span', 'bitroom-portal-ship-engine is-right'),
    )

    const board = element('div', 'bitroom-portal-board')
    board.append(element('span', 'bitroom-portal-board-label', 'ARRIVAL // 64-BIT ROOM'))
    const grid = element('div', 'bitroom-portal-grid')
    for (const row of BOARD_ROWS) {
      for (const digit of row) {
        grid.append(element('span', digit === '1' ? 'bitroom-portal-bit is-on' : 'bitroom-portal-bit', digit))
      }
    }
    board.append(grid, element('span', 'bitroom-portal-board-footer', '01010110 / SIGNAL LOCKED'))

    artwork.append(
      element('span', 'bitroom-portal-heading', 'BITROOM // ENTRY SEQUENCE'),
      tunnel,
      ship,
      board,
      element('span', 'bitroom-portal-caption', 'SPACE TO BITROOM // 64-BIT TRANSIT'),
    )
    root.append(this.announcement, artwork)
    this.element = root
  }

  play(reducedMotion: boolean): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.cancel()

    const run = ++this.runId
    this.element.hidden = false
    this.element.classList.toggle('is-reduced', reducedMotion)
    this.announcement.textContent = 'Entering BitRoom'

    // Restart CSS keyframes if arrival is retriggered without rebuilding the overlay.
    void this.element.offsetWidth
    this.element.classList.add('is-active')

    return new Promise<void>(resolve => {
      this.resolvePending = resolve
      this.timer = window.setTimeout(() => {
        if (run === this.runId) this.cancel()
      }, reducedMotion ? REDUCED_DURATION_MS : NORMAL_DURATION_MS)
    })
  }

  cancel(): void {
    this.runId++
    if (this.timer !== null) {
      window.clearTimeout(this.timer)
      this.timer = null
    }
    this.element.classList.remove('is-active', 'is-reduced')
    this.element.hidden = true
    this.announcement.textContent = ''
    const resolve = this.resolvePending
    this.resolvePending = null
    resolve?.()
  }

  dispose(): void {
    if (this.disposed) return
    this.cancel()
    this.disposed = true
    this.element.remove()
  }
}
