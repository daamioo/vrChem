import * as THREE from 'three';
import { Probe } from './Probe.js';
import { Mixture } from '../chemistry/Mixture.js';

const _v = new THREE.Vector3();
const DROP_ML = 0.05;

/**
 * Pasteur pipette (dropper) with a rubber bulb. Squeeze the bulb with the trigger (curl your
 * fingers with bare hands, Space on desktop) and let go:
 *  - squeeze, put the tip under a liquid, release slowly: it sucks liquid up;
 *  - squeeze gently with the tip over a vessel: drops fall into it one by one (0.05 mL each);
 *  - squeeze with the tip under the liquid: it empties straight in (bubbles if it's empty).
 * The bulb holds `capacityMl` (default 3). Origin = the tip.
 */
export class Pipette extends Probe {
  buildBody(length, radius) {
    this.cap = this.def.capacityMl ?? 3;
    this.mix = new Mixture(this.world.chemicals, this.world.settings.ambientTemperatureC);
    this._sq = 0; this._dropBuf = 0;
    const glassLen = length * 0.72;
    this.glassLen = glassLen;
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.35, glassLen, 12, 1, true).translate(0, glassLen / 2, 0),
      new THREE.MeshPhongMaterial({ color: 0xe8f4ff, transparent: true, opacity: 0.3, shininess: 100, side: THREE.DoubleSide, depthWrite: false }));
    glass.renderOrder = 3;
    this.bulb = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6 }));
    this.bulbY = glassLen + (length - glassLen) * 0.5;
    this.bulb.position.y = this.bulbY;
    this.bulbR = radius * 2.2;
    this.bulbLen = (length - glassLen) * 0.6;
    this.liquid = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.75, radius * 0.3, 1, 10).translate(0, 0.5, 0),
      new THREE.MeshPhongMaterial({ color: 0x88ccff, transparent: true, opacity: 0.75, depthWrite: false }));
    this.liquid.renderOrder = 2;
    this.liquid.visible = false;
    this.object3D.add(glass, this.bulb, this.liquid);
  }

  get totalMassG() { return (this.def.massG ?? 8) + this.mix.totalMass; }

  /** The vessel directly under the tip whose opening a falling drop would land in. */
  _vesselBelow(tip) {
    let best = null, bestY = -Infinity;
    for (const t of this.world.pourTargets) {
      if (!t.canAccept?.(this)) continue;
      const o = t.getOpening();
      if (o.center.y < tip.y && o.center.y > bestY && Math.hypot(o.center.x - tip.x, o.center.z - tip.z) <= o.radius) { best = t; bestY = o.center.y; }
    }
    return best;
  }

  onFrame(dt) {
    const w = this.world, hand = this.body.held, tip = this.tipWorld;
    const sq = hand ? THREE.MathUtils.clamp(hand.squeeze ?? 0, 0, 1) : 0;
    const d = sq - this._sq;
    this._sq = sq;
    const c = this.immersedIn;
    const inLiquid = !!c && tip.y < c.liquidTopY();

    if (d > 0.002) {                                  // squeezing: liquid out first, then air
      const want = d * this.cap, have = this.mix.liquidVolume, out = Math.min(want, have);
      if (out > 0) {
        const temp = this.mix.temperature, taken = this.mix.takeLiquid(out);
        if (c && c.canAccept(this)) c.acceptPour(taken, temp, this);
        else this._drops(taken, out, temp, tip);
      }
      if (inLiquid && want - out > 0.02) {
        w.particles?.bubbles.emitBurst(tip, Math.ceil((want - out) * 6), { color: [1, 1, 1, 0.6], speed: 0.05, size: 0.003, life: 0.6, up: 0.15, spread: 0.004 });
        w.audio?.play('fizz', 0.2);
      }
    } else if (d < -0.002 && inLiquid) {              // releasing under the liquid: suck it up
      const ml = Math.min(-d * this.cap, this.cap - this.mix.liquidVolume, c.mixture.liquidVolume);
      if (ml > 0.001) {
        const temp = c.mixture.temperature;
        this.mix.addAll(c.mixture.takeLiquid(ml), temp);
        hand?.pulse?.(0.08, 20);
      }
    }

    // visuals: squashed bulb, liquid column
    const s = 1 - sq * 0.45;
    this.bulb.scale.set(this.bulbR * s, this.bulbLen * (1 + sq * 0.15), this.bulbR * s);
    const v = this.mix.liquidVolume;
    this.liquid.visible = v > 0.005;
    if (this.liquid.visible) {
      this.liquid.scale.y = Math.max(0.002, (v / this.cap) * this.glassLen);
      const col = this.mix.layers.liquidColor;
      this.liquid.material.color.setRGB(col.r, col.g, col.b, THREE.SRGBColorSpace);
    }
  }

  /** Expelled in the air: drops fall into whatever vessel is below the tip (or splash). */
  _drops(taken, ml, temp, tip) {
    const w = this.world, target = this._vesselBelow(tip);
    this._dropBuf += ml;
    const col = this.mix.layers.liquidColor;
    const n = Math.floor(this._dropBuf / DROP_ML);
    this._dropBuf -= n * DROP_ML;
    for (let i = 0; i < Math.max(1, n); i++) {
      w.particles?.droplets.emit(tip, _v.set(0, -0.2, 0), [col.r, col.g, col.b, 0.85], 0.005, 0.6);
    }
    const fall = target ? Math.sqrt(Math.max(0, 2 * (tip.y - target.getOpening().center.y) / 9.81)) : 0.2;
    w.after(fall, () => {
      if (target && w.entities.has(target)) { target.acceptPour(taken, temp, this); w.audio?.play('drip', 0.8); }
      else w.bus.emit('spill', { container: this, map: taken });
    });
  }
}
