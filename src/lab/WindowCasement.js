import * as THREE from 'three';

const _l = new THREE.Vector3(), _w = new THREE.Vector3();
const MAX_OPEN = 1.45;            // radians (~83°)

/**
 * One hinged glass sash of a casement window, in its wall's local frame (u along the wall, v up,
 * +z into the room). It swings inward around a vertical hinge on one side. Grab the handle on the
 * free edge and pull: the sash follows your hand round the hinge, and stays where you leave it.
 * Pushing it shut latches it with a click. Same control interface as Dial / Valve.
 * @param {object} o  { hingeU, side: +1 (sash extends toward +u) | -1, width, v0, v1 }
 */
export class WindowCasement {
  constructor(world, wallGroup, { hingeU, side, width, v0, v1 }) {
    this.world = world; this.side = side; this.width = width;
    this.angle = 0; this.hand = null; this._creak = 0;
    const h = v1 - v0, t = 0.045;
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.45, metalness: 0.4 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xbfd6e2, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.1, depthWrite: false });

    this.pivot = new THREE.Group();                    // on the hinge line, inner face of the frame
    this.pivot.position.set(hingeU, v0, -0.01);
    const sash = new THREE.Group();
    sash.position.x = side * width / 2;                // sash centred half a width from the hinge
    const box = (w, hh, d, x, y, z, m = frameMat) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), m); b.position.set(x, y, z); sash.add(b); return b; };
    box(width, t, 0.05, 0, t / 2, 0); box(width, t, 0.05, 0, h - t / 2, 0);
    box(t, h, 0.05, -width / 2 + t / 2, h / 2, 0); box(t, h, 0.05, width / 2 - t / 2, h / 2, 0);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(width - 2 * t, h - 2 * t), glassMat);
    glass.position.set(0, h / 2, 0); glass.renderOrder = 1; sash.add(glass);
    // handle on the free edge, room side
    const handleMat = new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.3, metalness: 0.8 });
    this.handleLocal = new THREE.Vector3(side * (width - 0.06), h / 2, 0.06);   // in pivot space
    const free = side * width / 2 - side * 0.06;
    box(0.03, 0.05, 0.02, free, h / 2, 0.035, handleMat);
    box(0.022, 0.13, 0.022, free, h / 2 - 0.05, 0.055, handleMat);
    this.pivot.add(sash);
    wallGroup.add(this.pivot);
    world.controls.add(this);
  }

  dispose() { this.world.controls.delete(this); }

  /** 0 = shut, 1 = wide open. */
  get open() { return this.angle / MAX_OPEN; }

  _handleWorld(target) { this.pivot.updateWorldMatrix(true, false); return this.pivot.localToWorld(target.copy(this.handleLocal)); }

  distanceToPoint(p) { return Math.max(0, this._handleWorld(_w).distanceTo(p) - 0.06); }

  beginGrab(hand) { this.hand = hand; }

  endGrab() {
    this.hand = null;
    if (this.angle < 0.06 && this.angle > 0) { this.angle = 0; this._apply(); this.world.audio?.play('clink', 0.6); }
  }

  _apply() { this.pivot.rotation.y = -this.side * this.angle; }

  update(dt) {
    const hand = this.hand;
    if (!hand) return;
    // hand in the pivot's parent (wall) frame, relative to the hinge
    const l = this.pivot.parent.worldToLocal(_l.copy(hand.position)).sub(this.pivot.position);
    const target = THREE.MathUtils.clamp(Math.atan2(l.z, this.side * l.x), 0, MAX_OPEN);
    const before = this.angle;
    this.angle += (target - this.angle) * (1 - Math.exp(-20 * dt));
    this._apply();
    const moved = Math.abs(this.angle - before);
    this._creak += moved;
    if (this._creak > 0.12) { this._creak = 0; this.world.audio?.play('squeak', 0.35); hand.pulse(0.15, 15); }
    if (before > 0.06 && this.angle <= 0.06) { this.angle = 0; this._apply(); this.world.audio?.play('clink', 0.6); hand.pulse(0.5, 30); }
  }
}
