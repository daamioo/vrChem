import * as THREE from 'three';

/**
 * Deliberately small physics: gravity, landing on Surfaces, self-righting and room bounds.
 * Bodies are LabObjects (anything with `.object3D`, `.body`, `.restQuaternion(yaw)`, `.onImpact`).
 */
export class PhysicsBody {
  constructor() {
    this.velocity = new THREE.Vector3();
    this.support = null;      // Surface currently resting on
    this.held = null;         // Hand currently holding
    this.pinned = null;       // {position, quaternion}: stuck to a wall (e.g. magnetic eraser)
    this.restHeight = 0;      // origin height above the surface when resting
  }
}

export class PhysicsSystem {
  constructor(world) {
    this.world = world;
    this.surfaces = new Set();
    this.bodies = new Set();
    this.gravity = world.settings.gravity ?? 9.81;
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._q = new THREE.Quaternion();
    this._rq = new THREE.Quaternion();
    this._s0 = new THREE.Vector3(); this._s1 = new THREE.Vector3(); this._cp = new THREE.Vector3();
    this._n = new THREE.Vector3(); this._dv = new THREE.Vector3(); this._va = new THREE.Vector3(); this._vb = new THREE.Vector3();
    this._axis = new THREE.Vector3();
  }

  addSurface(s) { this.surfaces.add(s); return s; }
  removeSurface(s) { this.surfaces.delete(s); }
  addBody(obj) { this.bodies.add(obj); }
  removeBody(obj) { this.bodies.delete(obj); }

  /**
   * Keeps a body inside the room. Ordinary objects stop with a small bounce; bodies with a
   * `restitution` bounce off. Reports the impact (so glass can break). Returns true on a hit.
   */
  _walls(obj) {
    const b = obj.body, p = obj.object3D.position, room = this.world.settings.room;
    const hx = room.width / 2 - Math.max(0.1, b.restHeight), hz = room.depth / 2 - Math.max(0.1, b.restHeight);
    const k = -(b.restitution ?? 0.2);
    let hit = 0;
    if (Math.abs(p.x) > hx) { p.x = Math.sign(p.x) * hx; hit = Math.max(hit, Math.abs(b.velocity.x)); b.velocity.x *= k; }
    if (Math.abs(p.z) > hz) { p.z = Math.sign(p.z) * hz; hit = Math.max(hit, Math.abs(b.velocity.z)); b.velocity.z *= k; }
    if (hit > 0.3) { obj.onImpact?.(hit, null); return true; }
    return false;
  }

  /** Spins a ball to match its horizontal motion (no slipping); `factor` < 1 for loose air spin. */
  _roll(obj, dt, factor = 1) {
    const v = obj.body.velocity;
    const speed = Math.hypot(v.x, v.z);
    if (speed < 1e-4) return;
    this._axis.set(v.z, 0, -v.x).divideScalar(speed);                  // up × velocity
    this._rq.setFromAxisAngle(this._axis, (speed * dt * factor) / obj.body.rollRadius);
    obj.object3D.quaternion.premultiply(this._rq);
  }

  /**
   * Balls (bodies with `rollRadius`) against every object with a collision capsule — including
   * other balls. Momentum is exchanged by mass; a held object counts as immovable and moves at
   * the hand's speed, so you can bat a ball with a beaker or swat a beaker with a held ball.
   */
  _collideBalls() {
    const all = [...this.bodies];
    const balls = all.filter((o) => o.body.rollRadius);
    balls.forEach((A, i) => {
      const ra = A.collisionRadius;
      A.object3D.updateMatrixWorld(true);
      const ca = A.object3D.getWorldPosition(this._cp.clone());
      for (const B of all) {
        if (B === A) continue;
        const rb = B.collisionRadius;
        if (!rb) continue;
        if (B.body.rollRadius && balls.indexOf(B) < i) continue;           // ball pair already done
        if (A.body.held && B.body.held) continue;
        B.object3D.updateMatrixWorld(true);
        B.collisionSegment(this._s0, this._s1);
        // closest point on B's axis to A's centre
        const seg = this._s1.sub(this._s0);
        const len2 = seg.lengthSq();
        const t = len2 > 1e-9 ? THREE.MathUtils.clamp(this._n.copy(ca).sub(this._s0).dot(seg) / len2, 0, 1) : 0;
        const cp = this._s0.addScaledVector(seg, t);
        const n = this._n.copy(ca).sub(cp);
        const dist = n.length();
        const overlap = ra + rb - dist;
        if (overlap <= 0 || dist < 1e-6) continue;
        n.divideScalar(dist);

        const invA = A.body.held || A.body.pinned ? 0 : 1000 / A.totalMassG;
        const invB = B.body.held || B.body.pinned ? 0 : 1000 / B.totalMassG;
        if (invA + invB === 0) continue;
        const va = this._va.copy(A.body.held ? A.body.held.velocity : A.body.velocity);
        const vb = this._vb.copy(B.body.held ? B.body.held.velocity : B.body.velocity);

        // separate (resting objects only slide sideways)
        const pa = (overlap * invA) / (invA + invB), pb = (overlap * invB) / (invA + invB);
        A.object3D.position.addScaledVector(n, pa);
        ca.addScaledVector(n, pa);
        if (pb && !B.body.rollRadius) { this._dv.copy(n).multiplyScalar(-pb); this._dv.y = 0; B.object3D.position.add(this._dv); }
        else if (pb) B.object3D.position.addScaledVector(n, -pb);

        const vn = va.sub(vb).dot(n);
        if (vn >= 0) continue;                                              // already separating
        const e = Math.min(A.body.restitution ?? 0.5, 0.75);
        const j = (-(1 + e) * vn) / (invA + invB);
        if (invA) {
          A.body.velocity.addScaledVector(n, j * invA);
          if (A.body.support && A.body.velocity.y > 0.4) A.body.support = null;   // knocked up into the air
        }
        A.onImpact?.(-vn, null);
        if (invB) B.onKnock(this._dv.copy(n).multiplyScalar(-j * invB), cp, n);
      }
    });
  }

  /**
   * A body that just moved (from prevX/prevZ) into the side of a solid (bench cabinet, hot plate
   * case) is put back and bounces off: the velocity component that took it in is reversed.
   */
  _bounceOffSolids(obj, prevX, prevZ, bottomY) {
    const p = obj.object3D.position, b = obj.body;
    if (!this.solidAt(p.x, bottomY, p.z) || this.solidAt(prevX, bottomY, prevZ)) return false;
    const e = Math.min(0.8, b.restitution ?? 0.2);
    const hitX = !!this.solidAt(p.x, bottomY, prevZ), hitZ = !!this.solidAt(prevX, bottomY, p.z);
    const speed = Math.hypot(hitX || !hitZ ? b.velocity.x : 0, hitZ || !hitX ? b.velocity.z : 0);
    if (hitX || !hitZ) b.velocity.x *= -e;
    if (hitZ || !hitX) b.velocity.z *= -e;
    p.x = prevX; p.z = prevZ;
    if (speed > 0.3) obj.onImpact?.(speed, null);
    return true;
  }

  /** Highest surface whose solid body contains the point, or null. */
  solidAt(x, y, z) {
    let best = null;
    for (const s of this.surfaces) if (s.isInside(x, y, z) && (!best || s.top > best.top)) best = s;
    return best;
  }

  /** Highest surface under (x,z) whose top is not above `maxTop`. */
  surfaceAt(x, z, maxTop = Infinity) {
    let best = null;
    for (const s of this.surfaces) {
      if (s.top <= maxTop && s.contains(x, z) && (!best || s.top > best.top)) best = s;
    }
    return best;
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    for (const obj of this.bodies) {
      const b = obj.body;
      const p = obj.object3D.position;

      if (b.held) { b.velocity.set(0, 0, 0); b.support = null; continue; }
      if (b.pinned) { p.copy(b.pinned.position); obj.object3D.quaternion.copy(b.pinned.quaternion); b.velocity.set(0, 0, 0); continue; }

      // Self-right toward the object's rest orientation (keeping its heading).
      this._euler.setFromQuaternion(obj.object3D.quaternion, 'YXZ');
      this._q.copy(obj.restQuaternion(this._euler.y));
      obj.object3D.quaternion.slerp(this._q, 1 - Math.exp(-(b.support ? 14 : 4) * dt));

      if (b.support) {
        if (!b.support.contains(p.x, p.z)) b.support = null;             // rolled / slid off the edge
        else if (b.velocity.lengthSq() > 4e-4) {
          // Rolling (balls: low friction, spins) or sliding after a knock (high friction).
          b.velocity.y = 0;
          b.velocity.multiplyScalar(Math.exp(-(b.rollRadius ? (b.rollFriction ?? 0.9) : (b.slideFriction ?? 6)) * dt));
          const px = p.x, pz = p.z;
          p.addScaledVector(b.velocity, dt);
          p.y = b.support.top + b.restHeight;
          this._bounceOffSolids(obj, px, pz, p.y - b.restHeight + 0.001);   // e.g. a ball rolling into a bench
          if (b.rollRadius) this._roll(obj, dt);
          if (this._walls(obj) && !this.bodies.has(obj)) continue;
          continue;
        } else { p.y = b.support.top + b.restHeight; b.velocity.set(0, 0, 0); continue; }
      }

      const prevY = p.y, prevX = p.x, prevZ = p.z;
      b.velocity.y -= this.gravity * dt;
      p.addScaledVector(b.velocity, dt);
      if (b.rollRadius) this._roll(obj, dt, 0.5);
      if (this._walls(obj) && !this.bodies.has(obj)) continue;

      const surface = this.surfaceAt(p.x, p.z, prevY - b.restHeight + 0.02);
      const landing = surface && p.y - b.restHeight <= surface.top;
      if (!landing) {
        const inside = this.solidAt(p.x, p.y - b.restHeight, p.z);
        if (inside) {
          // Already inside it last frame = let go inside a bench: pop out onto the top.
          // Flew into it from the side (a thrown ball): bounce off the cabinet instead.
          if (this.solidAt(prevX, prevY - b.restHeight, prevZ) === inside) {
            p.y = inside.top + b.restHeight; b.support = inside; b.velocity.set(0, 0, 0); obj.onImpact?.(0, inside);
          } else this._bounceOffSolids(obj, prevX, prevZ, p.y - b.restHeight);
          continue;
        }
      }
      if (landing) {
        const speed = Math.abs(b.velocity.y);
        p.y = surface.top + b.restHeight;
        if (b.restitution && speed > 0.6) {
          // Bounce: lose some height, keep most of the sideways motion.
          b.velocity.y = speed * b.restitution;
          b.velocity.x *= 0.9; b.velocity.z *= 0.9;
        } else {
          b.support = surface;
          if (b.rollRadius) b.velocity.y = 0; else b.velocity.set(0, 0, 0);
        }
        obj.onImpact?.(speed, surface);
      }
    }
    this._collideBalls();
  }
}
