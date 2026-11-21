import * as THREE from 'three';
import { Hand } from './Hand.js';

const PINCH_CLOSE = 0.024, PINCH_OPEN = 0.04;   // metres between fingertips (hysteresis)

/**
 * One tracked hand slot (index 0/1). It adapts to whatever the headset reports:
 *  - Touch controllers: grip = grab, trigger = trigger, sticks = move / turn.
 *  - Bare-hand tracking: thumb+index pinch = grab, thumb+middle pinch = trigger,
 *    thumb+ring pinch = walk forward (where you look), thumb+little pinch = snap-turn
 *    (left hand turns left, right hand turns right).
 *    Curling the other fingers into a fist while holding = squeeze (e.g. the rubber ball).
 *  - Either way, grabbing empty air and pulling moves you (see XRLocomotion).
 * Everything else sees only the abstract Hand fields.
 */
export class XRHand extends Hand {
  /**
   * @param {string} name
   * @param {THREE.Group} controller  renderer.xr.getController(i)
   * @param {THREE.Group} handGroup   renderer.xr.getHand(i)
   */
  constructor(name, controller, handGroup) {
    super(name);
    this.controller = controller;
    this.handGroup = handGroup;
    this.inputSource = null;
    this._v = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._pinch = { grab: false, trigger: false, ring: false, pinky: false };
    this._t = {};                    // scratch joint positions
    this.canAirGrab = true;

    controller.addEventListener('connected', (e) => { this.inputSource = e.data; });
    controller.addEventListener('disconnected', () => { this.inputSource = null; });

    // Stand-in "glove" for controllers: palm sphere + pointing finger.
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffd7b5, roughness: 0.6 });
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), this.mat);
    const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.06, 10).rotateX(Math.PI / 2), this.mat);
    finger.position.z = -0.05;
    this.controllerMeshes = [palm, finger];
    for (const m of this.controllerMeshes) m.raycast = () => {};
    controller.add(palm, finger);
    this._jointGeo = new THREE.SphereGeometry(1, 8, 6);
  }

  get handedness() { return this.inputSource?.handedness ?? this.name; }
  get gamepad() { return this.inputSource?.gamepad ?? null; }
  /** True while the headset is tracking bare hands in this slot. */
  get isTracked() { return !!this.inputSource?.hand; }

  /** Controller thumbstick as {x, y}, y positive = forward. */
  get stick() {
    const a = this.gamepad?.axes;
    if (!a) return { x: 0, y: 0 };
    const x = a.length >= 4 ? a[2] : a[0] ?? 0, y = a.length >= 4 ? a[3] : a[1] ?? 0;
    return { x: Math.abs(x) > 0.15 ? x : 0, y: Math.abs(y) > 0.15 ? -y : 0 };
  }

  /** Walking input for XRLocomotion (summed over hands). */
  get move() {
    if (this.isTracked) return { x: 0, y: this._pinch.ring ? 1 : 0 };
    return this.handedness === 'left' ? this.stick : { x: 0, y: 0 };
  }

  /** Snap-turn input for XRLocomotion: -1 left, +1 right, 0 none. */
  get turn() {
    if (this.isTracked) return this._pinch.pinky ? (this.handedness === 'left' ? -1 : 1) : 0;
    return this.handedness === 'right' ? this.stick.x : 0;
  }

  update() {
    const tracked = this.isTracked;
    for (const m of this.controllerMeshes) m.visible = !tracked;
    if (tracked) this._updateTracked(); else this._updateController();
  }

  _updateController() {
    const c = this.controller;
    c.updateMatrixWorld(true);
    this.matrixWorld.copy(c.matrixWorld);
    c.matrixWorld.decompose(this.position, this.quaternion, this._v.set(1, 1, 1));
    this._fwd.set(0, 0, -1).applyQuaternion(this.quaternion);
    this.touchPoint.copy(this.position).addScaledVector(this._fwd, 0.07);
    const b = this.gamepad?.buttons;
    this.triggerPressed = !!b?.[0]?.pressed;
    this.gripPressed = !!b?.[1]?.pressed;
    this.squeeze = b?.[0]?.value ?? 0;                     // hold with grip, squeeze with the trigger
    this._pinch.ring = this._pinch.pinky = false;
  }

  _joint(name) {
    const j = this.handGroup.joints?.[name];
    if (!j || !j.visible) return null;
    if (!j.userData.vis) {                       // lazily give each joint a small visible sphere
      const s = new THREE.Mesh(this._jointGeo, this.mat);
      s.scale.setScalar(0.0085); s.raycast = () => {};
      j.add(s); j.userData.vis = s;
    }
    return j.getWorldPosition(this._t[name] ??= new THREE.Vector3());
  }

  _updateTracked() {
    this.handGroup.updateMatrixWorld(true);
    const thumb = this._joint('thumb-tip'), index = this._joint('index-finger-tip');
    const middle = this._joint('middle-finger-tip'), ring = this._joint('ring-finger-tip'), pinky = this._joint('pinky-finger-tip');
    const wrist = this._joint('wrist'), midMeta = this._joint('middle-finger-metacarpal');
    const idxMeta = this._joint('index-finger-metacarpal'), pinkyMeta = this._joint('pinky-finger-metacarpal');
    if (!thumb || !index || !wrist) { this.gripPressed = this.triggerPressed = false; return; }   // tracking lost

    const upd = (key, tip) => {
      if (!tip) { this._pinch[key] = false; return; }
      const d = thumb.distanceTo(tip);
      this._pinch[key] = this._pinch[key] ? d < PINCH_OPEN : d < PINCH_CLOSE;
    };
    upd('grab', index); upd('trigger', middle); upd('ring', ring); upd('pinky', pinky);
    // A deliberate pinch with one finger should not also count as the others.
    if (this._pinch.grab) { this._pinch.ring = this._pinch.pinky = false; }
    this.gripPressed = this._pinch.grab;
    this.triggerPressed = this._pinch.trigger;
    // Squeeze: curling the other fingers into a fist (tips close to the wrist).
    const tips = [middle, ring, pinky].filter(Boolean);
    const curl = tips.length ? tips.reduce((sum, t) => sum + t.distanceTo(wrist), 0) / tips.length : 0.17;
    this.squeeze = THREE.MathUtils.clamp((0.15 - curl) / 0.06, 0, 1);

    // Pose: the pinch point is where the hand "holds" things; orientation comes from the palm.
    this.position.copy(thumb).add(index).multiplyScalar(0.5);
    this.touchPoint.copy(index);
    if (midMeta && idxMeta && pinkyMeta) {
      const fwd = this._fwd.copy(middle ?? midMeta).sub(wrist).normalize();
      const side = this._v.copy(idxMeta).sub(pinkyMeta).normalize();
      const z = fwd.clone().negate();                       // -Z = pointing direction, as for controllers
      const x = side.sub(z.clone().multiplyScalar(side.dot(z))).normalize();
      const y = z.clone().cross(x);
      this.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    }
    this.matrixWorld.compose(this.position, this.quaternion, this._v.set(1, 1, 1));
  }

  pulse(intensity = 0.5, ms = 50) {
    if (this.isTracked) return;                              // no haptics on bare hands
    const act = this.gamepad?.hapticActuators?.[0];
    try {
      if (act?.pulse) act.pulse(intensity, ms);
      else this.gamepad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity });
    } catch { /* haptics are best-effort */ }
  }

  /** true = something in reach (green), 'move' = pulling yourself through the room (blue). */
  setHighlight(on) { this.mat.color.set(on === 'move' ? 0x7cc4ff : on ? 0x7dffb0 : 0xffd7b5); }
}
