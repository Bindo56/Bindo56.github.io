const MUTE_STORAGE_KEY = 'system-zero:bitroom-muted';

type Wave = OscillatorType;

type Voice = {
  oscillator: OscillatorNode;
  gain: GainNode;
};

/** Short, quiet sound cues for the BitRoom. No audio starts until a game action calls a play method. */
export class BitroomAudio {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private readonly voices = new Set<Voice>();
  private mutedState: boolean;
  private disposed = false;

  constructor() {
    this.mutedState = this.readMutedPreference();
  }

  get muted(): boolean {
    return this.mutedState;
  }

  toggleMuted(): boolean {
    if (this.disposed) return this.mutedState;

    this.mutedState = !this.mutedState;
    this.saveMutedPreference();

    if (this.mutedState) {
      this.stopVoices();
    } else {
      // The mute button is a user gesture, so it can unlock audio on mobile browsers.
      this.getContext();
    }

    return this.mutedState;
  }

  playSelect(bit: number, selected: boolean): void {
    const degree = Number.isFinite(bit) ? Math.abs(Math.trunc(bit)) % 8 : 0;
    const frequency = (selected ? 392 : 294) + degree * (selected ? 23 : 13);
    this.playTone(frequency, 0.085, 0, selected ? 'sine' : 'triangle', 0.026);
  }

  playOperator(): void {
    this.playTone(360, 0.07, 0, 'triangle', 0.025);
    this.playTone(480, 0.09, 0.055, 'sine', 0.023);
  }

  playApply(): void {
    this.playTone(310, 0.13, 0, 'triangle', 0.029, 470);
    this.playTone(620, 0.08, 0.07, 'sine', 0.017);
  }

  playSuccess(): void {
    this.playTone(440, 0.17, 0, 'sine', 0.032);
    this.playTone(554.37, 0.18, 0.11, 'sine', 0.031);
    this.playTone(659.25, 0.25, 0.22, 'sine', 0.032);
  }

  playError(): void {
    this.playTone(196, 0.12, 0, 'triangle', 0.023, 175);
    this.playTone(155.56, 0.13, 0.095, 'triangle', 0.021, 138);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopVoices();
    this.output?.disconnect();
    this.output = null;

    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') {
      void context.close().catch(() => {
        // The browser may already have shut down its audio device.
      });
    }
  }

  private readMutedPreference(): boolean {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  private saveMutedPreference(): void {
    try {
      window.localStorage.setItem(MUTE_STORAGE_KEY, String(this.mutedState));
    } catch {
      // Private browsing and storage policies can make localStorage unavailable.
    }
  }

  private getContext(): AudioContext | null {
    if (this.disposed || this.mutedState || typeof window === 'undefined') return null;

    if (!this.context) {
      const AudioContextConstructor = window.AudioContext
        ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) return null;

      try {
        this.context = new AudioContextConstructor();
        this.output = this.context.createGain();
        this.output.gain.value = 1;
        this.output.connect(this.context.destination);
      } catch {
        if (this.context && this.context.state !== 'closed') {
          void this.context.close().catch(() => {});
        }
        this.context = null;
        this.output = null;
        return null;
      }
    }

    if (this.context.state === 'suspended') {
      void this.context.resume().catch(() => {
        // Audio permission and autoplay behavior vary by browser.
      });
    }

    return this.context.state === 'closed' ? null : this.context;
  }

  private playTone(
    frequency: number,
    duration: number,
    delay: number,
    wave: Wave,
    peak: number,
    endFrequency?: number,
  ): void {
    const context = this.getContext();
    if (!context || !this.output || this.voices.size >= 16) return;

    let oscillator: OscillatorNode | null = null;
    let gain: GainNode | null = null;
    let voice: Voice | null = null;

    try {
      oscillator = context.createOscillator();
      gain = context.createGain();

      const start = context.currentTime + delay;
      const end = start + duration;
      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(frequency, start);
      if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, end);

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peak, start + Math.min(0.012, duration * 0.25));
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      oscillator.connect(gain);
      gain.connect(this.output);

      voice = { oscillator, gain };
      this.voices.add(voice);
      oscillator.onended = () => {
        if (voice) this.voices.delete(voice);
        oscillator?.disconnect();
        gain?.disconnect();
      };
      oscillator.start(start);
      oscillator.stop(end + 0.01);
    } catch {
      if (voice) this.voices.delete(voice);
      try {
        oscillator?.stop();
      } catch {
        // It might not have started.
      }
      oscillator?.disconnect();
      gain?.disconnect();
    }
  }

  private stopVoices(): void {
    for (const voice of this.voices) {
      voice.oscillator.onended = null;
      try {
        voice.oscillator.stop();
      } catch {
        // A voice may have already finished.
      }
      voice.oscillator.disconnect();
      voice.gain.disconnect();
    }
    this.voices.clear();
  }
}
