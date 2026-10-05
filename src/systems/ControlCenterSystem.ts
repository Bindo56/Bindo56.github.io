
import type { Input } from '../core/Input.ts'
import type { PlayerController } from '../player/PlayerController.ts'
import type { Project } from '../data/projects.ts'
import { ProjectPillar } from '../world/ProjectPillar.ts'
import { ControlCenterHUD } from '../ui/ControlCenterHUD.ts'
import type { ControlCenter } from '../world/ControlCenter.ts'
import type { AudioManager } from '../core/AudioManager.ts'

export class ControlCenterSystem {
  private readonly input: Input
  private readonly controller: PlayerController
  private readonly audio: AudioManager
  private readonly hud: ControlCenterHUD
  private readonly center: ControlCenter
  
  private active = false
  private projects: readonly Project[] = []
  private pillars: ProjectPillar[] = []
  private currentIndex = 0
  
  private readonly viewCallback: (project: Project, index: number) => void

  constructor(
    input: Input,
    controller: PlayerController,
    audio: AudioManager,
    hud: ControlCenterHUD,
    center: ControlCenter,
    projects: readonly Project[],
    viewCallback: (project: Project, index: number) => void
  ) {
    this.input = input
    this.controller = controller
    this.audio = audio
    this.hud = hud
    this.center = center
    this.projects = projects
    this.viewCallback = viewCallback
    
    // Create pillars for all projects but keep them hidden initially
    this.projects.forEach((project, _i) => {
      // The interact function isn't needed since we intercept F
      const pillar = new ProjectPillar(project, { x: 0, z: 0 }, (_interactable) => {})
      
      // We only want the visual core of the pillar, so we take the object
      // Scale it down so it fits nicely on the desk
      pillar.object.scale.set(0.6, 0.6, 0.6)
      pillar.object.visible = false
      
      this.pillars.push(pillar)
      this.center.displayGroup.add(pillar.object)
    })
  }

  get isActive(): boolean {
    return this.active
  }

  activate(): void {
    if (this.active) return
    this.active = true
    this.controller.enabled = false
    this.currentIndex = 0
    
    this.audio.play('interact')
    this.updateDisplay()
    this.hud.show()
  }

  deactivate(): void {
    if (!this.active) return
    this.active = false
    this.controller.enabled = true
    
    // Hide all pillars
    this.pillars.forEach(p => p.object.visible = false)
    this.hud.hide()
  }

  update(dt: number): void {
    if (!this.active) return
    
    // Animate the active pillar
    const activePillar = this.pillars[this.currentIndex]
    if (activePillar) {
      activePillar.core.rotation.y += 1.2 * dt
      activePillar.core.position.y = Math.sin(performance.now() / 1000 * 3) * 0.15 + 1.5
    }

    // Input handling
    if (this.input.consume('Escape')) {
      this.deactivate()
      return
    }

    if (this.input.consume('KeyQ')) {
      this.audio.play('interact')
      this.currentIndex = (this.currentIndex - 1 + this.projects.length) % this.projects.length
      this.updateDisplay()
    }

    if (this.input.consume('KeyE')) {
      this.audio.play('interact')
      this.currentIndex = (this.currentIndex + 1) % this.projects.length
      this.updateDisplay()
    }

    if (this.input.consume('KeyF')) {
      this.audio.play('interact')
      const project = this.projects[this.currentIndex]
      this.viewCallback(project, this.currentIndex)
    }
  }

  private updateDisplay(): void {
    this.pillars.forEach((p, i) => {
      p.object.visible = (i === this.currentIndex)
    })
    
    const project = this.projects[this.currentIndex]
    this.hud.setProjectName(project.title)
  }
}
