import type { Weapon } from './WarfrontVisual.ts'

const STORAGE_KEY = 'system-zero:warfront-sound'

/** Procedural Warfront audio. A user gesture must call activate before any sound is made. */
export class WarfrontAudio {
  private context: AudioContext | null = null
  private output: GainNode | null = null
  private noise: AudioBuffer | null = null
  private ambience: AudioBufferSourceNode | null = null
  private ambienceGain: GainNode | null = null
  private rumble: OscillatorNode | null = null
  private rumbleGain: GainNode | null = null
  private readonly voices = new Set<AudioScheduledSourceNode>()
  private enabledState = this.readPreference()
  private sceneActive = true
  private lastAppliedState = ''
  private disposed = false
  private lastArmyShot = 0
  private lastImpact = 0
  private lastDamage = 0
  private lastDeath = 0
  private lastReinforcement = 0

  get enabled(): boolean { return this.enabledState }

  activate(): void {
    if (this.disposed || !this.enabledState || typeof window === 'undefined') return
    if (!this.context) {
      const Constructor = window.AudioContext
        ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Constructor) return
      try {
        this.context = new Constructor()
        this.output = this.context.createGain()
        this.output.gain.value = 0.65
        this.output.connect(this.context.destination)
        this.noise = this.makeNoise(this.context)
        this.startAmbience()
      } catch {
        this.disposeContext()
        return
      }
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {})
  }

  toggle(): boolean {
    if (this.disposed) return this.enabledState
    this.enabledState = !this.enabledState
    try { window.localStorage.setItem(STORAGE_KEY, String(this.enabledState)) } catch { /* Storage may be unavailable. */ }
    if (this.enabledState) this.activate()
    this.setSceneState(this.sceneActive, false)
    return this.enabledState
  }

  setSceneState(active: boolean, playing: boolean): void {
    this.sceneActive = active
    const context = this.context
    if (!context) return
    const state = `${this.enabledState}:${active}:${playing}`
    if (state === this.lastAppliedState) return
    this.lastAppliedState = state
    this.output?.gain.setTargetAtTime(this.enabledState && active ? 0.65 : 0, context.currentTime, 0.08)
    this.ambienceGain?.gain.setTargetAtTime(this.enabledState && active ? (playing ? 0.017 : 0.009) : 0, context.currentTime, 0.3)
    this.rumbleGain?.gain.setTargetAtTime(this.enabledState && active ? (playing ? 0.006 : 0.003) : 0, context.currentTime, 0.3)
  }

  playWeapon(weapon: Weapon, distance: number, pan = 0, player = false): void {
    if (!player && !this.allow('armyShot', 0.075)) return
    const level = this.spatial(distance) * (player ? 1 : 0.48)
    if (weapon === 'rifle') {
      this.burst(0.085, 0.14 * level, 1900, pan)
      this.tone(170, 75, 0.09, 0.036 * level, 'square', pan)
    } else if (weapon === 'scattergun') {
      this.burst(0.21, 0.2 * level, 980, pan)
      this.tone(115, 42, 0.19, 0.064 * level, 'triangle', pan)
    } else {
      this.burst(0.13, 0.12 * level, 620, pan)
      this.tone(140, 460, 0.27, 0.052 * level, 'sawtooth', pan)
    }
  }

  playImpact(weapon: Weapon, distance: number, pan = 0): void {
    if (!this.allow('impact', weapon === 'rocket' ? 0.07 : 0.045)) return
    const level = this.spatial(distance)
    if (weapon === 'rocket') {
      this.burst(0.52, 0.24 * level, 420, pan)
      this.tone(98, 30, 0.43, 0.11 * level, 'triangle', pan)
    } else {
      this.burst(weapon === 'scattergun' ? 0.13 : 0.075, (weapon === 'scattergun' ? 0.09 : 0.052) * level, weapon === 'scattergun' ? 760 : 1700, pan)
      this.tone(weapon === 'scattergun' ? 145 : 310, 75, 0.075, 0.025 * level, 'triangle', pan)
    }
  }

  playDamage(player: boolean, distance: number, pan = 0): void {
    if (!player && (distance > 8 || !this.allow('damage', 0.08))) return
    const level = player ? 1 : this.spatial(distance) * 0.38
    this.burst(player ? 0.2 : 0.09, (player ? 0.11 : 0.06) * level, player ? 750 : 1450, pan)
    if (player) this.tone(220, 95, 0.24, 0.065, 'triangle', 0)
  }

  playDeath(player: boolean, distance: number, pan = 0): void {
    if (!player && !this.allow('death', 0.14)) return
    const level = player ? 1 : this.spatial(distance) * 0.5
    this.tone(player ? 280 : 190, 65, player ? 0.44 : 0.26, 0.068 * level, 'sawtooth', pan)
    this.burst(player ? 0.3 : 0.15, 0.055 * level, 350, pan)
  }

  playReinforcement(distance: number, pan = 0): void {
    if (distance > 5 || !this.allow('reinforcement', 0.5)) return
    const level = this.spatial(distance) * 0.28
    this.tone(290, 470, 0.18, 0.034 * level, 'sine', pan)
  }

  playFootstep(): void {
    this.burst(0.075, 0.042, 310)
    this.tone(86, 52, 0.07, 0.023, 'triangle')
  }

  playJump(): void {
    this.burst(0.085, 0.05, 650)
    this.tone(135, 360, 0.2, 0.042, 'triangle')
  }

  playLand(): void {
    this.burst(0.15, 0.087, 380)
    this.tone(110, 42, 0.17, 0.055, 'triangle')
  }

  playEquip(): void {
    this.burst(0.055, 0.042, 2500)
    this.tone(420, 280, 0.07, 0.027, 'square')
  }

  playEnter(): void {
    this.tone(120, 540, 0.46, 0.044, 'sawtooth')
    this.tone(220, 720, 0.37, 0.029, 'sine', 0, 0.07)
    this.burst(0.34, 0.06, 650)
  }

  playExit(): void {
    this.tone(520, 125, 0.32, 0.043, 'sine')
    this.burst(0.13, 0.033, 700)
  }

  playUi(): void { this.tone(490, 620, 0.055, 0.022, 'sine') }
  playLowHealth(): void { this.tone(610, 430, 0.13, 0.032, 'sine') }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.disposeContext()
  }

  private readPreference(): boolean {
    try { return typeof window === 'undefined' || window.localStorage.getItem(STORAGE_KEY) !== 'false' } catch { return true }
  }

  private spatial(distance: number): number {
    const scaled = Math.max(0, distance) / 4.5
    return 1 / (1 + scaled * scaled)
  }

  private allow(kind: 'armyShot' | 'impact' | 'damage' | 'death' | 'reinforcement', interval: number): boolean {
    if (!this.context || !this.enabledState || !this.sceneActive) return false
    const now = this.context.currentTime
    const key: 'lastArmyShot' | 'lastImpact' | 'lastDamage' | 'lastDeath' | 'lastReinforcement' = kind === 'armyShot' ? 'lastArmyShot' : kind === 'impact' ? 'lastImpact' : kind === 'damage' ? 'lastDamage' : kind === 'death' ? 'lastDeath' : 'lastReinforcement'
    if (now - this[key] < interval) return false
    this[key] = now
    return true
  }

  private makeNoise(context: AudioContext): AudioBuffer {
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 1.2), context.sampleRate)
    const samples = buffer.getChannelData(0)
    let seed = 217513
    for (let index = 0; index < samples.length; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0
      samples[index] = (seed / 2147483648) * 0.5
    }
    return buffer
  }

  private startAmbience(): void {
    const context = this.context
    if (!context || !this.output || !this.noise) return
    const ambience = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    ambience.buffer = this.noise
    ambience.loop = true
    filter.type = 'lowpass'
    filter.frequency.value = 190
    gain.gain.value = 0
    ambience.connect(filter).connect(gain).connect(this.output)
    ambience.start()
    this.ambience = ambience
    this.ambienceGain = gain

    const rumble = context.createOscillator()
    const rumbleGain = context.createGain()
    rumble.type = 'sine'
    rumble.frequency.value = 43
    rumbleGain.gain.value = 0
    rumble.connect(rumbleGain).connect(this.output)
    rumble.start()
    this.rumble = rumble
    this.rumbleGain = rumbleGain
    this.setSceneState(this.sceneActive, false)
  }

  private tone(from: number, to: number, duration: number, peak: number, wave: OscillatorType, pan = 0, delay = 0): void {
    const context = this.context
    if (!context || !this.output || !this.enabledState || !this.sceneActive || this.voices.size >= 32) return
    const source = context.createOscillator()
    const gain = context.createGain()
    const start = context.currentTime + delay
    source.type = wave
    source.frequency.setValueAtTime(from, start)
    source.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    source.connect(gain)
    const panner = this.route(gain, pan)
    this.track(source, panner ? [gain, panner] : [gain])
    source.start(start)
    source.stop(start + duration + 0.01)
  }

  private burst(duration: number, peak: number, cutoff: number, pan = 0): void {
    const context = this.context
    if (!context || !this.output || !this.noise || !this.enabledState || !this.sceneActive || this.voices.size >= 32) return
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    const start = context.currentTime
    source.buffer = this.noise
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(cutoff, start)
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.28), start + duration)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + 0.005)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    source.connect(filter).connect(gain)
    const panner = this.route(gain, pan)
    this.track(source, panner ? [filter, gain, panner] : [filter, gain])
    source.start(start, Math.random() * 0.55)
    source.stop(start + duration + 0.01)
  }

  private route(node: AudioNode, pan: number): StereoPannerNode | null {
    if (!this.context || !this.output) return null
    if (Math.abs(pan) < 0.02 || !this.context.createStereoPanner) { node.connect(this.output); return null }
    const panner = this.context.createStereoPanner()
    panner.pan.value = Math.max(-1, Math.min(1, pan))
    node.connect(panner).connect(this.output)
    return panner
  }

  private track(source: AudioScheduledSourceNode, nodes: AudioNode[]): void {
    this.voices.add(source)
    source.onended = () => {
      this.voices.delete(source)
      source.disconnect()
      for (const node of nodes) node.disconnect()
    }
  }

  private disposeContext(): void {
    for (const source of this.voices) {
      source.onended = null
      try { source.stop() } catch { /* Already stopped. */ }
      source.disconnect()
    }
    this.voices.clear()
    try { this.ambience?.stop() } catch { /* Already stopped. */ }
    try { this.rumble?.stop() } catch { /* Already stopped. */ }
    this.ambience?.disconnect()
    this.rumble?.disconnect()
    this.ambienceGain?.disconnect()
    this.rumbleGain?.disconnect()
    this.output?.disconnect()
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {})
    this.context = null
    this.output = null
    this.noise = null
    this.ambience = null
    this.ambienceGain = null
    this.rumble = null
    this.rumbleGain = null
    this.lastAppliedState = ''
  }
}
