const VISIBLE_MS = 2600
const FADE_MS = 350

/** The "System Unlocked" banner. Unlocks that arrive together are shown one after another. */
export class SystemUnlock {
  private readonly root: HTMLDivElement
  private readonly name: HTMLDivElement
  private readonly queue: string[] = []
  private busy = false
  private timer: number | undefined

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'unlock'

    const label = document.createElement('div')
    label.className = 'unlock-label'
    label.textContent = 'System unlocked'

    this.name = document.createElement('div')
    this.name.className = 'unlock-name'

    this.root.append(label, this.name)
    parent.append(this.root)
  }

  show(systemName: string): void {
    this.queue.push(systemName)
    if (!this.busy) this.next()
  }

  dispose(): void {
    window.clearTimeout(this.timer)
    this.queue.length = 0
    this.root.remove()
  }

  private next(): void {
    const systemName = this.queue.shift()
    if (systemName === undefined) {
      this.busy = false
      return
    }

    this.busy = true
    this.name.textContent = systemName
    this.root.classList.add('visible')

    this.timer = window.setTimeout(() => {
      this.root.classList.remove('visible')
      // Wait for the fade-out before the next banner fades in.
      this.timer = window.setTimeout(() => this.next(), FADE_MS)
    }, VISIBLE_MS)
  }
}
