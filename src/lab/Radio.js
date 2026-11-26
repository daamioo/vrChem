import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { Dial } from './Dial.js';
import { DisplayPanel, CanvasPanel } from '../ui/CanvasPanel.js';
import { renderLoungeLoop } from '../audio/LoungeLoop.js';

const _p = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion();
const BANDWIDTH = 0.9;                 // MHz either side of a station where you can still hear it

class KnobLabels extends CanvasPanel {
  constructor() { super(0.24, 0.022, 1500, { transparent: true }); this.redraw(); }
  draw(g, w, h) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#e9dfc8'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${h * 0.62}px sans-serif`;
    g.fillText('GŁOŚNOŚĆ', w * 0.25, h / 2);
    g.fillText('STROJENIE', w * 0.79, h / 2);
  }
}

/**
 * A retro bench radio. Two knobs on top:
 *  - left: volume (fully left = off, with a click). The radio starts switched off;
 *  - right: station selector, a snapping switch with one position per station (no free tuning).
 *    You hear static only while a station is still loading or its file is missing.
 * Every station plays on a seamless loop, forever, and keeps running while you're tuned away.
 * A station is either a local audio file (`file`, e.g. "audio/radio.mp3") or generated music
 * (`generator: "lounge"`, original, made in code). Missing files are just static.
 * Sound comes from the radio (3D positional). It survives the room reset.
 * def: { stations: [{ freq, name, file | generator }], startFreq, startVolume (0..10, default 0 = off), color }
 */
export class Radio extends Entity {
  constructor(world, def) {
    super(world);
    this.def = def;
    this.persistent = true;                       // the room reset leaves it (and the music) alone
    const list = def.stations ?? [{ freq: 92.5, name: 'Radio', file: def.file ?? 'audio/radio.mp3' }];
    this.stations = list.map((s) => ({ ...s, state: 'idle', buffer: null, source: null, gain: null }));
    this.volume = def.startVolume ?? 0;           // 0 = off (the default: silent on load)
    // start on the station nearest startFreq
    const want = def.startFreq ?? this.stations[0]?.freq ?? 92.5;
    this.stationIdx = 0;
    this.stations.forEach((s, i) => { if (Math.abs(s.freq - want) < Math.abs(this.stations[this.stationIdx].freq - want)) this.stationIdx = i; });
    this.freq = this.stations[this.stationIdx]?.freq ?? want;
    this.started = false;
    this.signal = 0;

    const body = new THREE.MeshStandardMaterial({ color: def.color ?? '#8a5a3c', roughness: 0.55 });
    const cream = new THREE.MeshStandardMaterial({ color: 0xe9dfc8, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.6, metalness: 0.3 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); this.object3D.add(m); return m; };
    add(new THREE.BoxGeometry(0.26, 0.15, 0.1), body, 0, 0.085, 0);
    for (const [x, z] of [[-0.1, 0.03], [0.1, 0.03], [-0.1, -0.03], [0.1, -0.03]]) add(new THREE.CylinderGeometry(0.008, 0.008, 0.01, 8), dark, x, 0.005, z);
    add(new THREE.BoxGeometry(0.12, 0.1, 0.004), cream, -0.055, 0.085, 0.051);                     // speaker grille
    for (let i = 0; i < 7; i++) add(new THREE.BoxGeometry(0.11, 0.004, 0.003), dark, -0.055, 0.045 + i * 0.013, 0.054);
    add(new THREE.TorusGeometry(0.07, 0.006, 8, 20, Math.PI), dark, 0, 0.16, -0.035);                // carry handle (back)
    this.display = new DisplayPanel(0.09, 0.035, { fg: '#ffcf73', bg: '#1a1206' });
    this.display.mesh.position.set(0.065, 0.12, 0.051);
    this.object3D.add(this.display.mesh);
    // tuning scale with a moving needle under the display
    add(new THREE.BoxGeometry(0.09, 0.016, 0.002), new THREE.MeshStandardMaterial({ color: 0xf3ead2, roughness: 0.6 }), 0.065, 0.088, 0.051);
    for (let f = 88; f <= 108; f += 2) add(new THREE.BoxGeometry(0.0007, f % 10 === 0 ? 0.01 : 0.006, 0.001), dark, 0.065 + ((f - 98) / 20) * 0.084, 0.09, 0.0522);
    this.needle = add(new THREE.BoxGeometry(0.0012, 0.015, 0.0012), new THREE.MeshBasicMaterial({ color: 0xd61f1f }), 0, 0.088, 0.0526);
    this.lamp = add(new THREE.SphereGeometry(0.006, 10, 8), new THREE.MeshBasicMaterial({ color: 0x331100 }), 0.065, 0.065, 0.052);
    const labels = new KnobLabels();
    labels.mesh.rotation.x = -Math.PI / 2;
    labels.mesh.position.set(0, 0.1605, 0.038);
    this.object3D.add(labels.mesh);

    this.volKnob = new Dial(world, {
      steps: 11, startStep: this.volume, color: '#e9dfc8', radius: 0.018,
      onChange: (k) => { const was = this.volume; this.volume = k; if ((was === 0) !== (k === 0)) world.audio?.play('tick', 1); this._mix(); },
    });
    this.volKnob.object3D.position.set(-0.06, 0.16, 0.0);
    this.tuneKnob = new Dial(world, {
      steps: this.stations.length, startStep: this.stationIdx, snap: true, color: '#c9a66b', radius: 0.018,
      onChange: (k) => { this.stationIdx = k; this.freq = this.stations[k].freq; this._mix(); },
    });
    this.tuneKnob.object3D.position.set(0.07, 0.16, 0.0);
    this.object3D.add(this.volKnob.object3D, this.tuneKnob.object3D);
    this._mix();
  }

  onRemoved() {
    this.volKnob.dispose(); this.tuneKnob.dispose();
    for (const s of this.stations) { try { s.source?.stop(); } catch { /* not started */ } }
    try { this.staticSrc?.stop(); } catch { /* not started */ }
  }

  /** 0..1: how well the dial is tuned to station `s`. */
  strength(s) { return Math.max(0, 1 - Math.abs(this.freq - s.freq) / BANDWIDTH) ** 1.5; }

  get tuned() {
    let best = null, bs = 0;
    for (const s of this.stations) { const k = this.strength(s); if (k > bs) { best = s; bs = k; } }
    return { station: best, strength: bs };
  }

  // ------------------------------------------------------------------ audio

  _build(ctx, master) {
    this.panner = ctx.createPanner();
    Object.assign(this.panner, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 0.6, maxDistance: 30, rolloffFactor: 1.1 });
    this.speaker = ctx.createBiquadFilter();               // a small radio's speaker: no deep bass
    this.speaker.type = 'highpass'; this.speaker.frequency.value = 110;
    this.out = ctx.createGain();
    this.out.connect(this.speaker).connect(this.panner).connect(master);

    // static: looping band-limited noise with the odd crackle
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() < 0.002 ? 3 : 1);
    this.staticSrc = ctx.createBufferSource(); this.staticSrc.buffer = buf; this.staticSrc.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.5;
    this.staticGain = ctx.createGain(); this.staticGain.gain.value = 0;
    this.staticSrc.connect(bp).connect(this.staticGain).connect(this.out);
    this.staticSrc.start();
    this.started = true;
    for (const s of this.stations) this._load(ctx, s);
  }

  async _load(ctx, s) {
    s.state = 'loading';
    try {
      if (s.generator === 'lounge') s.buffer = await renderLoungeLoop({ sampleRate: ctx.sampleRate, seed: s.seed ?? 11 });
      else {
        const res = await fetch(s.file);
        if (!res.ok) { s.state = 'missing'; this._mix(); return; }
        s.buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      }
    } catch (e) {
      console.warn('[radio] station', s.name, 'failed:', e);
      s.state = 'error'; this._mix(); return;
    }
    s.gain = ctx.createGain(); s.gain.gain.value = 0;
    s.source = ctx.createBufferSource();
    s.source.buffer = s.buffer;
    s.source.loop = true;                                  // seamless, forever
    s.source.connect(s.gain).connect(this.out);
    s.source.start();
    s.state = 'ready';
    this._mix();
  }

  /** Sets station / static levels from the tuning, and the overall volume. */
  _mix() {
    const { station, strength } = this.tuned;
    this.signal = station?.state === 'ready' ? strength : 0;
    this._updateDisplay();
    const ctx = this.world.audio?.ctx;
    if (!ctx || !this.out) return;
    const t = ctx.currentTime, set = (param, v) => param.setTargetAtTime(v, t, 0.06);
    set(this.out.gain, this.volume === 0 ? 0 : (this.volume / 10) ** 1.6 * 1.4);
    for (const s of this.stations) if (s.gain) set(s.gain.gain, s.state === 'ready' ? this.strength(s) : 0);
    set(this.staticGain.gain, 0.32 * (1 - this.signal) ** 1.2 + 0.015);
  }

  _updateDisplay() {
    const { station, strength } = this.tuned;
    const fm = `FM ${this.freq.toFixed(1)}`;
    if (this.volume === 0) this.display.setText('WYŁ.', fm);
    else if (!this.started) this.display.setText(fm, 'kliknij / wejdź do VR');
    else if (station && strength > 0.5) {
      const sub = { ready: `♪ GŁOŚN. ${this.volume}`, loading: 'wczytywanie…', missing: `brak: ${station.file}`, error: 'błąd pliku' }[station.state] ?? '';
      this.display.setText(station.name ?? fm, sub);
    } else this.display.setText(fm, `szum · GŁOŚN. ${this.volume}`);
    this.needle.position.x = 0.065 + ((this.freq - 98) / 20) * 0.084;
    this.lamp.material.color.setRGB(0.2 + 0.8 * this.signal, 0.07 + 0.4 * this.signal, 0);
  }

  update(dt) {
    this.volKnob.update(dt);
    this.tuneKnob.update(dt);
    const audio = this.world.audio, ctx = audio?.ctx;
    if (!ctx) return;
    if (!this.started) { this._build(ctx, audio.master); this._mix(); }

    // keep the sound on the radio and the listener on the player's head
    this.object3D.updateMatrixWorld(true);
    this.object3D.localToWorld(_p.set(-0.055, 0.085, 0.05));
    const t = ctx.currentTime, P = this.panner;
    if (P.positionX) { P.positionX.setTargetAtTime(_p.x, t, 0.02); P.positionY.setTargetAtTime(_p.y, t, 0.02); P.positionZ.setTargetAtTime(_p.z, t, 0.02); }
    else P.setPosition(_p.x, _p.y, _p.z);
    const cam = this.world.renderer?.xr?.isPresenting ? this.world.renderer.xr.getCamera() : this.world.camera;
    cam.updateMatrixWorld(true);
    cam.getWorldPosition(_p); cam.getWorldQuaternion(_q);
    _f.set(0, 0, -1).applyQuaternion(_q); _u.set(0, 1, 0).applyQuaternion(_q);
    const L = ctx.listener;
    if (L.positionX) {
      L.positionX.setTargetAtTime(_p.x, t, 0.02); L.positionY.setTargetAtTime(_p.y, t, 0.02); L.positionZ.setTargetAtTime(_p.z, t, 0.02);
      L.forwardX.setTargetAtTime(_f.x, t, 0.02); L.forwardY.setTargetAtTime(_f.y, t, 0.02); L.forwardZ.setTargetAtTime(_f.z, t, 0.02);
      L.upX.setTargetAtTime(_u.x, t, 0.02); L.upY.setTargetAtTime(_u.y, t, 0.02); L.upZ.setTargetAtTime(_u.z, t, 0.02);
    } else { L.setPosition(_p.x, _p.y, _p.z); L.setOrientation(_f.x, _f.y, _f.z, _u.x, _u.y, _u.z); }
  }
}
