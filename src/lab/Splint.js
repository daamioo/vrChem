import * as THREE from 'three';
import { Probe } from './Probe.js';
import { FlameMesh } from '../effects/FlameMesh.js';

const _p = new THREE.Vector3();
const WOOD = new THREE.Color('#d9b779'), CHAR = new THREE.Color('#1c1814');

/**
 * Wooden splint. Hold its tip in a flame to light it; it burns for a few seconds, then the flame
 * dies to a glowing ember (shake it hard to blow the flame out sooner). Tests:
 *  - a glowing ember pushed into oxygen (a tube of it, or the oxygen cylinder's jet) bursts back
 *    into flame;
 *  - a burning splint in carbon dioxide goes straight out;
 *  - a burning splint at the mouth of a tube of hydrogen makes it pop (the tube handles that).
 * A burning splint is a flame like any other: it lights the Bunsen burner and gas jets.
 */
export class Splint extends Probe {
  buildBody(length, radius) {
    this.state = 'fresh';          // fresh | lit | ember | out
    this.burnT = 0; this.emberT = 0; this.boost = 0;
    this.woodMat = new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.9 });
    const stick = new THREE.Mesh(new THREE.BoxGeometry(radius * 2, length, radius * 1.2).translate(0, length / 2, 0), this.woodMat);
    this.tipMat = new THREE.MeshStandardMaterial({ color: WOOD, roughness: 1, emissive: 0x000000 });
    this.tipMesh = new THREE.Mesh(new THREE.BoxGeometry(radius * 2.05, 0.012, radius * 1.25).translate(0, 0.006, 0), this.tipMat);
    this.flame = new FlameMesh({ radius: 0.005, height: 0.014 });
    this.flame.object3D.position.y = 0.004;
    this.object3D.add(stick, this.tipMesh, this.flame.object3D);
  }

  onAdded() { super.onAdded(); this.world.flames.add(this); }
  onRemoved() { super.onRemoved(); this.world.flames.delete(this); }

  flameDistance(p) {
    if (this.state !== 'lit') return Infinity;
    return Math.max(0, p.distanceTo(this.flame.tip(_p)) - 0.007);
  }
  get flameHeat() { return 250; }

  _light(loud = 0.25) {
    if (this.state !== 'lit') this.world.audio?.play('whoomp', loud);
    this.state = 'lit'; this.burnT = 0;
  }

  /** What gas surrounds the tip: a vessel's collected gas or a cylinder jet. */
  _gasAtTip(tip) {
    for (const t of this.world.pourTargets) {
      if (t.gas && t.gas.amount > 0.2 && t.containsPoint?.(tip)) return { combustion: this.world.chemicals.get(t.gas.id).combustion, vessel: t };
    }
    for (const src of this.world.gasSources) { const j = src.jetAt(tip); if (j) return { combustion: j.combustion }; }
    return null;
  }

  onFrame(dt) {
    const w = this.world, tip = this.tipWorld;
    const gas = this._gasAtTip(tip);

    if (this.state !== 'lit' && w.flameAt(tip, 0.006, this)) this._light();
    if (this.state === 'ember' && gas?.combustion === 'oxidizer') {
      this._light(0.5);
      this.boost = 1;
      if (gas.vessel) gas.vessel.gas.amount -= 0.3;
      w.bus.emit('experiment', { type: 'splint-relit', position: tip.clone() });
    }

    if (this.state === 'lit') {
      this.burnT += dt;
      if (gas?.combustion === 'smothers') {
        this.state = 'out';
        w.audio?.play('hiss', 0.3);
        w.particles?.puffs.emitBurst(tip, 4, { color: [0.6, 0.6, 0.62, 0.3], speed: 0.08, size: 0.01, life: 0.8, up: 0.1, growth: 2 });
        w.bus.emit('experiment', { type: 'splint-out', position: tip.clone() });
      } else if (gas?.combustion === 'oxidizer') this.boost = 1;
      else if (this.burnT > 7 + this.boost * 3 || this.tipVelocity.length() > 2.4) { this.state = 'ember'; this.emberT = 0; }
    }
    if (this.state === 'ember') {
      this.emberT += dt;
      if (this.emberT > 30) this.state = 'out';
      w.particles?.puffs.emitRate(3 * dt, () => w.particles.puffs.emit(tip, _p.set(0, 0.05, 0), [0.7, 0.7, 0.72, 0.2], 0.006, 1.2, 2));
    }
    this.boost = Math.max(0, this.boost - dt * 0.3);

    // visuals
    this.flame.visible = this.state === 'lit';
    this.flame.setColor(this.boost > 0.3 ? 0xffe6b0 : 0xffa234);
    this.flame.update(w.time, 1 + this.boost * 1.2);
    const charred = this.state !== 'fresh';
    this.tipMat.color.copy(charred ? CHAR : WOOD);
    const glow = this.state === 'ember' ? 0.6 + Math.sin(w.time * 5) * 0.25 : this.state === 'lit' ? 0.5 : 0;
    this.tipMat.emissive.setRGB(glow, glow * 0.25, 0);
  }
}
