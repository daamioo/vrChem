import * as THREE from 'three';

/**
 * Moves the rig. Three ways, all usable at once:
 *  - grab-the-world: grip / pinch empty air and pull — the room moves with your hand like a rope;
 *    with both hands, twisting them around each other turns you as well;
 *  - smooth walking + snap-turning from thumbsticks or pinch gestures.
 */
export class XRLocomotion {
  /** @param {XRHand[]} hands  both controllers; left/right are resolved by handedness each frame */
  constructor(world, rig, hands) {
    this.world = world; this.rig = rig; this.hands = hands;
    const p = world.settings.player;
    this.speed = p.moveSpeed;
    this.snap = THREE.MathUtils.degToRad(p.snapTurnDegrees);
    this._snapReady = true;
    this._fwd = new THREE.Vector3(); this._side = new THREE.Vector3(); this._head = new THREE.Vector3();
    this._prev = new Map();          // hand -> previous rig-local position while air-grabbing
    this._invQ = new THREE.Quaternion();
    this._d = new THREE.Vector3(); this._m = new THREE.Vector3(); this._pivot = new THREE.Vector3();
  }

  /** Hand position in rig (tracking-space) coordinates, which do not change when the rig moves. */
  _local(hand, target) {
    return target.copy(hand.position).sub(this.rig.position).applyQuaternion(this._invQ);
  }

  _grabMove() {
    const rig = this.rig;
    this._invQ.copy(rig.quaternion).invert();
    const grabbing = this.hands.filter((h) => h.airGrab);
    for (const h of this._prev.keys()) if (!grabbing.includes(h)) this._prev.delete(h);
    const cur = [], prev = [];
    for (const h of grabbing) {
      const l = this._local(h, new THREE.Vector3());
      const p = this._prev.get(h);
      this._prev.set(h, l);
      if (p) { cur.push(l); prev.push(p); }
    }
    if (!cur.length) return false;

    if (cur.length >= 2) {
      // Rotation: the angle of the line between the hands, seen from above.
      const a = Math.atan2(cur[1].x - cur[0].x, cur[1].z - cur[0].z);
      const b = Math.atan2(prev[1].x - prev[0].x, prev[1].z - prev[0].z);
      let da = a - b;
      if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
      if (Math.abs(da) < 0.2) {
        // Pivot the rig around the point between the hands so the world stays glued to them.
        this._pivot.copy(cur[0]).add(cur[1]).multiplyScalar(0.5).applyQuaternion(rig.quaternion).add(rig.position);
        rig.position.sub(this._pivot).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -da).add(this._pivot);
        rig.rotateY(-da);
      }
      this._d.copy(cur[0]).add(cur[1]).sub(prev[0]).sub(prev[1]).multiplyScalar(0.5);
    } else this._d.copy(cur[0]).sub(prev[0]);

    this._d.y = 0;
    if (this._d.lengthSq() > 0.04) return true;      // tracking glitch (> 20 cm in one frame): ignore
    rig.position.sub(this._d.applyQuaternion(rig.quaternion));
    return true;
  }

  update(dt) {
    const room = this.world.settings.room;
    if (this.world.settings.player.grabMove !== false && this._grabMove()) {
      this.rig.position.x = THREE.MathUtils.clamp(this.rig.position.x, -room.width / 2 + 0.3, room.width / 2 - 0.3);
      this.rig.position.z = THREE.MathUtils.clamp(this.rig.position.z, -room.depth / 2 + 0.3, room.depth / 2 - 0.3);
    }
    // Each hand reports `move` ({x,y}) and `turn` (-1/0/1): from thumbsticks or from pinch gestures.
    const L = { x: 0, y: 0 };
    let turn = 0;
    for (const h of this.hands) {
      const m = h.move;
      L.x += m.x; L.y += m.y;
      turn = turn || h.turn;
    }
    L.x = THREE.MathUtils.clamp(L.x, -1, 1); L.y = THREE.MathUtils.clamp(L.y, -1, 1);
    const R = { x: turn };
    const cam = this.world.camera;

    if (L.x || L.y) {
      cam.getWorldDirection(this._fwd);
      this._fwd.y = 0; this._fwd.normalize();
      this._side.set(-this._fwd.z, 0, this._fwd.x);
      this.rig.position.addScaledVector(this._fwd, L.y * this.speed * dt);
      this.rig.position.addScaledVector(this._side, L.x * this.speed * dt);
      this.rig.position.x = THREE.MathUtils.clamp(this.rig.position.x, -room.width / 2 + 0.3, room.width / 2 - 0.3);
      this.rig.position.z = THREE.MathUtils.clamp(this.rig.position.z, -room.depth / 2 + 0.3, room.depth / 2 - 0.3);
    }

    if (Math.abs(R.x) > 0.6) {
      if (this._snapReady) {
        // Rotate the rig around the player's head so the view pivots in place.
        cam.getWorldPosition(this._head);
        const a = -Math.sign(R.x) * this.snap;
        this.rig.position.sub(this._head).applyAxisAngle(THREE.Object3D.DEFAULT_UP, a).add(this._head);
        this.rig.rotateY(a);
        this._snapReady = false;
      }
    } else this._snapReady = true;
  }
}
