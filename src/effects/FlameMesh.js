import * as THREE from 'three';

const _q = new THREE.Quaternion();

/**
 * A small flickering flame (outer glow + inner core, additive) that always burns upward no matter
 * how its parent is tilted. Add `object3D` to the burning object and call `update()` each frame.
 */
export class FlameMesh {
  constructor({ radius = 0.006, height = 0.016, outer = 0xffa234, inner = 0x4f7dff } = {}) {
    this.radius = radius; this.height = height;
    this.object3D = new THREE.Group();
    const mat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    const geo = new THREE.SphereGeometry(1, 12, 10).translate(0, 1, 0);
    this.outer = new THREE.Mesh(geo, mat(outer, 0.85));
    this.inner = new THREE.Mesh(geo, mat(inner, 0.8));
    for (const m of [this.outer, this.inner]) { m.raycast = () => {}; this.object3D.add(m); }
    this.object3D.visible = false;
    this.size = 1;
  }

  set visible(v) { this.object3D.visible = v; }
  get visible() { return this.object3D.visible; }

  setColor(outer, inner = null) {
    this.outer.material.color.set(outer);
    if (inner != null) this.inner.material.color.set(inner);
  }

  /** World point at the hot tip. */
  tip(target = new THREE.Vector3()) {
    return this.object3D.localToWorld(target.set(0, this.outer.scale.y * 1.6, 0));
  }

  update(time, size = this.size) {
    if (!this.object3D.visible) return;
    const parent = this.object3D.parent;
    if (parent) { parent.updateMatrixWorld(true); parent.getWorldQuaternion(_q).invert(); this.object3D.quaternion.copy(_q); }
    const f = 1 + Math.sin(time * 31) * 0.08 + Math.sin(time * 17.3) * 0.06 + (Math.random() - 0.5) * 0.08;
    this.outer.scale.set(this.radius * size, this.height * size * f, this.radius * size);
    this.inner.scale.set(this.radius * 0.5 * size, this.height * 0.35 * size * f, this.radius * 0.5 * size);
    this.object3D.updateMatrixWorld(true);
  }
}
