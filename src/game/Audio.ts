// Procedural sound effects via the Web Audio API — no audio assets. Everything
// is synthesized from oscillators + noise so it stays self-contained and tiny.
// Browsers block audio until a user gesture, so call Sound.unlock() on the first
// click/tap. Every method is wrapped so a missing/blocked context never throws.

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private _muted = false;

  get muted(): boolean {
    return this._muted;
  }
  setMuted(m: boolean): void {
    this._muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  // Create/resume the context (must be triggered by a user gesture).
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this._muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
        this.noise = this.makeNoise(this.ctx);
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      /* audio unavailable */
    }
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const len = ctx.sampleRate * 0.5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // ---- building blocks ----
  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    freqEnd?: number,
    delay = 0,
  ): void {
    if (!this.ctx || !this.master || this._muted) return;
    const t = this.now() + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(
    dur: number,
    gain: number,
    filter: BiquadFilterType,
    freq: number,
    q = 1,
    delay = 0,
  ): void {
    if (!this.ctx || !this.master || !this.noise || this._muted) return;
    const t = this.now() + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bf = this.ctx.createBiquadFilter();
    bf.type = filter;
    bf.frequency.value = freq;
    bf.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(bf).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  // ---- effects ----
  shot(): void {
    this.unlock();
    const p = 1 + (Math.random() - 0.5) * 0.12;
    this.tone(150 * p, 0.13, "square", 0.32, 40); // body
    this.noiseBurst(0.12, 0.5, "bandpass", 1600 * p, 0.7); // crack
    this.noiseBurst(0.05, 0.35, "highpass", 3000); // snap
  }

  hitEnemy(headshot: boolean): void {
    if (headshot) {
      this.tone(1500, 0.07, "triangle", 0.35);
      this.tone(2100, 0.09, "sine", 0.28, undefined, 0.04);
    } else {
      this.tone(900, 0.055, "triangle", 0.3);
    }
  }

  kill(): void {
    this.tone(680, 0.08, "square", 0.28);
    this.tone(1020, 0.12, "square", 0.24, undefined, 0.07);
  }

  reload(): void {
    this.noiseBurst(0.04, 0.35, "highpass", 2600, 1); // mag out
    this.tone(180, 0.06, "square", 0.2, 90, 0.02); // clunk
    this.noiseBurst(0.04, 0.35, "highpass", 2600, 1, 0.28); // mag in
    this.tone(240, 0.05, "square", 0.22, 120, 0.42); // charge
  }

  hurt(): void {
    this.noiseBurst(0.14, 0.4, "lowpass", 700, 0.8);
    this.tone(180, 0.16, "sine", 0.25, 90);
  }

  die(): void {
    this.tone(420, 0.6, "sawtooth", 0.3, 90);
    this.noiseBurst(0.4, 0.25, "lowpass", 500, 0.7);
  }

  ui(): void {
    this.tone(880, 0.03, "sine", 0.18);
  }

  win(): void {
    [660, 880, 1320].forEach((f, i) => this.tone(f, 0.22, "triangle", 0.28, undefined, i * 0.1));
  }

  lose(): void {
    [440, 350, 260].forEach((f, i) => this.tone(f, 0.28, "sawtooth", 0.24, undefined, i * 0.12));
  }
}

export const Sound = new SoundEngine();
