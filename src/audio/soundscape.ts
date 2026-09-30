/**
 * Procedural pond audio. Everything is synthesised with the Web Audio API so
 * the engine ships no sound files: a lapping-water bed made from filtered
 * noise with slow modulation, a rain layer whose level follows the weather,
 * and one-shot plops for taps and shallow fish bursts.
 */
/**
 * Optional recorded samples. If public/assets/audio/manifest.json exists, its
 * files replace the synthesised layers category by category; anything missing
 * keeps the synth so the pond is never silent.
 */
interface AudioManifest {
  /** Looping ambience beds per environment id (plus "default"), played together at the listed gains. */
  ambience?: Record<string, { file: string; gain?: number }[]>;
  rain?: { file: string; gain?: number };
  /** Extra rain layers that fade in above a rain level (0..1). */
  rainLayers?: { file: string; gain?: number; from?: number }[];
  /** One-shot pools: a random entry plays each time, with slight pitch variation. */
  plops?: string[];
  splashes?: string[];
  gulps?: string[];
}

interface SampleBank {
  ambience: Record<string, { buffer: AudioBuffer; gain: number }[]>;
  rain: { buffer: AudioBuffer; gain: number } | null;
  rainLayers: { buffer: AudioBuffer; gain: number; from: number }[];
  plops: AudioBuffer[];
  splashes: AudioBuffer[];
  gulps: AudioBuffer[];
}

export class Soundscape {
  private context: AudioContext | null = null;
  private samples: SampleBank | null = null;
  private environmentId = "garden";
  private ambienceSources: { source: AudioBufferSourceNode; gain: GainNode }[] = [];
  private master: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private _enabled = false;
  private _volume = 0.7;
  private rainLevel = 0;
  private rainLayerGains: { gain: GainNode; from: number; peak: number }[] = [];
  private lastDrip = 0;

  get enabled(): boolean {
    return this._enabled;
  }

  /** For diagnostics: audio context state and current rain level. */
  get status(): { state: string; rain: number; samples: boolean; ambienceSources: number } {
    return {
      state: this.context?.state ?? "none",
      rain: this.rainLevel,
      samples: this.samples !== null,
      ambienceSources: this.ambienceSources.length,
    };
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

  /** Crossfade the ambience bed to the environment's recording, if one is listed. */
  setEnvironment(id: string): void {
    if (id === this.environmentId && this.ambienceSources.length) return;
    this.environmentId = id;
    if (this.samples) this.startAmbience(this.samples);
  }

  /** Rain intensity in drops per second; scales the rain noise layer. */
  setRain(perSecond: number): void {
    const level = Math.min(1, perSecond / 14);
    if (Math.abs(level - this.rainLevel) < 0.01) return;
    this.rainLevel = level;
    if (this.context && this.rainGain) {
      // Recorded rain sits ~7 dB under the ambience beds, so drive it hard.
      this.rainGain.gain.setTargetAtTime(this.samples ? level * 1.4 : level * 0.5, this.context.currentTime, 1.5);
      for (const layer of this.rainLayerGains) {
        const amount = Math.max(0, Math.min(1, (level - layer.from) / Math.max(0.01, 1 - layer.from)));
        layer.gain.gain.setTargetAtTime(layer.peak * amount, this.context.currentTime, 2);
      }
    }
  }

  /** Individual drops hitting the water: quiet, high, rate-limited. Called by the rain emitter. */
  drip(pan = 0): void {
    if (!this.ready() || !this.samples) return;
    const now = this.context!.currentTime;
    if (now - this.lastDrip < 0.09 || Math.random() > 0.35) return;
    this.lastDrip = now;
    const pool = this.samples.plops;
    if (!pool.length) return;
    this.playSample(pool[Math.floor(Math.random() * pool.length)], 0.05 + Math.random() * 0.06, pan, 1.5 + Math.random() * 0.6);
  }

  /** A finger or a fish breaking the surface. `size` 0..1 sets pitch and loudness. */
  plop(size = 1, pan = 0): void {
    if (!this.ready()) return;
    const ctx = this.context!;
    const bank = this.samples;
    if (bank) {
      const pool = size >= 0.6 && bank.splashes.length ? bank.splashes : size < 0.3 && bank.gulps.length ? bank.gulps : bank.plops;
      if (pool.length) {
        this.playSample(pool[Math.floor(Math.random() * pool.length)], 0.25 + size * 0.6, pan, 0.92 + Math.random() * 0.2);
        return;
      }
    }
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

  private playSample(buffer: AudioBuffer, gain: number, pan: number, rate: number): void {
    const ctx = this.context!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    source.connect(g).connect(p).connect(this.master!);
    source.start();
  }

  private async loadSamples(): Promise<void> {
    const ctx = this.context!;
    const base = `${import.meta.env.BASE_URL}assets/audio`;
    try {
      const response = await fetch(`${base}/manifest.json`);
      if (!response.ok) return;
      const manifest = (await response.json()) as AudioManifest;
      const decode = async (file: string): Promise<AudioBuffer> =>
        ctx.decodeAudioData(await (await fetch(`${base}/${file}`)).arrayBuffer());
      const ambience: SampleBank["ambience"] = {};
      for (const [id, list] of Object.entries(manifest.ambience ?? {})) {
        ambience[id] = await Promise.all(list.map(async (a) => ({ buffer: await decode(a.file), gain: a.gain ?? 0.5 })));
      }
      const bank: SampleBank = {
        ambience,
        rain: manifest.rain ? { buffer: await decode(manifest.rain.file), gain: manifest.rain.gain ?? 0.5 } : null,
        rainLayers: await Promise.all((manifest.rainLayers ?? []).map(async (l) => ({ buffer: await decode(l.file), gain: l.gain ?? 0.5, from: l.from ?? 0 }))),
        plops: await Promise.all((manifest.plops ?? []).map(decode)),
        splashes: await Promise.all((manifest.splashes ?? []).map(decode)),
        gulps: await Promise.all((manifest.gulps ?? []).map(decode)),
      };
      this.samples = bank;
      this.startSampleBeds(bank);
    } catch (error) {
      console.warn("Recorded audio unavailable, staying with the synthesised soundscape.", error);
    }
  }

  private synthBedGain: GainNode | null = null;
  private synthRainGain: GainNode | null = null;

  private startAmbience(bank: SampleBank): void {
    const ctx = this.context!;
    const list = bank.ambience[this.environmentId] ?? bank.ambience.default ?? [];
    // Fade whatever is playing out over a few seconds, then stop it.
    for (const old of this.ambienceSources) {
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, 1.6);
      old.source.stop(ctx.currentTime + 6);
    }
    this.ambienceSources = [];
    if (!list.length) return;
    if (this.synthBedGain) this.synthBedGain.gain.setTargetAtTime(0, ctx.currentTime, 1.5);
    for (const a of list) {
      const source = ctx.createBufferSource();
      source.buffer = a.buffer;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.setTargetAtTime(a.gain, ctx.currentTime, 2.2);
      source.connect(gain).connect(this.master!);
      source.start(0, Math.random() * Math.max(0, a.buffer.duration - 1));
      this.ambienceSources.push({ source, gain });
    }
  }

  private startSampleBeds(bank: SampleBank): void {
    const ctx = this.context!;
    this.startAmbience(bank);
    if (bank.rain && this.synthRainGain && this.rainGain) {
      this.synthRainGain.gain.setTargetAtTime(0, ctx.currentTime, 1);
      const src = ctx.createBufferSource();
      src.buffer = bank.rain.buffer;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = bank.rain.gain;
      // Route through the shared rain gain so weather still controls it.
      src.connect(g).connect(this.rainGain);
      src.start();
    }
    // Extra layers (patter, downpour) sit beside the main loop and fade in with intensity.
    for (const layer of bank.rainLayers) {
      const src = ctx.createBufferSource();
      src.buffer = layer.buffer;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(g).connect(this.master!);
      src.start(0, Math.random() * Math.max(0, layer.buffer.duration - 1));
      this.rainLayerGains.push({ gain: g, from: layer.from, peak: layer.gain });
    }
    this.setRain(this.rainLevel * 14 + 0.001);
  }

  private ready(): boolean {
    return this._enabled && this.context !== null && this.context.state === "running";
  }

  /**
   * Mobile browsers suspend (iOS: "interrupted") the context when the page is
   * backgrounded and don't bring it back on their own. Resume on return, and
   * on the next gesture in case the browser insists on one.
   */
  private installAutoResume(ctx: AudioContext): void {
    const resume = (): void => {
      if (!this._enabled) return;
      if ((ctx.state as string) !== "running") void ctx.resume().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", () => { if (!document.hidden) resume(); });
    window.addEventListener("pageshow", resume);
    window.addEventListener("focus", resume);
    for (const type of ["pointerdown", "touchend", "keydown"] as const) {
      document.addEventListener(type, resume, { capture: true, passive: true });
    }
    ctx.addEventListener("statechange", () => {
      if (this._enabled && (ctx.state as string) !== "running" && !document.hidden) resume();
    });
  }

  private build(): void {
    const ctx = new AudioContext();
    this.context = ctx;
    this.installAutoResume(ctx);
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
    this.synthBedGain = ctx.createGain();
    bed.connect(bedFilter).connect(bedGain).connect(this.synthBedGain).connect(this.master);
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
    trickle.connect(trickleFilter).connect(trickleGain).connect(this.synthBedGain);
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
    this.rainGain.connect(this.master);
    this.synthRainGain = ctx.createGain();
    rain.connect(rainFilter).connect(this.synthRainGain).connect(this.rainGain);
    rain.start(0, 2.1);
    this.lfo(0.9, 0.03, this.rainGain.gain);
    void this.loadSamples();
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
