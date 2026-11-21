import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { Surface } from '../physics/Surface.js';

/** A lab bench: white work surface on a dark cabinet base with an orange edge strip. */
export class Table extends Entity {
  constructor(world, def) {
    super(world);
    const [w, t, d] = def.size;
    this.def = def;
    const [, y] = def.position;

    const top = new THREE.Mesh(new THREE.BoxGeometry(w, t, d), new THREE.MeshStandardMaterial({ color: def.color ?? '#eef1f4', roughness: 0.25, metalness: 0.05 }));
    const baseH = y - t / 2;
    const base = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, baseH, d - 0.1), new THREE.MeshStandardMaterial({ color: '#2a2f38', roughness: 0.5, metalness: 0.4 }));
    base.position.y = -t / 2 - baseH / 2;
    // Orange strips along the long front/back edges, plus cabinet door seams.
    const trimMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a });
    const longX = w >= d;
    for (const s of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(longX ? w : 0.012, 0.012, longX ? 0.012 : d), trimMat);
      strip.position.set(longX ? 0 : s * (w / 2 + 0.001), t / 2 - 0.004, longX ? s * (d / 2 + 0.001) : 0);
      top.add(strip);
    }
    const seamMat = new THREE.MeshBasicMaterial({ color: 0x0f1318 });
    const doors = Math.max(2, Math.round(Math.max(w, d) / 0.6));
    for (let i = 1; i < doors; i++) {
      const along = -Math.max(w, d) / 2 + (Math.max(w, d) * i) / doors;
      const seam = new THREE.Mesh(new THREE.BoxGeometry(longX ? 0.006 : 0.004, baseH * 0.9, longX ? 0.004 : 0.006), seamMat);
      seam.position.set(longX ? along : (w - 0.1) / 2 + 0.003, base.position.y, longX ? (d - 0.1) / 2 + 0.003 : along);
      top.add(seam);
    }
    top.add(base);
    this.object3D.add(top);
    this.object3D.position.set(...def.position);
    this.surface = null;
  }

  onAdded() {
    const [w, t, d] = this.def.size;
    const [x, y, z] = this.def.position;
    this.surface = this.world.physics.addSurface(new Surface({
      owner: this, shape: 'rect', x, z, top: y + t / 2, halfX: w / 2, halfZ: d / 2,
      solid: Surface.box({ depth: y + t / 2, inset: 0.05, insetBelow: t + 0.02 }),      // worktop, then the cabinet
    }));
  }
  onRemoved() { this.world.physics.removeSurface(this.surface); }
}
