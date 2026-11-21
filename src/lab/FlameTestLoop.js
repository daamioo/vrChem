import * as THREE from 'three';
import { Probe } from './Probe.js';

const _v = new THREE.Vector3();

/**
 * Nichrome wire loop for flame tests. Dip the loop into a powder jar or a solution: it picks up
 * a bead of the chemical that colours flames (`flameColor` in chemicals.json). Hold the loop in a
 * flame and the flame takes on that colour — copper green, sodium orange, potassium lilac,
 * calcium brick red — until the sample burns off (metal powders also throw sparks). The wire
 * glows while it's hot. Origin = the loop.
 */
export class FlameTestLoop extends Probe {
  buildBody(length) {
    this.sample = null;           // { id, color, sparks, left }
    this.heat = 0;
    this.wireMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.9, roughness: 0.3, emissive: 0x000000 });
    const handle = new THREE.MeshStandardMaterial({ color: this.def.color ?? '#3b4252', roughness: 0.5 });
    const add = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; this.object3D.add(m); return m; };
    add(new THREE.TorusGeometry(0.004, 0.0008, 6, 16), this.wireMat, 0.004);
    const wireLen = length * 0.45;
    add(new THREE.CylinderGeometry(0.0008, 0.0008, wireLen, 6), this.wireMat, 0.008 + wireLen / 2);
    add(new THREE.CylinderGeometry(0.0045, 0.006, length - wireLen - 0.008, 12), handle, 0.008 + wireLen + (length - wireLen - 0.008) / 2);
    this.bead = add(new THREE.SphereGeometry(0.0032, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), 0.004);
    this.bead.scale.z = 0.5;
    this.bead.visible = false;
  }

  /** Dipped into a vessel: take a bead of whatever in it colours flames. */
  onImmersed(container) {
    const mix = container.mixture, L = mix.layers;
    let best = null, bestG = 0;
    for (const [id, g] of mix.grams) {
      const c = this.world.chemicals.get(id);
      if (!c.flameColor) continue;
      const avail = c.isSolid ? (L.dissolved.get(id) ?? 0) + (L.sediment.get(id) ?? 0) : g;
      if (avail > bestG) { best = c; bestG = avail; }
    }
    if (!best || bestG < 0.01) return;
    if (this.sample?.id !== best.id) this.world.audio?.play('tick', 0.3);
    this.sample = { id: best.id, color: best.flameColor, sparks: best.flameSparks, left: 1 };
    this.bead.material.color.set(best.color);
    this.bead.visible = true;
  }

  onFrame(dt) {
    const w = this.world, tip = this.tipWorld;
    const flame = w.flameAt(tip, 0.004, this);
    this.heat = THREE.MathUtils.clamp(this.heat + (flame ? dt * 1.5 : -dt * 0.5), 0, 1);
    this.wireMat.emissive.setRGB(this.heat * 0.9, this.heat * 0.3, this.heat * 0.05);

    if (flame && this.sample) {
      const s = this.sample;
      flame.tintFlame?.(s.color, Math.min(1, s.left * 1.6));
      s.left -= dt / 5;
      if (s.sparks) {
        w.particles?.sparks.emitRate(40 * dt, () => {
          _v.set((Math.random() - 0.5) * 0.8, 0.3 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8);
          w.particles.sparks.emit(tip, _v, [1, 0.9, 0.7, 1], 0.004 + Math.random() * 0.003, 0.2 + Math.random() * 0.25);
        });
      }
      w.audio?.play('fizz', 0.15);
      this.body.held?.pulse?.(0.06, 20);
      if (s.left <= 0) { this.sample = null; this.bead.visible = false; }
      else this.bead.scale.setScalar(0.5 + s.left * 0.5).setZ(0.25 + s.left * 0.25);
    }
  }
}
