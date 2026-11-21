import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { CanvasPanel } from '../ui/CanvasPanel.js';

const _l = new THREE.Vector3();
const SEGMENTS = 12;

class ResetSign extends CanvasPanel {
  constructor() { super(0.3, 0.12, 900); this.redraw(); }
  draw(g, w, h) {
    g.fillStyle = '#f8f8f4'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff7a1a'; g.fillRect(0, 0, w, h * 0.12);
    g.strokeStyle = '#2b3036'; g.lineWidth = 5; g.strokeRect(2, 2, w - 4, h - 4);
    g.fillStyle = '#1a1a1a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${h * 0.36}px sans-serif`; g.fillText('RESET SALI', w / 2, h * 0.45);
    g.font = `${h * 0.17}px sans-serif`; g.fillText('wciśnij i przytrzymaj 1 s', w / 2, h * 0.78);
  }
}

/**
 * Big red mushroom button on the wall that puts the room back to its starting state
 * (LabFactory.resetRoom). Physical: push it in with your hand (or click and hold on desktop) and
 * keep it pressed — a ring of lights fills up over `holdS` seconds, then the room resets. Letting
 * go early cancels, so it can't be bumped by accident. It survives the reset itself.
 * def: { position, rotationY, holdS = 1 }
 */
export class ResetButton extends Entity {
  constructor(world, def) {
    super(world);
    this.def = def;
    this.persistent = true;
    this.holdS = def.holdS ?? 1;
    this.progress = 0; this.depth = 0; this.locked = false;
    this.travel = 0.012; this.capR = 0.04;
    this.object3D.position.set(...(def.position ?? [0, 1.2, 0]));
    this.object3D.rotation.y = THREE.MathUtils.degToRad(def.rotationY ?? 0);

    // local frame: +Z points out of the wall toward the player
    const yellow = new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.5, metalness: 0.3 });
    const add = (geo, mat, x, y, z, parent = this.object3D) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
    add(new THREE.BoxGeometry(0.15, 0.15, 0.04), yellow, 0, 0, 0.02);
    add(new THREE.CylinderGeometry(0.052, 0.052, 0.012, 32).rotateX(Math.PI / 2), dark, 0, 0, 0.046);
    this.cap = new THREE.Group();
    this.cap.position.z = 0.052;
    this.capMat = new THREE.MeshStandardMaterial({ color: 0xd61f1f, roughness: 0.35, emissive: 0x000000 });
    add(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 16).rotateX(Math.PI / 2), dark, 0, 0, 0.01, this.cap);
    const dome = add(new THREE.SphereGeometry(this.capR, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), this.capMat, 0, 0, 0.02, this.cap);
    dome.scale.z = 0.55;
    this.object3D.add(this.cap);
    // progress ring around the button
    this.ring = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2 + Math.PI / 2;
      this.ring.push(add(new THREE.BoxGeometry(0.012, 0.006, 0.004), new THREE.MeshBasicMaterial({ color: 0x3a1a00 }), Math.cos(a) * 0.062, Math.sin(a) * 0.062, 0.042));
      this.ring[i].rotation.z = a;
    }
    const sign = new ResetSign();
    sign.mesh.position.set(0, 0.15, 0.002);
    this.object3D.add(sign.mesh);
  }

  /** How far a hand pushes the cap in (0..1), from its fingertip; desktop: clicking on it counts as fully in. */
  _push(hand) {
    if (hand.held || hand.heldControl || !hand.touching) return 0;
    const l = this.object3D.worldToLocal(_l.copy(hand.touchPoint));
    if (Math.hypot(l.x, l.y) > this.capR + 0.012 || l.z < 0.03) return 0;
    const face = 0.052 + 0.02 + this.capR * 0.55;     // front of the dome when out
    if (hand.name === 'mouse') return l.z < face + 0.02 ? 1 : 0;
    return THREE.MathUtils.clamp((face + 0.005 - l.z) / this.travel, 0, 1);
  }

  update(dt) {
    const w = this.world;
    let push = 0, pusher = null;
    for (const h of w.input?.hands ?? []) { const p = this._push(h); if (p > push) { push = p; pusher = h; } }
    const was = this.depth;
    this.depth += (push - this.depth) * (1 - Math.exp(-25 * dt));
    this.cap.position.z = 0.052 - this.depth * this.travel;
    if (was < 0.7 && this.depth >= 0.7) { w.audio?.play('tick', 1); pusher?.pulse?.(0.6, 40); }

    const held = this.depth >= 0.7 && !this.locked;
    this.progress = held ? this.progress + dt / this.holdS : Math.max(0, this.progress - dt * 3);
    if (held) pusher?.pulse?.(0.15 + this.progress * 0.4, 20);
    if (this.progress >= 1) {
      this.progress = 0; this.locked = true;            // must let go before it can fire again
      w.audio?.play('ding', 1);
      pusher?.pulse?.(1, 150);
      w.after(0, () => w.factory?.resetRoom());          // next frame, outside the entity update loop
    }
    if (push < 0.2) this.locked = false;

    const lit = Math.floor(this.progress * SEGMENTS + 1e-6);
    this.ring.forEach((m, i) => m.material.color.set(this.locked ? 0x22c55e : i < lit ? 0xff9a1a : 0x3a1a00));
    this.capMat.emissive.setRGB(0.25 * this.progress, 0, 0);
  }
}
