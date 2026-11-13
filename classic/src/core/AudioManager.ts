export type SoundCue =
  | 'interact' | 'close' | 'popup' | 'pulse' | 'disable' | 'unlock'
  | 'pistol' | 'bomb' | 'rocket' | 'burst' | 'hurt' | 'wave'

interface Tone {
  /** Seconds after the cue starts. */
  delay: number
  from: number
  to: number
  duration: number
  wave: OscillatorType
  gain: number
}

/**
 * Every sound is synthesised, so there are no audio files to load. Swap a cue for a sample later by
 * replacing its entry here.
 */
const CUES: Record<SoundCue, readonly Tone[]> = {
  interact: [{ delay: 0, from: 520, to: 780, duration: 0.12, wave: 'triangle', gain: 0.25 }],
  close: [{ delay: 0, from: 600, to: 380, duration: 0.1, wave: 'triangle', gain: 0.2 }],
  // A bubbly two-step pop, rising.
  popup: [
    { delay: 0, from: 440, to: 990, duration: 0.07, wave: 'sine', gain: 0.3 },
    { delay: 0.07, from: 880, to: 1760, duration: 0.16, wave: 'sine', gain: 0.22 },
  ],
  pulse: [{ delay: 0, from: 220, to: 55, duration: 0.28, wave: 'sawtooth', gain: 0.14 }],
  disable: [{ delay: 0, from: 420, to: 80, duration: 0.4, wave: 'square', gain: 0.1 }],
  unlock: [
    { delay: 0, from: 523, to: 523, duration: 0.14, wave: 'triangle', gain: 0.22 },
    { delay: 0.12, from: 659, to: 659, duration: 0.14, wave: 'triangle', gain: 0.22 },
    { delay: 0.24, from: 784, to: 784, duration: 0.3, wave: 'triangle', gain: 0.22 },
  ],
  // Swarm waves.
  pistol: [{ delay: 0, from: 900, to: 300, duration: 0.07, wave: 'square', gain: 0.08 }],
  bomb: [{ delay: 0, from: 260, to: 520, duration: 0.18, wave: 'triangle', gain: 0.18 }],
  rocket: [{ delay: 0, from: 160, to: 420, duration: 0.3, wave: 'sawtooth', gain: 0.1 }],
  burst: [
    { delay: 0, from: 180, to: 40, duration: 0.35, wave: 'sawtooth', gain: 0.2 },
    { delay: 0, from: 90, to: 30, duration: 0.45, wave: 'square', gain: 0.12 },
  ],
  hurt: [{ delay: 0, from: 220, to: 110, duration: 0.14, wave: 'square', gain: 0.14 }],
  wave: [
    { delay: 0, from: 392, to: 392, duration: 0.12, wave: 'sawtooth', gain: 0.12 },
    { delay: 0.12, from: 587, to: 587, duration: 0.22, wave: 'sawtooth', gain: 0.12 },
  ],
}

/** Sound effects through the Web Audio API. */
export class AudioManager {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private muted = false

  constructor() {
    // Browsers refuse to start audio before the user has interacted with the page, so the context
    // is created on the first click or key press rather than up front.
    window.addEventListener('pointerdown', this.unlock)
    window.addEventListener('keydown', this.unlock)
  }

  get isMuted(): boolean {
    return this.muted
  }

  play(cue: SoundCue): void {
    const context = this.context
    const master = this.master
    if (!context || !master || this.muted) return

    const now = context.currentTime

    for (const tone of CUES[cue]) {
      const start = now + tone.delay
      const end = start + tone.duration

      const oscillator = context.createOscillator()
      oscillator.type = tone.wave
      oscillator.frequency.setValueAtTime(tone.from, start)
      oscillator.frequency.exponentialRampToValueAtTime(tone.to, end)

      const envelope = context.createGain()
      envelope.gain.setValueAtTime(tone.gain, start)
      envelope.gain.exponentialRampToValueAtTime(0.0001, end)

      oscillator.connect(envelope).connect(master)
      oscillator.start(start)
      oscillator.stop(end)
    }
  }

  /** Returns the new muted state. */
  toggleMute(): boolean {
    this.muted = !this.muted
    if (this.master) this.master.gain.value = this.muted ? 0 : 1
    return this.muted
  }

  dispose(): void {
    this.removeUnlockListeners()
    void this.context?.close()
    this.context = null
    this.master = null
  }

  private readonly unlock = (): void => {
    this.removeUnlockListeners()
    if (this.context) return

    this.context = new AudioContext()
    this.master = this.context.createGain()
    this.master.gain.value = this.muted ? 0 : 1
    this.master.connect(this.context.destination)
  }

  private removeUnlockListeners(): void {
    window.removeEventListener('pointerdown', this.unlock)
    window.removeEventListener('keydown', this.unlock)
  }
}
