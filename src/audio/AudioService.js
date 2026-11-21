/**
 * Procedural sound effects (no asset files). The AudioContext is created lazily on the first
 * user gesture / XR session so browsers allow it. Each sound has a minimum retrigger interval.
 */
export class AudioService {
  constructor() {
    this.ctx = null; this.master = null; this.noise = null;
    this._last = new Map();
    this.enabled = true;
    this.recipes = {
      beep:       { gap: 0.1,  fn: (v) => this._tone(880, 0.07, 0.2 * v, 'square') },
      ding:       { gap: 0.2,  fn: (v) => { this._tone(1175, 0.5, 0.25 * v); this._tone(1760, 0.4, 0.12 * v); } },
      tick:       { gap: 0.15, fn: (v) => this._tone(1500, 0.03, 0.1 * v, 'square') },
      clink:      { gap: 0.08, fn: (v) => { this._tone(2400, 0.2, 0.2 * v); this._tone(3100, 0.15, 0.1 * v); } },
      fizz:       { gap: 0.09, fn: (v) => this._noise(0.1, 0.12 * v, 'highpass', 3500) },
      hiss:       { gap: 0.2,  fn: (v) => this._noise(0.35, 0.12 * v, 'highpass', 5000) },
      pour:       { gap: 0.12, fn: (v) => this._noise(0.15, 0.1 * v, 'bandpass', 900) },
      powder:     { gap: 0.12, fn: (v) => this._noise(0.15, 0.06 * v, 'highpass', 2500) },
      pourSplash: { gap: 0.2,  fn: (v) => this._noise(0.12, 0.12 * v, 'bandpass', 1800) },
      spray:      { gap: 0.08, fn: (v) => this._noise(0.14, 0.14 * v, 'highpass', 1800) },
      water:      { gap: 0.1,  fn: (v) => this._noise(0.14, 0.09 * v, 'bandpass', 1400) },
      scribble:   { gap: 0.05, fn: (v) => this._noise(0.06, 0.05 * v, 'bandpass', 3500) },
      stir:       { gap: 0.15, fn: (v) => this._noise(0.08, 0.05 * v, 'bandpass', 2600) },
      shatter:    { gap: 0.1,  fn: (v) => {
        this._noise(0.35, 0.35 * v, 'highpass', 2500);
        for (let i = 0; i < 7; i++) this._tone(2600 + Math.random() * 4200, 0.08 + Math.random() * 0.25, 0.06 * v, 'triangle');
      } },
      gasLeak:    { gap: 0.11, fn: (v) => this._noise(0.24, 0.1 * v, 'highpass', 3200) },
      squeak:     { gap: 0.25, fn: (v) => this._tone(420 + Math.random() * 120, 0.12, 0.05 * v, 'sawtooth', 380) },
      boing:      { gap: 0.06, fn: (v) => { this._tone(260, 0.18, 0.22 * v, 'sine', 140); this._noise(0.05, 0.08 * v, 'lowpass', 900); } },
      rubberSqueak: { gap: 0.07, fn: (v) => { const f = 700 + v * 600 + Math.random() * 120; this._tone(f, 0.09, 0.07 * v, 'square', f * 1.35); } },
      purr:       { gap: 0.8,  fn: (v) => { this._purrIn = !this._purrIn; this._purr(0.9, 0.22 * v, this._purrIn ? 23 : 27); } },
      meow:       { gap: 1.0,  fn: (v) => this._meow(0.16 * v) },
      flick:      { gap: 0.1,  fn: (v) => { this._noise(0.05, 0.18 * v, 'highpass', 4000); this._tone(3200, 0.02, 0.05 * v, 'square'); } },
      whoomp:     { gap: 0.4,  fn: (v) => { this._noise(0.6, 0.45 * v, 'lowpass', 350); this._tone(90, 0.5, 0.3 * v, 'sine', 45); } },
      flame:      { gap: 0.2,  fn: (v) => { this._noise(0.3, 0.14 * v, 'lowpass', 420); this._noise(0.25, 0.04 * v, 'bandpass', 1600); } },
      pop:        { gap: 0.15, fn: (v) => { this._noise(0.06, 0.4 * v, 'highpass', 1500); this._tone(1300, 0.12, 0.18 * v, 'triangle', 380); } },
      drip:       { gap: 0.04, fn: (v) => this._tone(1500 + Math.random() * 400, 0.05, 0.06 * v, 'sine', 800) },
      boom:       { gap: 0.3,  fn: (v) => { this._noise(1.1, 0.7 * v, 'lowpass', 500); this._tone(55, 0.8, 0.6 * v, 'sine', 20); } },
    };
  }

  /** Call from a user-gesture handler (click, XR session start). */
  unlock() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  play(name, volume = 1) {
    if (!this.ctx || !this.enabled) return;
    const r = this.recipes[name];
    if (!r) return;
    const now = this.ctx.currentTime;
    if (now - (this._last.get(name) ?? -1) < r.gap) return;
    this._last.set(name, now);
    r.fn(Math.max(0, Math.min(1.5, volume)));
  }

  _env(duration, gain) {
    const g = this.ctx.createGain(), t = this.ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    g.connect(this.master);
    return g;
  }

  _tone(freq, duration, gain, type = 'sine', endFreq = null) {
    const o = this.ctx.createOscillator(), t = this.ctx.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
    o.connect(this._env(duration, gain));
    o.start(t); o.stop(t + duration);
  }

  _noise(duration, gain, filterType, freq) {
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), t = this.ctx.currentTime;
    s.buffer = this.noise; f.type = filterType; f.frequency.value = freq;
    s.connect(f); f.connect(this._env(duration, gain));
    s.start(t, Math.random() * 0.5, duration);
  }

  /** Cat purr: low-passed noise chopped at ~25 Hz plus a soft buzz at the same rate. */
  _purr(duration, gain, rate) {
    const ctx = this.ctx, t = ctx.currentTime;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.2);
    env.gain.setValueAtTime(gain, t + duration - 0.25);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    env.connect(this.master);
    const am = ctx.createGain(); am.gain.value = 0.5; am.connect(env);
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.type = 'triangle'; lfo.frequency.value = rate; depth.gain.value = 0.5;
    lfo.connect(depth); depth.connect(am.gain);
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter();
    src.buffer = this.noise; f.type = 'lowpass'; f.frequency.value = 650;
    src.connect(f); f.connect(am);
    const buzz = ctx.createOscillator(), bf = ctx.createBiquadFilter(), bg = ctx.createGain();
    buzz.type = 'sawtooth'; buzz.frequency.value = rate; bf.type = 'lowpass'; bf.frequency.value = 320; bg.gain.value = 0.5;
    buzz.connect(bf); bf.connect(bg); bg.connect(env);
    lfo.start(t); buzz.start(t); src.start(t, Math.random() * 0.05, duration);
    lfo.stop(t + duration); buzz.stop(t + duration);
  }

  /** "Mi-a-ow": a sawtooth with a rising-falling pitch through two moving vowel formants. */
  _meow(gain) {
    const ctx = this.ctx, t = ctx.currentTime, d = 0.7;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(430, t);
    o.frequency.exponentialRampToValueAtTime(760, t + 0.2);
    o.frequency.exponentialRampToValueAtTime(470, t + d);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.06);
    env.gain.setValueAtTime(gain, t + d - 0.25);
    env.gain.exponentialRampToValueAtTime(0.0001, t + d);
    env.connect(this.master);
    const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter(), g2 = ctx.createGain();
    f1.type = f2.type = 'bandpass'; f1.Q.value = 4; f2.Q.value = 5; g2.gain.value = 0.5;
    f1.frequency.setValueAtTime(650, t); f1.frequency.linearRampToValueAtTime(1300, t + 0.25); f1.frequency.linearRampToValueAtTime(750, t + d);
    f2.frequency.setValueAtTime(2000, t); f2.frequency.linearRampToValueAtTime(2600, t + 0.25); f2.frequency.linearRampToValueAtTime(1600, t + d);
    o.connect(f1); f1.connect(env); o.connect(f2); f2.connect(g2); g2.connect(env);
    o.start(t); o.stop(t + d);
  }
}
