import * as THREE from 'three'
import { AudioManager } from './AudioManager.ts'
import { Input } from './Input.ts'
import { Renderer } from './Renderer.ts'
import { experience } from '../data/experience.ts'
import { projects, type Project } from '../data/projects.ts'
import { ENEMIES, WAVES, WEAPONS } from '../data/waves.ts'
import { Player } from '../player/Player.ts'
import { PlayerController } from '../player/PlayerController.ts'
import { AISystem } from '../systems/AISystem.ts'
import { AnimationSystem } from '../systems/AnimationSystem.ts'
import { CombatSystem } from '../systems/CombatSystem.ts'
import { MissionSystem } from '../systems/MissionSystem.ts'
import { NetworkSystem } from '../systems/NetworkSystem.ts'
import { SlideSystem } from '../systems/SlideSystem.ts'
import { WaveSystem, type WaveEvent } from '../systems/WaveSystem.ts'
import { ControlCenterSystem } from '../systems/ControlCenterSystem.ts'
import { HUD } from '../ui/HUD.ts'
import { MediaPopup } from '../ui/MediaPopup.ts'
import { PortfolioMenu } from '../ui/PortfolioMenu.ts'
import { SystemUnlock } from '../ui/SystemUnlock.ts'
import { WaveHUD } from '../ui/WaveHUD.ts'
import { ControlCenterHUD } from '../ui/ControlCenterHUD.ts'
import { ExperienceSlide, experienceAccent } from '../world/ExperienceSlide.ts'
import { Interactable } from '../world/Interactable.ts'
import { WaveArena } from '../world/WaveArena.ts'
import { World } from '../world/World.ts'
import { ControlCenter } from '../world/ControlCenter.ts'

const MISSION_PROJECTS = 'inspect-projects'
const MISSION_SENTINELS = 'disable-sentinels'
const MISSION_WAVES = 'survive-waves'

/** Where the player begins. */
const START = new THREE.Vector3(0, 0, 0)



/**
 * The slide tells the career in order: the earliest (contract) work at the top, the present at the last
 * stop. The data file lists newest first, as the portfolio menu shows it.
 */
const CAREER_OLDEST_FIRST = [...experience].reverse()

/** The swarm arena, off to the right of the avenue, and the sign by which the waves are started. */
const ARENA_CENTER = { x: 26, z: -10 }
const ARENA_GATE = { x: 12, z: -1 }

/** Fixed positions for the freely-roaming sentinels that guard the arena perimeter. */
const ROAMING_SENTINELS: readonly { x: number; z: number }[] = [
  { x: -18, z: -10 },
  { x:  10, z: -28 },
  { x:  20, z:  12 },
]

/**
 * The longest step a single frame may take, in seconds. A tab that sat in the background comes back
 * with a delta of many seconds, which would otherwise teleport everything that moves.
 */
const MAX_DT = 0.1

/** Where the Control Center console is placed in the world. */
const CONTROL_CENTER_POS = { x: 0, z: -8 }

/** Owns every subsystem, wires them together, and runs the frame loop. */
export class Game {
  private readonly renderer: Renderer
  private readonly input = new Input()
  private readonly audio = new AudioManager()
  private readonly world = new World()
  private readonly player = new Player()
  private readonly controller: PlayerController

  private readonly animation = new AnimationSystem()
  private readonly combat = new CombatSystem()
  private readonly ai: AISystem
  private readonly missions = new MissionSystem()
  private readonly network = new NetworkSystem()

  private readonly ui: HTMLDivElement
  private readonly hud: HUD
  /** The big popup, for both projects and slide stops. */
  private readonly popup: MediaPopup
  private readonly unlock: SystemUnlock
  private readonly menu: PortfolioMenu

  /** Null when there is no experience to put on it. */
  private slide: ExperienceSlide | null = null
  private slideRide: SlideSystem | null = null

  private readonly waves: WaveSystem
  private readonly arena: WaveArena
  private readonly waveHud: WaveHUD
  private readonly ccHud: ControlCenterHUD
  private readonly burstPoint = new THREE.Vector3()
  private controlCenterSystem: ControlCenterSystem | null = null

  private readonly visited = new Set<Project>()
  private readonly unsubscribers: (() => void)[] = []
  private running = false
  private lastTime = 0

  constructor(root: HTMLElement) {
    this.renderer = new Renderer(root)

    // Added after the canvas, so everything in it draws on top of the scene.
    this.ui = document.createElement('div')
    this.ui.className = 'ui-layer'
    root.append(this.ui)

    this.player.position.copy(START)
    this.world.add(this.player.object)
    this.controller = new PlayerController(this.player, this.input, this.world)
    this.ai = new AISystem(this.world, this.animation, this.player.object)
    this.waves = new WaveSystem(ARENA_CENTER, (point, radius) => {
      this.world.resolveCollisions(point, radius)
      this.world.clampToBounds(point)
    })
    this.arena = new WaveArena(ARENA_CENTER, ARENA_GATE)

    this.hud = new HUD(this.ui)
    this.waveHud = new WaveHUD(this.ui)
    this.ccHud = new ControlCenterHUD(this.ui)
    this.popup = new MediaPopup(this.ui, this.input)
    this.unlock = new SystemUnlock(this.ui)
    this.menu = new PortfolioMenu(this.ui, this.input, projects, experience)

    this.setUpMissions()
    this.buildWorld()
    this.connectNetwork()

    this.renderer.snapTo(this.player.position)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.lastTime = performance.now()
    this.renderer.webgl.setAnimationLoop(this.frame)
  }

  stop(): void {
    this.running = false
    this.renderer.webgl.setAnimationLoop(null)
  }

  dispose(): void {
    this.stop()

    for (const unsubscribe of this.unsubscribers) unsubscribe()
    this.unsubscribers.length = 0

    this.network.dispose()
    this.hud.dispose()
    this.waveHud.dispose()
    this.popup.dispose()
    this.unlock.dispose()
    this.menu.dispose()
    this.ui.remove()

    this.slideRide?.dispose()
    this.slide?.dispose()
    this.arena.dispose()
    this.ai.dispose()
    this.combat.dispose()
    this.animation.dispose()
    this.missions.dispose()

    this.player.dispose()
    this.world.dispose()
    this.renderer.dispose()
    this.input.dispose()
    this.audio.dispose()
  }

  private readonly frame = (time: number): void => {
    const dt = Math.min((time - this.lastTime) / 1000, MAX_DT)
    this.lastTime = time

    this.update(dt)
    this.renderer.render(this.world.scene)
    this.input.endFrame()
  }

  private update(dt: number): void {
    // UI first: an open popup or menu claims its keys before the player can act on them.
    this.popup.update()
    if (!this.popup.isOpen) this.menu.update()

    const isBrowsing = this.controlCenterSystem?.isActive ?? false
    if (!this.popup.isOpen && isBrowsing) {
      this.controlCenterSystem?.update(dt)
    }

    const paused = this.popup.isOpen || this.menu.isOpen || isBrowsing
    this.controller.enabled = !paused && !(this.slideRide?.isRiding ?? false)

    this.controller.update(dt)
    if (!paused) this.slideRide?.update(dt)
    if (this.slide && this.slideRide) this.slide.ladderMarker.visible = !this.slideRide.isRiding

    // In a wave, Space held fires the wave's weapon; otherwise a press is the pulse.
    if (!paused && this.waves.phase !== 'idle') {
      const facing = this.player.object.rotation.y
      const fire = this.controller.enabled && this.input.isDown('Space')
      this.handleWaveEvents(this.waves.update(dt, { x: this.player.position.x, z: this.player.position.z, facing, fire }))
    }
    if (this.waves.isRunning) this.input.consume('Space')
    else if (this.controller.enabled && this.input.consume('Space')) this.firePulse()
    this.arena.sync(this.waves, dt, this.player.position)
    this.waveHud.update(this.waves)
    if (this.input.consume('KeyP')) this.audio.toggleMute()

    this.ai.update(dt)
    this.combat.update(dt)
    this.animation.update(dt)
    this.renderer.follow(this.player.position, dt)

    const focus = this.controller.enabled ? this.controller.focus : null
    this.hud.setPrompt(focus ? `[E] ${focus.prompt}` : null)
    this.hud.setPulseCooldown(this.combat.cooldownFraction)
  }

  private setUpMissions(): void {
    // Listeners before missions, so the HUD sees the very first state.
    this.unsubscribers.push(
      this.missions.onChange((missions) => this.hud.setMissions(missions)),
      this.missions.onComplete((mission) => {
        this.audio.play('unlock')
        this.unlock.show(mission.unlocks)
      }),
    )

    this.missions.add({
      id: MISSION_PROJECTS,
      title: 'Inspect every project',
      target: projects.length,
      unlocks: 'Project Archive',
    })
    this.missions.add({
      id: MISSION_SENTINELS,
      title: 'Disable the sentinels',
      target: ROAMING_SENTINELS.length,
      unlocks: 'Combat Module',
    })
    this.missions.add({
      id: MISSION_WAVES,
      title: 'Survive the swarm',
      target: WAVES.length,
      unlocks: 'Swarm Champion',
    })
  }

  private buildWorld(): void {
    // Place the single Control Center console.
    const center = new ControlCenter(CONTROL_CENTER_POS, () => {
      this.controlCenterSystem?.activate()
    })
    this.world.addInteractable(center)

    // Wire the Control Center system now that we have the console object.
    this.controlCenterSystem = new ControlCenterSystem(
      this.input,
      this.controller,
      this.audio,
      this.ccHud,
      center,
      projects,
      (project, index) => this.inspect(project, index),
    )

    // Three freely-roaming sentinels patrol the map independently of projects.
    ROAMING_SENTINELS.forEach((post, index) => {
      const sentinel = this.ai.spawn(post, 6, () => {
        this.audio.play('disable')
        this.missions.record(MISSION_SENTINELS, `sentinel-${index}`)
      })
      this.combat.register(sentinel)
    })

    this.buildSlide()
    this.buildArena()
  }

  private buildSlide(): void {
    if (CAREER_OLDEST_FIRST.length === 0) return

    // Place the slide fixed towards the back
    const slide = new ExperienceSlide(CAREER_OLDEST_FIRST, { x: 0, z: -35 })
    const ride = new SlideSystem(this.player, slide)
    this.slide = slide
    this.slideRide = ride
    this.world.add(slide.object)
    this.animation.bob(slide.ladderArrow, 0.35, 0.9)
    this.animation.pulseOpacity(slide.ladderHalo, slide.ladderHalo.material, 0.35, 0.9, 0.9)
    this.world.addColliders(...slide.colliders)

    this.world.addInteractable(new Interactable({
      id: 'experience-slide',
      label: 'Experience slide',
      prompt: 'Slide down and view experience',
      position: { x: slide.ladderFoot.x, z: slide.ladderFoot.z },
      radius: 2.5,
      onInteract: () => {
        // Not mid-wave: the swarm would be waiting at the bottom.
        if (this.waves.isRunning) return
        this.audio.play('interact')
        ride.begin()
      },
    }))

    this.unsubscribers.push(ride.onStop((index) => this.showExperience(index, () => ride.resume())))
  }

  private buildArena(): void {
    this.world.add(this.arena.object)
    this.world.addInteractable(new Interactable({
      id: 'swarm-arena',
      label: 'Swarm arena',
      prompt: 'Start the swarm waves',
      position: ARENA_GATE,
      radius: 2.5,
      onInteract: () => {
        if (this.waves.phase !== 'idle') return
        this.audio.play('interact')
        this.waves.start(Date.now())
      },
    }))
  }

  /** Sounds and effects for what the wave simulation reports. */
  private handleWaveEvents(events: readonly WaveEvent[]): void {
    this.arena.handle(events)

    for (const event of events) {
      switch (event.kind) {
        case 'fire':
          this.audio.play(event.weapon)
          // Face where the shot went.
          this.player.object.rotation.y = Math.atan2(event.dx, event.dz)
          break
        case 'burst':
          this.audio.play('burst')
          this.animation.ring(this.world.scene, this.burstPoint.set(event.x, 0, event.z), event.radius, WEAPONS.bomb.color)
          break
        case 'kill':
          this.animation.ring(this.world.scene, this.burstPoint.set(event.x, 0, event.z), ENEMIES[event.type].radius * 3, ENEMIES[event.type].color, 0.3)
          break
        case 'hurt':
          this.audio.play('hurt')
          this.waveHud.flashHurt()
          break
        case 'cleared':
          this.missions.record(MISSION_WAVES, `wave-${event.wave}`)
          break
        case 'phase':
          if (event.phase === 'breather') this.audio.play('wave')
          if (event.phase === 'defeat') {
            // Back to the arena's sign, to try again.
            this.player.position.set(ARENA_GATE.x, 0, ARENA_GATE.z + 2)
            this.renderer.snapTo(this.player.position)
          }
          break
        case 'spit':
        case 'hit':
          break
      }
    }
  }

  /** The popup at slide stop `index`, in its board's colour. Closing it calls `onClosed`. */
  private showExperience(index: number, onClosed: () => void): void {
    const entry = CAREER_OLDEST_FIRST[index]
    this.audio.play('popup')

    this.popup.open(
      {
        video: entry.video,
        // Not every job has a video: without one the popup has no video area, rather than a "coming soon" one.
        noVideoText: null,
        title: entry.role,
        subtitle: `${entry.company} · ${entry.period} · ${index + 1} of ${CAREER_OLDEST_FIRST.length}`,
        body: entry.highlights,
        bulleted: true,
        links: [{ label: 'Visit website ↗', href: entry.website ?? '' }],
        accent: experienceAccent(index),
        hint: index < CAREER_OLDEST_FIRST.length - 1 ? '[E] Slide on' : '[E] Finish the slide',
      },
      () => {
        this.audio.play('close')
        onClosed()
      },
    )
  }

  private connectNetwork(): void {
    this.unsubscribers.push(this.network.onStatus((status) => this.hud.setNetworkStatus(status)))
    this.hud.setNetworkStatus(this.network.status)

    // Optional presence/multiplayer server. Leave VITE_SERVER_URL unset and the game runs offline.
    const url: unknown = import.meta.env.VITE_SERVER_URL
    if (typeof url === 'string' && url.length > 0) this.network.connect(url)
  }

  private inspect(project: Project, index: number): void {
    this.audio.play('interact')

    // By object and by index, not id: ids are display tags and may repeat.
    this.visited.add(project)
    this.menu.setVisited(this.visited)
    this.missions.record(MISSION_PROJECTS, String(index))

    this.popup.open(
      {
        video: project.video,
        title: project.title,
        subtitle: project.tech.join(' · '),
        body: [project.summary],
        links: [{ label: 'View on GitHub ↗', href: project.github ?? '' }],
        accent: project.color,
      },
      () => this.audio.play('close'),
    )
  }

  private firePulse(): void {
    if (!this.combat.pulse(this.player.position)) return

    this.audio.play('pulse')
    this.animation.ring(this.world.scene, this.player.position, this.combat.pulseRadius, 0xff3b3b)
  }
}
