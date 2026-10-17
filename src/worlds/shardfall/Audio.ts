/** Small synthesized effects, initialized only after an explicit sound toggle. */
export class ShardfallAudio {
  private context: AudioContext | null = null
  private enabled = false

  toggle(): boolean {
    this.enabled = !this.enabled
    if (this.enabled) {
      this.context ??= new AudioContext()
      void this.context.resume().catch(() => { this.enabled = false })
    }
    return this.enabled
  }

  play(kind: 'launch' | 'impact' | 'laser' | 'pulse'): void {
    if (!this.enabled || !this.context || this.context.state !== 'running') return
    const context = this.context
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const now = context.currentTime
    const duration = kind === 'pulse' ? 0.6 : kind === 'impact' ? 0.35 : 0.13
    oscillator.type = kind === 'laser' ? 'sawtooth' : 'triangle'
    oscillator.frequency.setValueAtTime(kind === 'laser' ? 440 : kind === 'launch' ? 180 : 85, now)
    oscillator.frequency.exponentialRampToValueAtTime(kind === 'laser' ? 200 : 25, now + duration)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(kind === 'impact' ? 0.14 : 0.055, now + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(now)
    oscillator.stop(now + duration)
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
  }

  dispose(): void {
    this.enabled = false
    if (this.context) void this.context.close()
    this.context = null
  }
}
