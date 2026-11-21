import * as THREE from 'three';
import { LabObject } from './LabObject.js';
import { Container } from './Container.js';

/**
 * A hand tool whose tip (local origin) can be dipped into a Container. Subclasses decide what
 * the dip does via `onImmersed(container, dt)`. Probes lie flat when put down.
 */
export class Probe extends LabObject {
  build() {
    const { length, radius, color } = this.def;
    this.height = length;
    this.grabRadius = Math.max(0.03, radius * 2);
    this.immersedIn = null;
    this.tipVelocity = new THREE.Vector3();
    this._prevTip = new THREE.Vector3();
    this._tip = new THREE.Vector3();
    this._first = true;
    this.buildBody(length, radius, color);
  }

  /** Subclasses add their meshes here. */
  buildBody(length, radius, color) {
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, length, 12).translate(0, length / 2, 0),
      new THREE.MeshPhongMaterial({ color, shininess: 90, transparent: true, opacity: 0.85 }),
    );
    this.object3D.add(rod);
  }

  onAdded() { super.onAdded(); this.body.restHeight = this.def.radius ?? 0.005; }

  restQuaternion(yaw) {
    return this._rest.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw).multiply(this._lay);
  }

  get tipWorld() { return this.worldPointAt(0, this._tip); }

  update(dt) {
    this.object3D.updateMatrixWorld(true);
    const tip = this.tipWorld;
    if (this._first) { this._prevTip.copy(tip); this._first = false; }
    this.tipVelocity.copy(tip).sub(this._prevTip).divideScalar(Math.max(dt, 1e-4));
    this._prevTip.copy(tip);

    this.immersedIn = null;
    for (const t of this.world.pourTargets) {
      if (t instanceof Container && t.containsPoint(tip)) { this.immersedIn = t; break; }
    }
    if (this.immersedIn) this.onImmersed(this.immersedIn, dt);
    this.onFrame(dt);
  }

  onImmersed(_container, _dt) {}
  onFrame(_dt) {}
}
