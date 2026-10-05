import type { MissionProgress } from '../systems/MissionSystem.ts'
import type { NetworkStatus } from '../systems/NetworkSystem.ts'

const NETWORK_LABEL: Record<NetworkStatus, string> = {
  offline: 'Offline',
  connecting: 'Connecting…',
  online: 'Online',
}

const CONTROLS = 'WASD move · E interact · Space pulse (hold to fire in waves) · Tab portfolio · T theme · P sound'

/** The always-on overlay: missions, network status, interaction prompt and pulse meter. */
export class HUD {
  private readonly root: HTMLDivElement
  private readonly missionList: HTMLUListElement
  private readonly network: HTMLSpanElement
  private readonly prompt: HTMLDivElement
  private readonly pulse: HTMLDivElement
  private readonly pulseFill: HTMLDivElement

  // Last values written, so the per-frame setters only touch the DOM when something changed.
  private promptText: string | null = null
  private pulseCharge = -1

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'hud'

    const missions = document.createElement('section')
    missions.className = 'hud-panel hud-missions'
    const heading = document.createElement('h2')
    heading.textContent = 'Missions'
    this.missionList = document.createElement('ul')
    missions.append(heading, this.missionList)

    const status = document.createElement('div')
    status.className = 'hud-panel hud-status'
    const statusLabel = document.createElement('span')
    statusLabel.className = 'hud-label'
    statusLabel.textContent = 'Network'
    this.network = document.createElement('span')
    status.append(statusLabel, this.network)

    this.prompt = document.createElement('div')
    this.prompt.className = 'hud-prompt'

    this.pulse = document.createElement('div')
    this.pulse.className = 'hud-pulse'
    const pulseLabel = document.createElement('span')
    pulseLabel.textContent = '[Space] Pulse'
    const bar = document.createElement('div')
    bar.className = 'hud-bar'
    this.pulseFill = document.createElement('div')
    bar.append(this.pulseFill)
    this.pulse.append(pulseLabel, bar)

    const controls = document.createElement('div')
    controls.className = 'hud-controls'
    controls.textContent = CONTROLS

    this.root.append(missions, status, this.prompt, this.pulse, controls)
    parent.append(this.root)
  }

  setMissions(missions: readonly MissionProgress[]): void {
    this.missionList.replaceChildren(
      ...missions.map((mission) => {
        const item = document.createElement('li')
        item.classList.toggle('complete', mission.complete)

        const title = document.createElement('span')
        title.textContent = mission.title

        const count = document.createElement('span')
        count.className = 'count'
        count.textContent = `${mission.current}/${mission.target}`

        item.append(title, count)
        return item
      }),
    )
  }

  setNetworkStatus(status: NetworkStatus): void {
    this.network.textContent = NETWORK_LABEL[status]
    this.network.dataset.status = status
  }

  /** Pass null to hide the prompt. */
  setPrompt(text: string | null): void {
    if (text === this.promptText) return
    this.promptText = text

    if (text !== null) this.prompt.textContent = text
    this.prompt.classList.toggle('visible', text !== null)
  }

  /** 1 just after firing, 0 when ready - as CombatSystem.cooldownFraction reports it. */
  setPulseCooldown(fraction: number): void {
    const charge = Math.round((1 - fraction) * 100) / 100
    if (charge === this.pulseCharge) return
    this.pulseCharge = charge

    this.pulseFill.style.transform = `scaleX(${charge})`
    this.pulse.classList.toggle('ready', charge >= 1)
  }

  dispose(): void {
    this.root.remove()
  }
}
