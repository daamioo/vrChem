/**
 * Renders an original, seamlessly looping lounge / bossa-nova style tune (no samples, no assets):
 * electric-piano comping, a walking-ish bass, rim clicks, a soft shaker and a vibraphone melody
 * picked from the chord tones with a seeded random generator. Used as a radio station.
 * The tail of the last notes is folded back onto the start so the loop has no seam.
 * @returns {Promise<AudioBuffer>}
 */
export async function renderLoungeLoop({ sampleRate = 44100, seed = 11, bpm = 96 } = {}) {
  const beat = 60 / bpm, bar = beat * 4, bars = 8, loopLen = bar * bars, tail = 2.5;
  const OAC = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
  const ctx = new OAC(2, Math.ceil((loopLen + tail) * sampleRate), sampleRate);
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

  const master = ctx.createGain(); master.gain.value = 0.55;
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 6500;
  master.connect(tone).connect(ctx.destination);
  const noise = ctx.createBuffer(1, sampleRate, sampleRate);
  { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }

  const note = (t, midi, dur, gain, { type = 'sine', pan = 0, attack = 0.01, harm = 0, trem = 0 } = {}) => {
    const g = ctx.createGain(), p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(p).connect(master);
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz(midi); o.connect(g);
    o.start(t); o.stop(t + dur + 0.05);
    if (harm) {                                         // bell-ish overtone (electric piano / vibes)
      const g2 = ctx.createGain(); g2.gain.value = harm; g2.connect(g);
      const o2 = ctx.createOscillator(); o2.frequency.value = hz(midi) * 4; o2.connect(g2); o2.start(t); o2.stop(t + Math.min(dur, 0.4));
    }
    if (trem) {
      const lfo = ctx.createOscillator(), d = ctx.createGain();
      lfo.frequency.value = 5.5; d.gain.value = gain * trem; lfo.connect(d).connect(g.gain); lfo.start(t); lfo.stop(t + dur);
    }
  };
  const hit = (t, dur, gain, type, freq, pan = 0) => {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner();
    src.buffer = noise; f.type = type; f.frequency.value = freq; f.Q.value = type === 'bandpass' ? 6 : 0.7; p.pan.value = pan;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(p).connect(master);
    src.start(t, Math.random() * 0.5, dur + 0.02);
  };

  // ii–V–I–vi style changes in F (two bars each): Gm9, C13, Fmaj9, Dm9 — chord tones as MIDI notes
  const chords = [
    { root: 43, voicing: [58, 62, 65, 69], tones: [67, 70, 74, 77, 81] },   // Gm9
    { root: 36, voicing: [58, 64, 69, 72], tones: [67, 69, 72, 76, 79] },   // C13
    { root: 41, voicing: [57, 60, 64, 67], tones: [69, 72, 76, 77, 79] },   // Fmaj9
    { root: 38, voicing: [57, 60, 65, 69], tones: [69, 72, 74, 77, 81] },   // Dm9
  ];
  const comp = [0, 3, 6, 10, 12];                    // 16th-note positions of the piano stabs (bossa feel)
  const clave = [[0, 6, 12], [4, 10]];               // rim clicks over two bars
  const s16 = beat / 4;
  let lastMel = 72;

  for (let b = 0; b < bars; b++) {
    const t0 = b * bar, ch = chords[Math.floor(b / 2) % chords.length];
    // bass: root on 1, fifth on the "and" of 2, root on 3, approach note at the end of bar
    note(t0, ch.root, beat * 1.4, 0.32, { type: 'triangle', attack: 0.01 });
    note(t0 + beat * 1.5, ch.root + 7, beat * 1.2, 0.26, { type: 'triangle' });
    note(t0 + beat * 2, ch.root, beat * 1.4, 0.3, { type: 'triangle' });
    note(t0 + beat * 3.5, ch.root + (b % 2 ? -1 : 7), beat * 0.5, 0.22, { type: 'triangle' });
    // electric piano comping
    for (const k of comp) for (const m of ch.voicing) note(t0 + k * s16, m, s16 * 2.6, 0.045, { harm: 0.25, pan: -0.25 });
    // rim clicks and shaker
    for (const k of clave[b % 2]) hit(t0 + k * s16, 0.05, 0.22, 'bandpass', 1900, 0.3);
    for (let k = 0; k < 16; k += 2) hit(t0 + k * s16, 0.06, k % 4 === 2 ? 0.06 : 0.035, 'highpass', 7000, -0.2);
    // vibraphone melody: chord tones, mostly stepwise, with rests
    for (let k = 0; k < 16; k += 2) {
      if (rand() < (k % 8 === 0 ? 0.25 : 0.5)) continue;
      const near = ch.tones.slice().sort((a, c) => Math.abs(a - lastMel) - Math.abs(c - lastMel));
      const m = near[Math.floor(rand() * Math.min(3, near.length))];
      lastMel = m;
      const len = rand() < 0.35 ? s16 * 6 : s16 * 2.5;
      note(t0 + k * s16, m, len, 0.11, { harm: 0.18, trem: 0.35, pan: 0.25, attack: 0.005 });
    }
  }

  const rendered = await ctx.startRendering();
  // fold the tail onto the start -> seamless loop
  const n = Math.floor(loopLen * sampleRate), out = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate });
  for (let c = 0; c < 2; c++) {
    const src = rendered.getChannelData(c), dst = out.getChannelData(c);
    dst.set(src.subarray(0, n));
    for (let i = n; i < src.length; i++) dst[i - n] += src[i];
  }
  return out;
}
