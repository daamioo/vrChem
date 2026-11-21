import * as THREE from 'three';

/** Pool of flat white blobs stuck to surfaces where extinguisher foam lands; they fade after a while. */
export class FoamSplats {
  constructor(scene, max = 90, lifetime = 25) {
    this.max = max; this.lifetime = lifetime;
    this.geo = new THREE.CircleGeometry(1, 14);
    this.items = [];
    this.next = 0;
    for (let i = 0; i < max; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.visible = false;
      mesh.raycast = () => {};
      scene.add(mesh);
      this.items.push({ mesh, age: Infinity });
    }
  }

  /** @param {THREE.Vector3} point @param {THREE.Vector3} normal world-space, facing the viewer */
  add(point, normal, radius = 0.05 + Math.random() * 0.05) {
    const it = this.items[this.next]; this.next = (this.next + 1) % this.max;
    it.age = 0;
    it.mesh.visible = true;
    it.mesh.position.copy(point).addScaledVector(normal, 0.004);
    it.mesh.lookAt(point.x + normal.x, point.y + normal.y, point.z + normal.z);
    it.mesh.scale.set(radius, radius * (0.7 + Math.random() * 0.5), 1);
    it.mesh.rotateZ(Math.random() * Math.PI);
  }

  /** Wipes every splat (room reset). */
  clear() { for (const it of this.items) { it.age = Infinity; it.mesh.visible = false; } }

  update(dt) {
    for (const it of this.items) {
      if (it.age === Infinity) continue;
      it.age += dt;
      const t = it.age / this.lifetime;
      if (t >= 1) { it.mesh.visible = false; it.age = Infinity; continue; }
      it.mesh.material.opacity = 0.92 * Math.min(1, it.age * 8) * (t > 0.7 ? (1 - t) / 0.3 : 1);
    }
  }
}
