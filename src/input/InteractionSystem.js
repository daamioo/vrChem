import * as THREE from 'three';

/**
 * Grabbing and releasing. Works on abstract Hands: when grip closes, picks the nearest
 * grabbable within reach and rigidly attaches it; on release, hands over the hand's velocity.
 */
export class InteractionSystem {
  constructor(world) {
    this.world = world;
    this.hands = [];
    this._m = new THREE.Matrix4();
    this._s = new THREE.Vector3();
  }

  addHand(hand) { this.hands.push(hand); return hand; }

  update(dt) {
    for (const hand of this.hands) {
      hand.update(dt);
      hand.trackVelocity(dt);

      const gripDown = hand.gripPressed && !hand._wasGrip;
      const gripUp = !hand.gripPressed && hand._wasGrip;
      hand._wasGrip = hand.gripPressed;

      if (gripDown) this.tryGrab(hand);
      else if (gripUp) this.release(hand);

      if (hand.held) this.follow(hand, dt);
      else if (hand.airGrab) hand.setHighlight('move');
      else if (!hand.heldControl) {
        hand.nearest = this.findNearest(hand) ?? this.findNearestControl(hand);
        hand.setHighlight(!!hand.nearest);
      }
    }
  }

  findNearest(hand) {
    const reach = this.world.settings.interaction.grabReach;
    let best = null, bestD = reach;
    for (const obj of this.world.grabbables) {
      const d = obj.distanceToPoint(hand.position);
      if (d < bestD) { best = obj; bestD = d; }
    }
    return best;
  }

  findNearestControl(hand) {
    const reach = this.world.settings.interaction.grabReach;
    let best = null, bestD = reach;
    for (const d of this.world.controls) {
      const dist = d.distanceToPoint(hand.position);
      if (dist < bestD) { best = d; bestD = dist; }
    }
    return best;
  }

  tryGrab(hand) {
    const obj = this.findNearest(hand);
    const dial = this.findNearestControl(hand);
    if (dial && (!obj || dial.distanceToPoint(hand.position) < obj.distanceToPoint(hand.position))) {
      hand.heldControl = dial;
      dial.beginGrab(hand);
      hand.pulse(0.5, 40);
      return;
    }
    if (!obj) {
      // Gripping empty air grabs the world itself: XRLocomotion then lets you pull yourself along.
      if (hand.canAirGrab && this.world.settings.player.grabMove !== false) { hand.airGrab = true; hand.pulse(0.25, 25); }
      return;
    }
    this.grab(hand, obj);
  }

  /** Puts `obj` in `hand` (taking it from the other hand if needed). Also used by dispensers. */
  grab(hand, obj) {
    for (const other of this.hands) if (other.held === obj) this.release(other, false);

    obj.object3D.updateMatrixWorld(true);
    hand.held = obj;
    obj.body.held = hand;
    obj.body.support = null;
    obj.body.pinned = null;
    obj.body.velocity.set(0, 0, 0);
    obj._prevLowY = undefined; obj._pressed = false;
    hand.grabOffset.copy(this._m.copy(hand.matrixWorld).invert()).multiply(obj.object3D.matrixWorld);
    hand.pulse(0.5, 40);
    this.world.audio?.play('tick', 0.6);
    hand.setHighlight(true);
    obj.onGrab(hand);
    this.world.bus.emit('grab', { hand, object: obj });
  }

  release(hand, throwIt = true) {
    hand.airGrab = false;
    if (hand.heldControl) { hand.heldControl.endGrab(); hand.heldControl = null; return; }
    const obj = hand.held;
    if (!obj) return;
    hand.held = null;
    obj.body.held = null;
    if (throwIt) obj.body.velocity.copy(hand.velocity).clampLength(0, 4);
    obj.onRelease(hand);
    this.world.bus.emit('release', { hand, object: obj });
  }

  follow(hand, dt = 1 / 72) {
    const obj = hand.held;
    this._m.multiplyMatrices(hand.matrixWorld, hand.grabOffset);
    this._m.decompose(obj.object3D.position, obj.object3D.quaternion, this._s);
    obj.object3D.updateMatrixWorld(true);
    this._keepOutOfSolids(hand, obj, dt);
  }

  /**
   * A held object coming down onto a bench (or the hot plate / scale) stops on its top: the hand
   * can go on through, the object stays put. Coming down on it fast counts as an impact (glass
   * breaks) — measured by how fast the object's lowest point was dropping, so sliding or tilting
   * something along the top doesn't.
   * Reaching in from below or the side isn't blocked; the object pops out when let go.
   */
  _keepOutOfSolids(hand, obj, dt) {
    if (!obj.lowestPoint) return;
    const low = obj.lowestPoint(this._low ??= new THREE.Vector3());
    const prev = obj._prevLowY ?? low.y;
    let hit = null;
    for (const s of this.world.physics.surfaces) {
      // came down from above the top, and is now below it, within the solid's footprint
      if (low.y < s.top && prev >= s.top - 0.01 && s.isInside(low.x, s.top - 0.001, low.z) && (!hit || s.top > hit.top)) hit = s;
    }
    if (hit) {
      obj.object3D.position.y += hit.top - low.y;
      obj.object3D.updateMatrixWorld(true);
      if (!obj._pressed) {
        const speed = Math.max(0, prev - low.y) / Math.max(dt, 1e-3);
        if (speed > 0.5) obj.onImpact?.(speed, hit);
        hand.pulse(Math.min(1, 0.3 + speed * 0.3), 30);
      }
    }
    obj._pressed = !!hit;
    obj._prevLowY = hit ? hit.top : low.y;
  }
}
