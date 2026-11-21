import * as THREE from 'three';
import { LabObject } from './LabObject.js';

const _c = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * A rubber bouncy ball. Throw it and it bounces off the floor, tables and walls, then rolls to a
 * stop (and off table edges). While held, squeeze it — trigger on a controller, curl your fingers
 * with bare hands, Space on desktop — and it squashes in your hand and squeaks.
 * Origin is the ball's centre (unlike other LabObjects) so it can spin freely.
 * def: { radius, color, stripeColor, restitution, massG }
 */
export class BouncyBall extends LabObject {
  build() {
    const def = this.def;
    const r = this.radius = def.radius ?? 0.035;
    this.height = 0;
    this.grabRadius = r;
    this.squeeze = 0;           // 0..1, smoothed
    this._impact = 0;           // squash left over from the last bounce
    this._lastNotch = 0;

    // Two-tone rubber: base colour with a stripe round the equator and one meridian, so spin shows.
    const geo = new THREE.SphereGeometry(r, 28, 20);
    const base = new THREE.Color(def.color ?? '#ef4444'), stripe = new THREE.Color(def.stripeColor ?? '#fde047');
    const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / r, y = pos.getY(i) / r, z = pos.getZ(i) / r;
      const c = Math.abs(y) < 0.16 || (Math.abs(x) < 0.14 && z > 0) ? stripe : base;
      cols.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 }));
    // squash frame: rotated so its Y is the squash direction, scaled, with the mesh counter-rotated
    // inside so the ball's pattern doesn't turn — net effect is a squash along any world axis.
    this.squashFrame = new THREE.Group();
    this.squashFrame.add(this.mesh);
    this.object3D.add(this.squashFrame);
  }

  onAdded() {
    super.onAdded();
    const b = this.body;
    b.restHeight = this.radius;
    b.restitution = this.def.restitution ?? 0.78;
    b.rollRadius = this.radius;          // rolls on surfaces instead of stopping dead
  }

  get totalMassG() { return this.def.massG ?? 40; }
  get collisionRadius() { return this.radius; }
  onKnock(dv) { this.body.velocity.add(dv); if (dv.y > 0.4) this.body.support = null; }

  /** A ball has no "upright": keep whatever orientation it has. */
  restQuaternion() { return this._rest.copy(this.object3D.quaternion); }

  distanceToPoint(p) {
    return Math.max(0, this.object3D.getWorldPosition(_c).distanceTo(p) - this.radius);
  }

  onImpact(speed) {
    if (speed < 0.3) return;
    this._impact = Math.min(0.45, Math.max(this._impact, speed * 0.09));
    this.world.audio?.play('boing', Math.min(1, speed / 4));
  }

  update(dt) {
    const hand = this.body.held;
    const target = hand ? (hand.squeeze ?? 0) : 0;
    // Squeezing in is quick; springing back out is a touch slower, like real rubber.
    this.squeeze += (target - this.squeeze) * (1 - Math.exp(-(target > this.squeeze ? 18 : 10) * dt));
    this._impact *= Math.exp(-14 * dt);

    if (hand && this.squeeze > 0.05) {
      const notch = Math.floor(this.squeeze * 6);
      if (notch !== this._lastNotch) {
        if (notch > this._lastNotch) this.world.audio?.play('rubberSqueak', 0.4 + this.squeeze * 0.8);
        this._lastNotch = notch;
      }
      hand.pulse?.(0.1 + this.squeeze * 0.5, 20);
    } else this._lastNotch = 0;

    // Squash: flatten along an axis (across the palm when held, vertical after a bounce),
    // bulge sideways, roughly keeping volume.
    const s = Math.min(0.6, this.squeeze * 0.5 + this._impact);
    const flat = 1 - s, bulge = 1 / Math.sqrt(flat);
    if (hand) _axis.set(1, 0, 0).applyQuaternion(hand.quaternion); else _axis.copy(UP);
    _axis.applyQuaternion(_q.copy(this.object3D.quaternion).invert());   // into ball-local space
    this.squashFrame.quaternion.setFromUnitVectors(UP, _axis.normalize());
    this.mesh.quaternion.copy(this.squashFrame.quaternion).invert();
    this.squashFrame.scale.set(bulge, flat, bulge);
  }
}
