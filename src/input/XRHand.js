import * as THREE from 'three';
import { Hand } from './Hand.js';

const PINCH_CLOSE = 0.024, PINCH_OPEN = 0.04;   // metres between fingertips (hysteresis)

/**
 * One tracked hand slot (index 0/1). It adapts to whatever the headset reports:
 *  - Touch controllers: trigger = grab (grip works too), the other button = use the held item,
 *    grip on empty air = move yourself, sticks = move / turn.
 *  - Bare-hand tracking: thumb+index pinch = grab, thumb+middle pinch = trigger,
 *    thumb+ring pinch = walk forward (where you look), thumb+little pinch = snap-turn
 *    (left hand turns left, right hand turns right).
 *    Curling the other fingers into a fist while holding = squeeze (e.g. the rubber ball).
 *  - Gripping (controller grip / index pinch) empty air and pulling moves you (see XRLocomotion).
 * Everything else sees only the abstract Hand fields.
 */
export class XRHand extends Hand {
  /**
   * @param {string} name
   * @param {THREE.Group} controller  renderer.xr.getController(i)
   * @param {THREE.Group} handGroup   renderer.xr.getHand(i)
   * @param {THREE.Object3D} scene    where the visible hand lives (it can stop short of where you are)
   */
  constructor(name, controller, handGroup, scene) {
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

    // The visible hand sits where walls let it be (Hand.position); a see-through ghost stays on
    // the tracked pose while the two are apart (hand pushed into a wall).
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffd7b5, roughness: 0.6 });
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    this._ghostA = 0;
    this.visual = new THREE.Group();
    this.visual.visible = false;
    scene?.add(this.visual);
    // Stand-in "glove" for controllers: palm sphere + pointing finger.
    const palmGeo = new THREE.SphereGeometry(0.03, 16, 12);
    const fingerGeo = new THREE.CylinderGeometry(0.008, 0.01, 0.06, 10).rotateX(Math.PI / 2);
    const gloveParts = (mat, parent) => {
      const palm = new THREE.Mesh(palmGeo, mat), finger = new THREE.Mesh(fingerGeo, mat);
      finger.position.z = -0.05;
      for (const m of [palm, finger]) { m.raycast = () => {}; parent.add(m); }
      return [palm, finger];
    };
    this.glove = new THREE.Group();
    this.glove.matrixAutoUpdate = false;               // set from the controller pose + offset
    this.visual.add(this.glove);
    gloveParts(this.mat, this.glove);
    this.ghostMeshes = gloveParts(this.ghostMat, controller);
    for (const m of this.ghostMeshes) { m.renderOrder = 30; m.visible = false; }
    this._jointGeo = new THREE.SphereGeometry(1, 8, 6);
    this._jointVis = [];                               // {name, solid, ghost} per joint in use
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
    if (this.isTracked) this._updateTracked(); else this._updateController();
  }

  syncVisual(dt = 1 / 72) {
    const tracked = this.isTracked, off = this.offset;
    this.visual.visible = !!this.inputSource;
    this.glove.visible = !tracked && this.controller.visible;
    if (this.glove.visible) {
      this.glove.matrix.copy(this.controller.matrixWorld);
      const e = this.glove.matrix.elements;
      e[12] += off.x; e[13] += off.y; e[14] += off.z;
      this.glove.matrixWorldNeedsUpdate = true;
    }
    for (const v of this._jointVis) {
      const j = this.handGroup.joints?.[v.name];
      v.solid.visible = tracked && !!j?.visible;
      if (v.solid.visible) v.solid.position.copy(this._t[v.name]).add(off);
    }
    // ghost: fades in (smoothly) as the hand is held back from where it really is
    const target = THREE.MathUtils.clamp((off.length() - 0.015) / 0.05, 0, 1) * 0.4;
    this._ghostA += (target - this._ghostA) * (1 - Math.exp(-12 * dt));
    this.ghostMat.opacity = this._ghostA;
    const showGhost = this._ghostA > 0.01;
    for (const m of this.ghostMeshes) m.visible = showGhost && !tracked;
    for (const v of this._jointVis) v.ghost.visible = showGhost && tracked;
  }

  hideVisuals() {
    this.visual.visible = false;
    for (const m of this.ghostMeshes) m.visible = false;
    for (const v of this._jointVis) v.ghost.visible = false;
  }

  _updateController() {
    const c = this.controller;
    c.updateMatrixWorld(true);
    this.matrixWorld.copy(c.matrixWorld);
    c.matrixWorld.decompose(this.position, this.quaternion, this._v.set(1, 1, 1));
    this._fwd.set(0, 0, -1).applyQuaternion(this.quaternion);
    this.touchPoint.copy(this.position).addScaledVector(this._fwd, 0.07);
    const b = this.gamepad?.buttons;
    const trig = !!b?.[0]?.pressed, grip = !!b?.[1]?.pressed;
    // Trigger (or grip) picks things up and holds them while it stays down; whichever button went
    // down first is the grab button. Only the grip, on empty air, grabs the world to move you.
    if (!this.gripPressed) {
      this.grabWith = trig && !this._trig ? 'trigger' : grip && !this._grip ? 'grip' : null;
      this.gripPressed = !!this.grabWith;
    } else this.gripPressed = this.grabWith === 'trigger' ? trig : grip;
    this._trig = trig; this._grip = grip;
    this.canAirGrab = this.grabWith === 'grip';
    // The other button uses what you hold (strike the lighter, spray, squeeze the ball / pipette).
    const useGrip = this.grabWith === 'trigger';
    this.triggerPressed = useGrip ? grip : trig;
    this.squeeze = (useGrip ? b?.[1]?.value : b?.[0]?.value) ?? 0;
    this._pinch.ring = this._pinch.pinky = false;
  }

  _joint(name) {
    const j = this.handGroup.joints?.[name];
    if (!j || !j.visible) return null;
    if (!j.userData.vis) {                       // lazily give each joint a small visible sphere (+ its ghost)
      const solid = new THREE.Mesh(this._jointGeo, this.mat), ghost = new THREE.Mesh(this._jointGeo, this.ghostMat);
      for (const s of [solid, ghost]) { s.scale.setScalar(0.0085); s.raycast = () => {}; }
      ghost.renderOrder = 30; ghost.visible = false;
      this.visual.add(solid); j.add(ghost);
      j.userData.vis = solid;
      this._jointVis.push({ name, solid, ghost });
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
    this.canAirGrab = true; this.grabWith = null;

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
