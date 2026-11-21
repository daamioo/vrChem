import * as THREE from 'three';
import { LabObject } from './LabObject.js';

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _v = new THREE.Vector3();

/**
 * Pocket gas lighter. Hold it and press the trigger (Space on desktop) to strike: sparks from the
 * flint wheel, then a flame for as long as the trigger stays down. The flame always rises, however
 * the lighter is tilted. Hold it in a gas cylinder's jet and the gas decides what happens, from
 * `combustion` in chemicals.json: a "fuel" (hydrogen) catches fire, an "oxidizer" (oxygen) makes
 * the flame flare up, and a gas that "smothers" (CO2) blows it out until you strike again.
 * def: { color, massG }
 */
export class Lighter extends LabObject {
  build() {
    const H = 0.07;
    this.height = H + 0.012;
    this.grabRadius = 0.03;
    this.lit = false;
    this.flare = 0;             // 0..1, oxygen boost
    this._wasTrigger = false;
    this._snuffed = false;

    const body = new THREE.MeshStandardMaterial({ color: this.def.color ?? '#d62828', roughness: 0.35, metalness: 0.1 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xb4bcc6, roughness: 0.3, metalness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.6, metalness: 0.4 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); this.object3D.add(m); return m; };
    add(new THREE.BoxGeometry(0.024, H, 0.012), body, 0, H / 2, 0);
    add(new THREE.BoxGeometry(0.025, 0.012, 0.013), steel, 0, H + 0.006, 0);                         // hood
    add(new THREE.CylinderGeometry(0.0055, 0.0055, 0.008, 14).rotateX(Math.PI / 2), dark, -0.006, H + 0.009, 0);  // flint wheel
    add(new THREE.BoxGeometry(0.009, 0.005, 0.01), dark, 0.006, H + 0.0025, 0);                      // gas button

    // flame: kept upright in world space every frame
    this.flame = new THREE.Group();
    this.flame.position.set(0.004, H + 0.013, 0);
    const outer = new THREE.MeshBasicMaterial({ color: 0xffa234, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const inner = new THREE.MeshBasicMaterial({ color: 0x4f7dff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    this.outerFlame = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10).translate(0, 1, 0), outer);
    this.outerFlame.scale.set(0.0055, 0.014, 0.0055);
    this.innerFlame = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8).translate(0, 1, 0), inner);
    this.innerFlame.scale.set(0.003, 0.005, 0.003);
    this.flame.add(this.outerFlame, this.innerFlame);
    this.flame.visible = false;
    this.object3D.add(this.flame);
    this.light = new THREE.PointLight(0xffa040, 0, 1.6, 2);
    this.flame.add(this.light);
    for (const m of [this.outerFlame, this.innerFlame]) m.raycast = () => {};
  }

    get totalMassG() { return this.def.massG ?? 20; }
  get collisionRadius() { return 0.013; }

  /** World point at the hot tip of the flame (where it lights things). */
  get flamePoint() {
    return this.flame.localToWorld(_p.set(0, this.outerFlame.scale.y * 1.4, 0));
  }

  update(dt) {
    const w = this.world, hand = this.body.held;
    const trigger = !!hand?.triggerPressed;
    if (trigger && !this._wasTrigger) {                 // strike
      this.object3D.updateMatrixWorld(true);
      w.particles?.sparks.emitBurst(this.flame.getWorldPosition(_v), 8, { color: [1, 0.75, 0.3, 1], speed: 0.5, size: 0.003, life: 0.25, up: 0.4, spread: 0.004 });
      w.audio?.play('flick', 0.8);
      hand.pulse?.(0.4, 25);
      this._snuffed = false;
      this.lit = true;
    }
    if (!trigger) { this.lit = false; this._snuffed = false; }
    this._wasTrigger = trigger;

    this.flare = Math.max(0, this.flare - dt * 3);
    this.flame.visible = this.lit;
    if (!this.lit) { this.light.intensity = 0; return; }

    // keep the flame pointing up and flickering
    this.object3D.updateMatrixWorld(true);
    this.object3D.getWorldQuaternion(_q).invert();
    this.flame.quaternion.copy(_q);
    const t = w.time, flick = 1 + Math.sin(t * 31) * 0.08 + Math.sin(t * 17.3) * 0.06 + (Math.random() - 0.5) * 0.08;
    const big = 1 + this.flare * 2.2;
    this.outerFlame.scale.set(0.0055 * (1 + this.flare * 0.8), 0.014 * flick * big, 0.0055 * (1 + this.flare * 0.8));
    this.innerFlame.scale.set(0.003, 0.005 * flick * (1 + this.flare), 0.003);
    this.outerFlame.material.color.setRGB(1, 0.64 + this.flare * 0.3, 0.2 + this.flare * 0.7);
    this.light.intensity = (0.35 + this.flare * 0.8) * flick;
    this.flame.updateMatrixWorld(true);

    // what is the flame sitting in?
    const tip = this.flamePoint;
    for (const src of w.gasSources) {
      const jet = src.jetAt(tip);
      if (!jet) continue;
      if (jet.combustion === 'fuel') src.ignite(jet.cylinder);
      else if (jet.combustion === 'oxidizer') { this.flare = Math.min(1, this.flare + dt * 8 * jet.flow + dt * 4); w.audio?.play('flame', 0.3 + this.flare * 0.4); }
      else if (jet.combustion === 'smothers' && !this._snuffed) {
        this.lit = false; this._snuffed = true; this.flame.visible = false; this.light.intensity = 0;
        w.particles?.puffs.emitBurst(tip, 5, { color: [0.6, 0.6, 0.62, 0.35], speed: 0.1, size: 0.01, life: 0.8, up: 0.15, growth: 2 });
        w.audio?.play('hiss', 0.3);
      }
      break;
    }
    if (this._snuffed) this.lit = false;
  }

  /** Released while lit (or dropped): the flame goes out. */
  onRelease() { this.lit = false; this._wasTrigger = false; this.flame.visible = false; this.light.intensity = 0; }
}
