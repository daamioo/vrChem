import * as THREE from 'three';
import { Entity } from '../core/Entity.js';

/** Anything poured into the bin disappears. Implements the PourTarget interface. */
export class WasteBin extends Entity {
  constructor(world, def) {
    super(world);
    this.def = def;
    const { radius: r, height: h, color } = def;
    this.radius = r; this.height = h;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, h, 24, 1, true), new THREE.MeshStandardMaterial({ color, roughness: 0.7, side: THREE.DoubleSide }));
    wall.position.y = h / 2;
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(r * 0.85, 24).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    bottom.position.y = 0.01;
    this.object3D.add(wall, bottom);
    this.disposed = 0;
  }

  onAdded() { this.world.pourTargets.add(this); }
  onRemoved() { this.world.pourTargets.delete(this); }

  canAccept() { return true; }
  getOpening() {
    return { center: new THREE.Vector3(this.position.x, this.position.y + this.height, this.position.z), radius: this.radius * 0.95 };
  }
  streamEndY() { return this.position.y + this.height * 0.4; }
  acceptPour(map) {
    for (const g of map.values()) this.disposed += g;
    this.world.audio?.play('pourSplash', 0.3);
  }
}
