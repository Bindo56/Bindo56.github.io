import { WAVES, WAVE_RULES, WEAPONS } from '../data/waves.ts'
import type { WaveSystem } from '../systems/WaveSystem.ts'

/** The wave mode's overlay: wave, weapon, enemies left and health up top, and a banner for what is happening. */
export class WaveHUD {
  private readonly root: HTMLDivElement
  private readonly wave: HTMLSpanElement
  private readonly weapon: HTMLSpanElement
  private readonly remaining: HTMLSpanElement
  private readonly healthFill: HTMLDivElement
  private readonly healthText: HTMLSpanElement
  private readonly banner: HTMLDivElement

  /** Last text written, per element, so the per-frame update only touches the DOM on a change. */
  private readonly written = new Map<HTMLElement, string>()
  private hurtUntil = 0

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'wave-hud'
    this.root.hidden = true

    const panel = document.createElement('div')
    panel.className = 'wave-panel'

    const top = document.createElement('div')
    top.className = 'wave-top'
    this.wave = document.createElement('span')
    this.wave.className = 'wave-number'
    this.weapon = document.createElement('span')
    this.weapon.className = 'wave-weapon'
    this.remaining = document.createElement('span')
    this.remaining.className = 'wave-remaining'
    top.append(this.wave, this.weapon, this.remaining)

    const health = document.createElement('div')
    health.className = 'wave-health'
    this.healthFill = document.createElement('div')
    this.healthText = document.createElement('span')
    health.append(this.healthFill, this.healthText)

    panel.append(top, health)

    this.banner = document.createElement('div')
    this.banner.className = 'wave-banner'

    this.root.append(panel, this.banner)
    parent.append(this.root)
  }

  /** A red flash on the health bar. */
  flashHurt(): void {
    this.hurtUntil = performance.now() + 180
  }

  update(waves: WaveSystem): void {
    this.root.hidden = waves.phase === 'idle'
    if (this.root.hidden) return

    const weapon = WEAPONS[waves.weapon]
    this.write(this.wave, `WAVE ${waves.wave + 1} / ${WAVES.length}`)
    this.write(this.weapon, weapon.name)
    this.weapon.style.color = `#${weapon.color.toString(16).padStart(6, '0')}`
    this.write(this.remaining, waves.phase === 'fighting' ? `${waves.remaining} left` : '')

    const health = Math.ceil(waves.playerHealth)
    this.healthFill.style.transform = `scaleX(${waves.playerHealth / WAVE_RULES.playerHealth})`
    this.write(this.healthText, `${health} / ${WAVE_RULES.playerHealth}`)
    this.healthFill.classList.toggle('hurt', performance.now() < this.hurtUntil)

    const countdown = Math.ceil(waves.timer)
    const banner =
      waves.phase === 'breather' ? `Wave ${waves.wave + 1} · ${weapon.name} · ${countdown}`
      : waves.phase === 'victory' ? 'Victory! All waves cleared'
      : waves.phase === 'defeat' ? `Defeated on wave ${waves.wave + 1}`
      : ''
    this.write(this.banner, banner)
    this.banner.classList.toggle('visible', banner.length > 0)
  }

  dispose(): void {
    this.root.remove()
  }

  private write(element: HTMLElement, text: string): void {
    if (this.written.get(element) === text) return
    this.written.set(element, text)
    element.textContent = text
  }
}
