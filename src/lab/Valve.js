import * as THREE from 'three';

const _c = new THREE.Vector3();
const _v = new THREE.Vector3();
const _up = new THREE.Vector3();

/**
 * A cylinder handwheel that turns about its local +Y axis. Grip it and either twist your wrist or
 * move your hand round the wheel: counter-clockwise (seen from above) opens, clockwise closes —
 * "lefty loosey". `open` goes 0..1 over `turns` full revolutions. Same control interface as
 * Dial / Lever (distanceToPoint / beginGrab / endGrab / update).
 */
export class Valve {
  /** @param {{radius?:number, turns?:number, color?:string|number, onChange?:(open:number)=>void}} o */
  constructor(world, { radius = 0.04, turns = 1.5, color = '#1f2937', onChange } = {}) {
    this.world = world;
    this.radius = radius;
    this.maxAngle = turns * Math.PI * 2;
    this.angle = 0;
    this.open = 0;
    this.onChange = onChange;
    this.hand = null;

    this.object3D = new THREE.Group();
    this.wheel = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.4 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.16, 8, 28).rotateX(Math.PI / 2), mat);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.25, radius * 0.25, radius * 0.4, 12), mat);
    this.wheel.add(rim, hub);
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(radius * 2, radius * 0.12, radius * 0.16), mat);
      spoke.rotation.y = (i * Math.PI) / 4;
      this.wheel.add(spoke);
    }
    // A bright knob on the rim makes the rotation easy to see.
    const knob = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.2, 10, 8), new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.4 }));
    knob.position.set(radius, radius * 0.12, 0);
    this.wheel.add(knob);
    this.object3D.add(this.wheel);
    world.controls.add(this);
  }

  dispose() { this.world.controls.delete(this); }

  get center() { return this.object3D.getWorldPosition(_c); }

  distanceToPoint(p) {
    return Math.max(0, this.center.distanceTo(p) - this.radius * 1.2);
  }

  /** Angle of the hand around the wheel axis (orbit) and of the hand's own heading (twist). */
  _angles(hand) {
    const c = this.center;
    this.object3D.getWorldQuaternion(this._wq ??= new THREE.Quaternion());
    this._iq = (this._iq ??= new THREE.Quaternion()).copy(this._wq).invert();
    const rel = _v.copy(hand.position).sub(c).applyQuaternion(this._iq);
    const orbit = Math.atan2(rel.x, rel.z);
    const orbitR = Math.hypot(rel.x, rel.z);
    // Twist: hand's sideways (X) and forward (-Z) axes projected onto the wheel plane.
    const x = _up.set(1, 0, 0).applyQuaternion(hand.quaternion).applyQuaternion(this._iq);
    const twistX = Math.atan2(x.x, x.z), wX = Math.hypot(x.x, x.z);
    const f = _v.set(0, 0, -1).applyQuaternion(hand.quaternion).applyQuaternion(this._iq);
    const twistF = Math.atan2(f.x, f.z), wF = Math.hypot(f.x, f.z);
    return { orbit, orbitR, twistX, wX, twistF, wF };
  }

  beginGrab(hand) { this.hand = hand; this._last = this._angles(hand); }
  endGrab() { this.hand = null; }

  update() {
    const hand = this.hand;
    if (!hand) return;
    const a = this._angles(hand), l = this._last;
    const wrap = (d) => (d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d);
    const orbit = a.orbitR > 0.015 ? wrap(a.orbit - l.orbit) : 0;
    const twist = a.wX >= a.wF ? wrap(a.twistX - l.twistX) : wrap(a.twistF - l.twistF);
    this._last = a;
    // Orbiting the wheel also rotates the hand, so use whichever gesture moved more, not both.
    let d = Math.abs(orbit) > Math.abs(twist) ? orbit : twist;
    if (Math.abs(d) > 0.6) d = 0;                       // tracking glitch
    const before = this.angle;
    this.angle = THREE.MathUtils.clamp(this.angle + d, 0, this.maxAngle);
    this.wheel.rotation.y = this.angle;
    if (this.angle === before) return;

    // A soft click every eighth of a turn, and a firmer stop at either end.
    const notch = Math.PI / 4;
    if (Math.floor(before / notch) !== Math.floor(this.angle / notch)) { hand.pulse(0.25, 15); this.world.audio?.play('squeak', 0.7); }
    if ((this.angle === 0 || this.angle === this.maxAngle) && before !== this.angle) { hand.pulse(0.7, 50); this.world.audio?.play('tick', 0.8); }
    this.open = this.angle / this.maxAngle;
    this.onChange?.(this.open);
  }
}
