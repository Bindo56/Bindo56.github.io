const NORMAL_DURATION_MS = 2000
const REDUCED_DURATION_MS = 320

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
    tunnel.append(element('div', 'bitroom-portal-aperture'))
    for (let index = 0; index < 5; index++) {
      const ring = element('span', 'bitroom-portal-ring')
      ring.style.setProperty('--ring-index', String(index))
      tunnel.append(ring)
    }

    const codes = element('div', 'bitroom-portal-codes')
    for (let index = 0; index < 3; index++) {
      const code = element('span', 'bitroom-portal-code', '01010110')
      code.style.setProperty('--code-index', String(index))
      codes.append(code)
    }

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
      codes,
      board,
      element('span', 'bitroom-portal-caption', 'TRANSLATING 64 BITS INTO SPACE'),
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
