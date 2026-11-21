import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { Dial } from './Dial.js';
import { DisplayPanel } from '../ui/CanvasPanel.js';

const _p = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion();

/**
 * A retro bench radio that plays one song on a seamless loop, forever. The sound comes from the
 * radio itself (3D positional audio), so it gets louder as you walk up to it.
 * Turn the knob: fully left is OFF (click), then louder step by step.
 * The song is a local file you supply: def.file (default "audio/radio.mp3", relative to the
 * project root). If it's missing the display says so.
 * def: { file, startVolume (0..10), color }
 */
export class Radio extends Entity {
  constructor(world, def) {
    super(world);
    this.def = def;
    this.file = def.file ?? 'audio/radio.mp3';
    this.volume = def.startVolume ?? 5;          // 0 = off
    this.state = 'idle';                          // idle | loading | ready | missing | error
    this.buffer = null; this.source = null; this.gain = null; this.panner = null;

    const body = new THREE.MeshStandardMaterial({ color: def.color ?? '#8a5a3c', roughness: 0.55 });
    const cream = new THREE.MeshStandardMaterial({ color: 0xe9dfc8, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.6, metalness: 0.3 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); this.object3D.add(m); return m; };
    add(new THREE.BoxGeometry(0.26, 0.15, 0.1), body, 0, 0.075 + 0.01, 0);
    for (const [x, z] of [[-0.1, 0.03], [0.1, 0.03], [-0.1, -0.03], [0.1, -0.03]]) add(new THREE.CylinderGeometry(0.008, 0.008, 0.01, 8), dark, x, 0.005, z);
    // speaker grille (left) with slats
    add(new THREE.BoxGeometry(0.12, 0.1, 0.004), cream, -0.055, 0.085, 0.051);
    for (let i = 0; i < 7; i++) add(new THREE.BoxGeometry(0.11, 0.004, 0.003), dark, -0.055, 0.045 + i * 0.013, 0.054);
    // handle
    add(new THREE.TorusGeometry(0.07, 0.006, 8, 20, Math.PI), dark, 0, 0.16, 0);
    // display
    this.display = new DisplayPanel(0.09, 0.035, { fg: '#ffcf73', bg: '#1a1206' });
    this.display.mesh.position.set(0.065, 0.12, 0.051);
    this.object3D.add(this.display.mesh);
    // on-air lamp
    this.lamp = add(new THREE.SphereGeometry(0.006, 10, 8), new THREE.MeshBasicMaterial({ color: 0x331100 }), 0.065, 0.085, 0.052);
    // volume / power knob on the top
    this.knob = new Dial(world, {
      steps: 11, startStep: this.volume, color: '#e9dfc8', radius: 0.02,
      onChange: (k) => { const was = this.volume; this.volume = k; if ((was === 0) !== (k === 0)) world.audio?.play('tick', 1); this._applyVolume(); },
    });
    this.knob.object3D.position.set(0.075, 0.16, 0.0);
    this.object3D.add(this.knob.object3D);
    this._updateDisplay();
  }

  onRemoved() { this.knob.dispose(); this._stop(); }

  /** Loads and decodes the song once the audio context exists (after the first click / Enter VR). */
  async _load(ctx) {
    this.state = 'loading';
    this._updateDisplay();
    try {
      const res = await fetch(this.file);
      if (!res.ok) { this.state = 'missing'; this._updateDisplay(); return; }
      this.buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      this.state = 'ready';
    } catch (e) {
      console.warn('[radio] could not load', this.file, e);
      this.state = 'error';
    }
    this._updateDisplay();
  }

  _start(ctx, master) {
    this.panner = ctx.createPanner();
    Object.assign(this.panner, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 0.6, maxDistance: 30, rolloffFactor: 1.1 });
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.source = ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.loop = true;                      // seamless, forever
    this.source.connect(this.gain).connect(this.panner).connect(master);
    this.source.start();
    this._applyVolume();
  }

  _stop() { try { this.source?.stop(); } catch { /* already stopped */ } this.source?.disconnect(); this.source = null; }

  _applyVolume() {
    this._updateDisplay();
    const ctx = this.world.audio?.ctx;
    if (!this.gain || !ctx) return;
    const v = this.volume === 0 ? 0 : (this.volume / 10) ** 1.6 * 1.4;
    this.gain.gain.setTargetAtTime(v, ctx.currentTime, 0.08);
  }

  _updateDisplay() {
    const name = this.file.split('/').pop();
    const msg = {
      idle: ['RADIO', 'kliknij / wejdź do VR'], loading: ['…', 'wczytywanie'],
      missing: ['BRAK PLIKU', this.file], error: ['BŁĄD PLIKU', name],
    }[this.state];
    if (msg) this.display.setText(...msg);
    else this.display.setText(this.volume === 0 ? 'WYŁ.' : `♪ GŁOŚN. ${this.volume}`, name);
    this.lamp.material.color.set(this.state === 'ready' && this.volume > 0 ? 0xff7a1a : 0x331100);
  }

  update(dt) {
    this.knob.update(dt);
    const audio = this.world.audio, ctx = audio?.ctx;
    if (!ctx) return;
    if (this.state === 'idle') this._load(ctx);
    if (this.state === 'ready' && !this.source) this._start(ctx, audio.master);
    if (!this.panner) return;

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
