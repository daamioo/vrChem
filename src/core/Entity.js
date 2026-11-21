import * as THREE from 'three';

/**
 * Base class of everything that lives in the world. An Entity owns a THREE.Group
 * (`object3D`) and gets `update(dt)` called every frame while it is in the World.
 */
export class Entity {
  constructor(world) {
    this.world = world;
    this.object3D = new THREE.Group();
    this.tags = new Set();
  }

  /** Called once by World.add(). Override to register with systems / build meshes. */
  onAdded() {}
  update(_dt) {}
  /** Called by World.remove(). Override to unregister; always call super.dispose(). */
  onRemoved() {}

  get position() { return this.object3D.position; }

  setPosition(x, y, z) { this.object3D.position.set(x, y, z); return this; }
  setRotationY(rad) { this.object3D.rotation.y = rad; return this; }

  /** Disposes geometries and materials of every mesh below this entity. */
  disposeMeshes() {
    this.object3D.traverse((o) => {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) { m.map?.dispose?.(); m.dispose(); }
    });
  }
}
