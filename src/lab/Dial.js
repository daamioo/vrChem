import * as THREE from 'three';

const MIN_ANGLE = -Math.PI * 0.75;
const MAX_ANGLE = Math.PI * 0.75;

/**
 * A physical rotary knob on an upward-facing surface. Grip it (like any object) and move your
 * hand in a circle around it to turn; it clicks between `steps` detents. With `snap: true` the
 * knob jumps from detent to detent while you turn (a chunky selector switch) instead of following
 * the hand smoothly. Owned by a station, which calls update() and dispose().
 */
export class Dial {
  constructor(world, { radius = 0.024, steps = 11, startStep = 0, color = '#dc2626', snap = false, onChange }) {
    this.world = world;
    this.radius = radius;
    this.steps = steps;
    this.snap = snap;
    this.step = startStep;
    this.onChange = onChange;
    this.hand = null;
    this.angle = this.angleForStep(startStep);

    this.object3D = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    this.knob = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.08, 0.022, 24).translate(0, 0.011, 0), mat);
    const pointer = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.004, radius * 0.8).translate(0, 0.024, radius * 0.45), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.knob.add(body, pointer);
    // Tick marks around the dial face so the range is readable.
    const tickMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let i = 0; i < steps; i++) {
      const a = this.angleForStep(i);
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.001, 0.007), tickMat);
      t.position.set(Math.sin(a) * (radius + 0.012), 0.0006, Math.cos(a) * (radius + 0.012));
      t.rotation.y = a;
      this.object3D.add(t);
    }
    this.object3D.add(this.knob);
    this.knob.rotation.y = this.angle;
    this._c = new THREE.Vector3();
    world.controls.add(this);
  }

  dispose() { this.world.controls.delete(this); }

  angleForStep(i) { return this.steps < 2 ? 0 : MIN_ANGLE + (i / (this.steps - 1)) * (MAX_ANGLE - MIN_ANGLE); }

  get center() { return this.object3D.getWorldPosition(this._c); }

  /** Distance from a world point to the knob (0 when touching it). */
  distanceToPoint(p) {
    const c = this.center;
    c.y += 0.012;
    return Math.max(0, c.distanceTo(p) - this.radius);
  }

  _handAngle(hand) {
    const c = this.center;
    return Math.atan2(hand.position.x - c.x, hand.position.z - c.z);
  }

  beginGrab(hand) { this.hand = hand; this._last = this._handAngle(hand); }
  endGrab() { this.hand = null; this.angle = this.angleForStep(this.step); this.knob.rotation.y = this.angle; }

  update() {
    const hand = this.hand;
    if (!hand) return;
    const a = this._handAngle(hand);
    let d = a - this._last;
    if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
    this._last = a;
    this.angle = THREE.MathUtils.clamp(this.angle + d, MIN_ANGLE, MAX_ANGLE);
    const step = Math.round(((this.angle - MIN_ANGLE) / (MAX_ANGLE - MIN_ANGLE)) * (this.steps - 1));
    if (step !== this.step) {
      this.step = step;
      hand.pulse(0.4, 25);
      this.world.audio?.play('tick', 0.8);
      this.onChange?.(step);
    }
    this.knob.rotation.y = this.snap ? this.angleForStep(this.step) : this.angle;
  }
}
