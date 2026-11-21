import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { CanvasPanel } from '../ui/CanvasPanel.js';

const _c = new THREE.Vector3();

class BoxLabel extends CanvasPanel {
  constructor() { super(0.07, 0.035, 1400); this.redraw(); }
  draw(g, w, h) {
    g.fillStyle = '#f7f3e6'; g.fillRect(0, 0, w, h);
    const grad = g.createLinearGradient(0, 0, w, 0);
    ['#ee1c25', '#f26724', '#f5e31c', '#84c341', '#4db849', '#0ab0c8', '#3853a4', '#63459d'].forEach((c, i, a) => grad.addColorStop(i / (a.length - 1), c));
    g.fillStyle = grad; g.fillRect(0, h * 0.62, w, h * 0.38);
    g.fillStyle = '#1a1a1a'; g.textAlign = 'center'; g.font = `bold ${h * 0.3}px sans-serif`; g.fillText('pH 1–14', w / 2, h * 0.33);
    g.font = `${h * 0.16}px sans-serif`; g.fillText('papierki wskaźnikowe', w / 2, h * 0.53);
  }
}

/**
 * A box of pH paper strips. Grip the strips sticking out of it and you pull a fresh strip out
 * into your hand. Old strips beyond `maxStrips` that are lying around get cleared away.
 * def: { stripEquipment = 'ph_strip', maxStrips = 10 }
 */
export class PhStripBox extends Entity {
  constructor(world, def) {
    super(world);
    this.def = def;
    this.strips = [];
    const card = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.9 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.04).translate(0, 0.025, 0), card);
    const label = new BoxLabel();
    label.mesh.position.set(0, 0.025, 0.0205);
    const paper = new THREE.MeshStandardMaterial({ color: 0xefe6c4, roughness: 1 });
    this.object3D.add(box, label.mesh);
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.03, 0.0006), paper);
      s.position.set(-0.025 + i * 0.01, 0.06, (i % 2) * 0.004 - 0.002);
      s.rotation.z = (i - 2.5) * 0.04;
      this.object3D.add(s);
    }
  }

  onAdded() { this.world.controls.add(this); }
  onRemoved() { this.world.controls.delete(this); }

  // control interface (InteractionSystem): grabbing the box pulls a strip out
  distanceToPoint(p) {
    this.object3D.updateMatrixWorld(true);
    const top = this.object3D.localToWorld(_c.set(0, 0.06, 0));
    return Math.max(0, top.distanceTo(p) - 0.035);
  }

  beginGrab(hand) {
    const w = this.world, len = w.config.equipment[this.def.stripEquipment ?? 'ph_strip']?.length ?? 0.07;
    const strip = w.factory.spawn({ equipment: this.def.stripEquipment ?? 'ph_strip', position: [hand.position.x, hand.position.y - len * 0.8, hand.position.z] });
    strip.spawnItem = null;                // not part of the layout: the reset crate just removes it
    strip.object3D.quaternion.identity();
    hand.heldControl = null;
    w.input.grab(hand, strip);
    w.audio?.play('scribble', 0.3);
    this.strips.push(strip);
    const max = this.def.maxStrips ?? 10;
    while (this.strips.length > max) {
      const old = this.strips.find((s) => !s.body.held);
      if (!old) break;
      this.strips.splice(this.strips.indexOf(old), 1);
      if (w.entities.has(old)) w.remove(old);
    }
  }

  endGrab() {}
  update() { this.strips = this.strips.filter((s) => this.world.entities.has(s)); }
}
