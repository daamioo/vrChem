import * as THREE from 'three';
import { LabObject } from './LabObject.js';

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3(), _n = new THREE.Vector3();
const _ry = new THREE.Matrix4(), _hold = new THREE.Matrix4();

/**
 * Pick it up and hold the trigger to spray white foam where your hand points. Foam flies in an
 * arc, and sticks to whatever it hits as fading white blobs. The charge drains while spraying
 * and slowly refills when idle (see sprayDurationS / rechargePerS in equipment.json).
 * Picked up, it snaps into your hand by its handle with the nozzle pointing where your hand
 * points (the same direction the foam goes), the cylinder hanging below.
 */
export class FireExtinguisher extends LabObject {
  build() {
    this.height = 0.5;
    this.grabRadius = 0.09;
    this.charge = 1;
    this.ray = new THREE.Raycaster();
    this.ray.far = 4;
    this._timer = 0;

    const red = new THREE.MeshStandardMaterial({ color: 0xc8261f, roughness: 0.4, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.5, metalness: 0.5 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xb4bcc6, roughness: 0.3, metalness: 0.8 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); this.object3D.add(m); return m; };
    add(new THREE.CylinderGeometry(0.07, 0.07, 0.36, 20), red, 0, 0.2, 0);
    add(new THREE.SphereGeometry(0.07, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), red, 0, 0.38, 0).scale.y = 0.7;
    add(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 20), dark, 0, 0.012, 0);
    add(new THREE.CylinderGeometry(0.022, 0.026, 0.06, 10), steel, 0, 0.47, 0);
    add(new THREE.BoxGeometry(0.1, 0.02, 0.025), dark, 0.03, 0.51, 0);       // squeeze handle
    add(new THREE.BoxGeometry(0.1, 0.014, 0.025), dark, 0.0, 0.485, 0);
    add(new THREE.CylinderGeometry(0.036, 0.016, 0.07, 10).rotateZ(Math.PI / 2), dark, 0.11, 0.45, 0).rotation.z = 0.2;  // nozzle horn
    const label = add(new THREE.PlaneGeometry(0.09, 0.12), new THREE.MeshBasicMaterial({ color: 0xf4f4ee }), 0, 0.2, 0.0715);
    label.renderOrder = 2;
    this.nozzle = new THREE.Vector3(0.15, 0.46, 0);
  }

  /** Held by the handle: nozzle (local +X) along the hand's pointing direction (-Z), body below. */
  holdOffset() {
    _ry.makeRotationY(Math.PI / 2);                         // local +X -> hand -Z
    return _hold.makeTranslation(0, -0.49, 0).multiply(_ry);  // handle (y ≈ 0.49) in the palm
  }

  get totalMassG() { return this.def.massG ?? 2500; }
  onAdded() { super.onAdded(); this.body.restHeight = 0; }

  update(dt) {
    const hand = this.body.held;
    const spraying = !!hand?.triggerPressed && this.charge > 0.01;
    if (spraying) this._spray(hand, dt);
    else this.charge = Math.min(1, this.charge + (this.def.rechargePerS ?? 0.08) * dt);
    this.spraying = spraying;
  }

  _spray(hand, dt) {
    const w = this.world;
    this.charge = Math.max(0, this.charge - dt / (this.def.sprayDurationS ?? 12));
    this.object3D.updateMatrixWorld(true);
    const origin = this.object3D.localToWorld(_o.copy(this.nozzle));
    const dir = _d.set(0, 0, -1).applyQuaternion(hand.quaternion);

    const foam = w.particles?.foam;
    foam?.emitRate(160 * dt, () => {
      const speed = 3 + Math.random() * 1.2;
      _v.set((Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.35).add(dir).normalize().multiplyScalar(speed);
      foam.emit(origin, _v, [1, 1, 1, 0.85], 0.03 + Math.random() * 0.03, 0.9 + Math.random() * 0.5, 1.6);
    });
    w.audio?.play('spray', 0.8);
    hand.pulse?.(0.2, 30);

    // Where the stream lands: stick foam splats to the first surface hit.
    this._timer -= dt;
    if (this._timer <= 0) {
      this._timer = 0.06;
      this.ray.set(origin, dir);
      const hits = this.ray.intersectObjects(w.scene.children, true);
      const hit = hits.find((h) => h.object.isMesh && h.object.visible && h.face && !this._isOwn(h.object) && h.object.material.opacity > 0.3);
      if (hit) {
        _n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        if (_n.dot(dir) > 0) _n.negate();
        w.foamSplats?.add(hit.point, _n);
      }
    }
  }

  _isOwn(obj) {
    for (let o = obj; o; o = o.parent) if (o === this.object3D) return true;
    return false;
  }
}
