import * as THREE from 'three';

/**
 * A latching pull-handle that slides along local Y. Grip it and pull down to switch on; push it
 * back up to switch off. It snaps to the nearest end when released. Same control interface as
 * Dial (distanceToPoint / beginGrab / endGrab / update), so InteractionSystem treats both alike.
 */
export class Lever {
  /** @param {{travel?:number, startOn?:boolean, onChange?:(on:boolean)=>void}} o */
  constructor(world, { travel = 0.12, startOn = false, onChange } = {}) {
    this.world = world; this.travel = travel; this.onChange = onChange;
    this.value = startOn ? 1 : 0;          // 0 = up/off, 1 = down/on
    this.on = startOn;
    this.hand = null;

    this.object3D = new THREE.Group();
    const yellow = new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.4 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.8, roughness: 0.3 });
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.02, travel + 0.08, 0.012), steel);
    rail.position.set(0, -travel / 2, 0);
    this.handle = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 8, 18), yellow);
    ring.position.set(0, -0.035, 0.04);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.05, 8).rotateX(Math.PI / 2), steel);
    rod.position.set(0, 0, 0.02);
    this.handle.add(ring, rod);
    this.object3D.add(rail, this.handle);
    this._apply();
    this._p = new THREE.Vector3();
    world.controls.add(this);
  }

  dispose() { this.world.controls.delete(this); }
  _apply() { this.handle.position.y = -this.value * this.travel; }

  distanceToPoint(p) {
    this.handle.updateWorldMatrix(true, false);
    const c = this.handle.localToWorld(this._p.set(0, -0.035, 0.04));
    return Math.max(0, c.distanceTo(p) - 0.04);
  }

  beginGrab(hand) { this.hand = hand; this._lastY = hand.position.y; }

  endGrab() {
    this.hand = null;
    this.value = this.value > 0.5 ? 1 : 0;
    this._apply();
    this._setOn(this.value === 1);
  }

  _setOn(on) {
    if (on === this.on) return;
    this.on = on;
    this.world.audio?.play('clink', 0.6);
    this.onChange?.(on);
  }

  update() {
    const hand = this.hand;
    if (!hand) return;
    const dy = hand.position.y - this._lastY;
    this._lastY = hand.position.y;
    this.value = THREE.MathUtils.clamp(this.value - dy / this.travel, 0, 1);
    this._apply();
    if (this.value >= 0.9 && !this.on) { hand.pulse(0.6, 40); this._setOn(true); }
    else if (this.value <= 0.1 && this.on) { hand.pulse(0.4, 30); this._setOn(false); }
  }
}
