import * as THREE from 'three';
import { Container } from './Container.js';
import { CanvasPanel } from '../ui/CanvasPanel.js';
import { Valve } from './Valve.js';

const _v = new THREE.Vector3();

class Scale extends CanvasPanel {
  constructor(h, marks) { super(0.022, h, 2400, { transparent: true }); this.marks = marks; this.redraw(); }
  draw(g, w, h) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#1a1a1a'; g.strokeStyle = '#1a1a1a'; g.textBaseline = 'middle'; g.font = `bold ${w * 0.28}px sans-serif`;
    for (const { ml, v } of this.marks) {
      const y = h * (1 - v), major = ml % 5 === 0;
      g.lineWidth = major ? 3 : 1.5;
      g.beginPath(); g.moveTo(0, y); g.lineTo(w * (major ? 0.45 : 0.25), y); g.stroke();
      if (major && ml % 10 === 0) g.fillText(String(ml), w * 0.5, y);
    }
  }
}

/**
 * A 50 mL burette clamped in a stand, with a little funnel on top. Pour a solution into the
 * funnel, put a flask under the tip and turn the stopcock: a little open gives single drops,
 * more open a thin stream. The scale reads 0 at the top, so the mL used is where the liquid
 * level has dropped to. Fixed in place (not grabbable). Origin = bottom of the glass tube.
 * def: { profile, wall, standHeight, maxFlowMlPerS }
 */
export class Burette extends Container {
  build() {
    super.build();
    const sh = this.def.standHeight ?? 0.25;
    this.tipLocal = new THREE.Vector3(0, -0.055, 0);
    this._dropAcc = 0;
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.6, metalness: 0.4 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xb4bcc6, roughness: 0.3, metalness: 0.85 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); this.object3D.add(m); return m; };
    // stand: heavy base, rod, clamp
    add(new THREE.BoxGeometry(0.16, 0.015, 0.22), dark, 0, -sh + 0.0075, -0.06);
    add(new THREE.CylinderGeometry(0.006, 0.006, 0.75, 10), steel, 0, -sh + 0.375, -0.12);
    add(new THREE.BoxGeometry(0.02, 0.02, 0.12), dark, 0, 0.3, -0.065);
    add(new THREE.BoxGeometry(0.03, 0.025, 0.02), dark, 0, 0.3, -0.005);
    // stopcock and tip
    add(new THREE.CylinderGeometry(0.004, 0.004, 0.02, 8), this.glass.material, 0, -0.01, 0);
    add(new THREE.CylinderGeometry(0.0025, 0.0012, 0.03, 8), this.glass.material, 0, -0.04, 0);
    this.valve = new Valve(this.world, { radius: 0.011, turns: 0.25, color: '#1d4ed8', onChange: (o) => { this.open = o; } });
    this.valve.object3D.position.set(0, -0.018, 0.012);
    this.valve.object3D.rotation.x = Math.PI / 2;     // turns about the horizontal axis, facing the user
    this.object3D.add(this.valve.object3D);
    this.open = 0;

    // graduation scale: 0 at the top of the tube, mL drained downward
    const full = this.profile.height * 0.885;           // straight part of the tube
    const capTube = this._volumeAt(full);
    const marks = [];
    for (let ml = 0; ml <= 50; ml++) {
      const vol = capTube - ml * (capTube / 50);
      marks.push({ ml, v: this.profile.heightForVolume(vol) / full });
    }
    const scale = new Scale(full, marks);
    scale.mesh.position.set(0.0065 + 0.011, full / 2, 0.002);   // ticks start at the glass
    scale.mesh.renderOrder = 4;
    this.object3D.add(scale.mesh);
  }

  /** Volume (mL) up to height y, by bisection on the profile's heightForVolume. */
  _volumeAt(y) {
    let lo = 0, hi = this.capacityMl;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (this.profile.heightForVolume(mid) < y) lo = mid; else hi = mid; }
    return lo;
  }

  onAdded() {
    super.onAdded();
    this.world.grabbables.delete(this);           // clamped in its stand
    this.world.physics.removeBody(this);
  }

  onRemoved() { super.onRemoved(); this.valve.dispose(); }

  update(dt) {
    super.update(dt);
    this.valve.update(dt);
    const L = this.mixture.layers;
    if (this.open <= 0.01 || L.liquidVolume < 0.01) return;

    const rate = Math.pow(this.open, 1.6) * (this.def.maxFlowMlPerS ?? 6);
    const ml = Math.min(L.liquidVolume, rate * dt), temp = this.mixture.temperature, col = L.liquidColor;
    const taken = this.mixture.takeLiquid(ml);
    const tip = this.object3D.localToWorld(_v.copy(this.tipLocal));
    let target = null, bestY = -Infinity;
    for (const t of this.world.pourTargets) {
      if (t === this || !t.canAccept(this)) continue;
      const o = t.getOpening();
      if (o.center.y < tip.y && o.center.y > bestY && Math.hypot(o.center.x - tip.x, o.center.z - tip.z) <= o.radius) { target = t; bestY = o.center.y; }
    }
    if (target) target.acceptPour(taken, temp, this);
    else this.world.bus.emit('spill', { container: this, map: taken });

    if (rate > 1.2) {                               // a thin stream
      const s = this.world.physics.surfaceAt(tip.x, tip.z, tip.y);
      this._showStream(tip, target ? target.streamEndY() : (s ? s.top : 0), 'liquid', col);
      this.world.audio?.play('pour', 0.25);
    } else {                                        // single drops
      this._dropAcc += rate * dt;
      if (this._dropAcc >= 0.05) {
        this._dropAcc = 0;
        this.world.particles?.droplets.emit(tip, _v.set(0, -0.3, 0), [col.r, col.g, col.b, 0.85], 0.0045, 0.5);
        this.world.audio?.play('drip', 0.6);
      }
    }
  }
}
