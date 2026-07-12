// Procedural ambient music bed. A slow, evolving drone (detuned saw pads through
// a moving low-pass) so there's atmosphere without shipping audio files. Volume
// is user-controlled in Settings; starts muted-ish and only after a gesture.

class MusicEngine {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private _vol = 0.35;
  private started = false;
  private lfo: OscillatorNode | null = null;

  setVolume(v: number): void {
    this._vol = Math.max(0, Math.min(1, v));
    if (this.gain && this.ctx) {
      this.gain.gain.setTargetAtTime(this._vol * 0.16, this.ctx.currentTime, 0.2);
    }
  }

  // Start the bed (idempotent). Call after a user gesture so audio can play.
  start(): void {
    if (this.started) return;
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      const ctx = this.ctx;
      this.started = true;

      this.gain = ctx.createGain();
      this.gain.gain.value = this._vol * 0.16;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 500;
      filter.Q.value = 3;

      // slow filter sweep for movement
      this.lfo = ctx.createOscillator();
      this.lfo.frequency.value = 0.05;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 260;
      this.lfo.connect(lfoGain).connect(filter.frequency);
      this.lfo.start();

      // a minor-ish drone stack
      const roots = [55, 82.4, 110, 164.8]; // A1, E2, A2, E3
      for (const f of roots) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = f;
        osc.detune.value = (Math.random() - 0.5) * 8;
        const og = ctx.createGain();
        og.gain.value = 0.18;
        osc.connect(og).connect(filter);
        osc.start();
      }
      filter.connect(this.gain).connect(ctx.destination);
    } catch {
      /* audio unavailable */
    }
  }
}

export const Music = new MusicEngine();
