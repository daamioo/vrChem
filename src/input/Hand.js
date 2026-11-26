import * as THREE from 'three';

/**
 * Abstract hand: a pose, a grip button and the object being held. XRHand (Quest controllers)
 * and DesktopHand (mouse) both fill in the same fields, so InteractionSystem and every
 * game object stay input-agnostic.
 */
export class Hand {
  constructor(name) {
    this.name = name;
    this.position = new THREE.Vector3();        // palm, world space
    this.quaternion = new THREE.Quaternion();
    this.matrixWorld = new THREE.Matrix4();
    this.touchPoint = new THREE.Vector3();      // fingertip used to press buttons
    this.touching = true;                       // false => touchPoint should be ignored
    this.gripPressed = false;
    this.triggerPressed = false;
    this.squeeze = 0;                           // 0..1 how hard the hand is squeezing what it holds
    this.held = null;                           // LabObject
    this.heldControl = null;                    // Dial / Lever being operated
    this.grabOffset = new THREE.Matrix4();
    this.velocity = new THREE.Vector3();
    this._prev = new THREE.Vector3();
    this._hasPrev = false;
    this.airGrab = false;                       // gripping empty air (grab-the-world locomotion)
    this.canAirGrab = false;                    // set by hands that support it (XR)
    this.nearest = null;                        // grabbable currently in reach (for highlighting)
    // Walls stop the hand: `position` / `touchPoint` / `matrixWorld` are where the hand is allowed
    // to be; `realPosition` is the tracked one, and `offset` = position - realPosition.
    this.realPosition = new THREE.Vector3();
    this.offset = new THREE.Vector3();
  }

  /** Refresh pose and button state. */
  update(_dt) {}
  /** Vibrate (no-op where unsupported). */
  pulse(_intensity, _ms) {}
  /** Visual feedback hook (e.g. tint when something is in reach). */
  setHighlight(_on) {}
  /** Places the hand's visuals after walls have been applied (and shows a ghost where it really is). */
  syncVisual(_dt) {}
  /** Hides the visuals (when this hand stops being used). */
  hideVisuals() {}

  /** Moves the hand (pose, fingertip) by `d`, keeping the tracked `realPosition`. */
  shift(d) {
    this.position.add(d);
    this.touchPoint.add(d);
    const e = this.matrixWorld.elements;
    e[12] += d.x; e[13] += d.y; e[14] += d.z;
    this.offset.add(d);
  }

  /** Smoothed hand velocity, used for throwing. Call after pose update. */
  trackVelocity(dt) {
    if (this._hasPrev && dt > 0) {
      const v = this.position.clone().sub(this._prev).divideScalar(dt);
      this.velocity.lerp(v, 0.35);
    }
    this._prev.copy(this.position);
    this._hasPrev = true;
  }

  drop() { this.held = null; }
}
