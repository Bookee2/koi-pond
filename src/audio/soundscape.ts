/**
 * Procedural pond audio. Everything is synthesised with the Web Audio API so
 * the engine ships no sound files: a lapping-water bed made from filtered
 * noise with slow modulation, a rain layer whose level follows the weather,
 * and one-shot plops for taps and shallow fish bursts.
 */
export class Soundscape {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private _enabled = false;
  private _volume = 0.7;
  private rainLevel = 0;

  get enabled(): boolean {
    return this._enabled;
  }

  /** For diagnostics: audio context state and current rain level. */
  get status(): { state: string; rain: number } {
    return { state: this.context?.state ?? "none", rain: this.rainLevel };
  }

  get volume(): number {
    return this._volume;
  }

  /** Must be called from a user gesture the first time (autoplay policy). */
  async setEnabled(on: boolean): Promise<void> {
    this._enabled = on;
    if (on) {
      if (!this.context) this.build();
      await this.context!.resume();
      this.master!.gain.setTargetAtTime(this._volume, this.context!.currentTime, 0.4);
    } else if (this.context && this.master) {
      this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.3);
    }
  }

  setVolume(v: number): void {
    this._volume = v;
    if (this.context && this.master && this._enabled) {
      this.master.gain.setTargetAtTime(v, this.context.currentTime, 0.1);
    }
  }

  /** Rain intensity in drops per second; scales the rain noise layer. */
  setRain(perSecond: number): void {
    const level = Math.min(1, perSecond / 14);
    if (Math.abs(level - this.rainLevel) < 0.01) return;
    this.rainLevel = level;
    if (this.context && this.rainGain) {
      this.rainGain.gain.setTargetAtTime(level * 0.22, this.context.currentTime, 1.5);
    }
  }

  /** A finger or a fish breaking the surface. `size` 0..1 sets pitch and loudness. */
  plop(size = 1, pan = 0): void {
    if (!this.ready()) return;
    const ctx = this.context!;
    const t = ctx.currentTime;
    const out = ctx.createStereoPanner();
    out.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(this.master!);

    // Pitch drop: the classic water-drop "bloop".
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const startHz = 520 - size * 260;
    osc.frequency.setValueAtTime(startHz, t);
    osc.frequency.exponentialRampToValueAtTime(startHz * 0.32, t + 0.16 + size * 0.1);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.0001, t);
    oscGain.gain.exponentialRampToValueAtTime(0.35 * (0.4 + size * 0.6), t + 0.012);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28 + size * 0.15);
    osc.connect(oscGain).connect(out);
    osc.start(t);
    osc.stop(t + 0.5);

    // Splash: a short noise burst through a band-pass that sweeps down.
    const splash = ctx.createBufferSource();
    splash.buffer = this.noiseBuffer;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.2;
    band.frequency.setValueAtTime(3200, t);
    band.frequency.exponentialRampToValueAtTime(900, t + 0.2);
    const splashGain = ctx.createGain();
    splashGain.gain.setValueAtTime(0.0001, t);
    splashGain.gain.exponentialRampToValueAtTime(0.12 * (0.3 + size * 0.7), t + 0.008);
    splashGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18 + size * 0.12);
    splash.connect(band).connect(splashGain).connect(out);
    splash.start(t, Math.random() * 2);
    splash.stop(t + 0.4);
  }

  private ready(): boolean {
    return this._enabled && this.context !== null && this.context.state === "running";
  }

  private build(): void {
    const ctx = new AudioContext();
    this.context = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.noiseBuffer = makeNoise(ctx, 4);

    // Water bed: low-passed noise, its cutoff and level breathing slowly so it laps.
    const bed = ctx.createBufferSource();
    bed.buffer = this.noiseBuffer;
    bed.loop = true;
    const bedFilter = ctx.createBiquadFilter();
    bedFilter.type = "lowpass";
    bedFilter.frequency.value = 380;
    bedFilter.Q.value = 0.7;
    const bedGain = ctx.createGain();
    bedGain.gain.value = 0.16;
    bed.connect(bedFilter).connect(bedGain).connect(this.master);
    bed.start();
    this.lfo(0.11, 140, bedFilter.frequency);
    this.lfo(0.07, 0.05, bedGain.gain);

    // Trickle: a quiet higher band that gives the impression of a distant inlet.
    const trickle = ctx.createBufferSource();
    trickle.buffer = this.noiseBuffer;
    trickle.loop = true;
    const trickleFilter = ctx.createBiquadFilter();
    trickleFilter.type = "bandpass";
    trickleFilter.frequency.value = 1400;
    trickleFilter.Q.value = 2.5;
    const trickleGain = ctx.createGain();
    trickleGain.gain.value = 0.035;
    trickle.connect(trickleFilter).connect(trickleGain).connect(this.master);
    trickle.start(0, 1.3);
    this.lfo(0.23, 500, trickleFilter.frequency);

    // Rain: high-passed noise, silent until the weather turns.
    const rain = ctx.createBufferSource();
    rain.buffer = this.noiseBuffer;
    rain.loop = true;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = "highpass";
    rainFilter.frequency.value = 2600;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = this.rainLevel * 0.22;
    rain.connect(rainFilter).connect(this.rainGain).connect(this.master);
    rain.start(0, 2.1);
    this.lfo(0.9, 0.03, this.rainGain.gain);
  }

  private lfo(rateHz: number, depth: number, target: AudioParam): void {
    const ctx = this.context!;
    const osc = ctx.createOscillator();
    osc.frequency.value = rateHz;
    const gain = ctx.createGain();
    gain.gain.value = depth;
    osc.connect(gain).connect(target);
    osc.start(Math.random() * 3);
  }
}

/** Loopable pink-ish noise: white noise integrated with a leak so it sits lower than hiss. */
function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099;
      b1 = 0.963 * b1 + white * 0.2965;
      b2 = 0.57 * b2 + white * 1.0526;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.11;
    }
  }
  return buffer;
}
