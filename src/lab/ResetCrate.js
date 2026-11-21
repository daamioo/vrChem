import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { Surface } from '../physics/Surface.js';

/** Blue recycling crate: anything dropped inside returns to its original spot in the lab. */
export class ResetCrate extends Entity {
  constructor(world, def) {
    super(world);
    this.def = def;
    const r = def.radius ?? 0.2, h = def.height ?? 0.25;
    this.radius = r;
    const mat = new THREE.MeshStandardMaterial({ color: def.color ?? '#2563eb', roughness: 0.6, side: THREE.DoubleSide });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, h, 28, 1, true).translate(0, h / 2, 0), mat);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(r * 0.9, 28).rotateX(-Math.PI / 2).translate(0, 0.03, 0), new THREE.MeshStandardMaterial({ color: 0x1e3a8a }));
    // Recycle arrows painted as a ring on the rim.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 8, 40).rotateX(Math.PI / 2).translate(0, h, 0), new THREE.MeshBasicMaterial({ color: 0xbfdbfe }));
    this.object3D.add(wall, floor, ring);
    this._timers = new Map();
    this.surface = null;
  }

  onAdded() {
    const p = this.object3D.position;
    this.surface = this.world.physics.addSurface(new Surface({ owner: this, shape: 'circle', x: p.x, z: p.z, top: p.y + 0.03, radius: this.radius * 0.85 }));
  }
  onRemoved() { this.world.physics.removeSurface(this.surface); }

  update(dt) {
    for (const obj of [...this.world.physics.bodies]) {
      if (obj.body.support !== this.surface || !obj.spawnItem) continue;
      const t = (this._timers.get(obj) ?? 0) + dt;
      if (t > 0.6) { this._timers.delete(obj); this.world.audio?.play('ding', 0.5); this.world.bus.emit('lab:respawn', { object: obj }); }
      else this._timers.set(obj, t);
    }
  }
}
