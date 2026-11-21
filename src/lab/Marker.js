import * as THREE from 'three';
import { Probe } from './Probe.js';

const _rx = new THREE.Matrix4(), _t = new THREE.Matrix4(), _p = new THREE.Matrix4();

/**
 * Dry-erase marker. Hold it and touch the tip to the whiteboard to write in its ink colour
 * (or rub it on anything in `world.markables`, like the cat, to colour it)
 * (`markerColor` in equipment.json). Origin = tip; lies flat when put down.
 * Picked up, it snaps into a pen grip: the tip points where your hand points, `holdReach` metres
 * ahead of the grip and tilted `holdPitchDeg` down — so it's easy to aim however it was lying.
 */
export class Marker extends Probe {
  holdOffset() {
    const reach = this.def.holdReach ?? 0.08, pitch = THREE.MathUtils.degToRad(this.def.holdPitchDeg ?? 15);
    // marker +Y (tip -> cap) along hand +Z (back toward the hand), tip moved forward, then tilted down
    _rx.makeRotationX(Math.PI / 2);
    _t.makeTranslation(0, 0, -reach);
    return _p.makeRotationX(-pitch).multiply(_t).multiply(_rx);
  }

  buildBody(length, radius) {
    const ink = this.def.markerColor ?? '#111111';
    this.ink = ink;
    this._last = null;
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.5 });
    const col = new THREE.MeshStandardMaterial({ color: ink, roughness: 0.4 });
    const add = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; this.object3D.add(m); return m; };
    add(new THREE.ConeGeometry(radius * 0.7, 0.025, 12).rotateX(Math.PI), col, 0.0125);                  // nib (tip at origin)
    add(new THREE.CylinderGeometry(radius * 0.75, radius, 0.02, 14), white, 0.035);
    add(new THREE.CylinderGeometry(radius, radius, length - 0.08, 14), white, 0.045 + (length - 0.08) / 2);
    add(new THREE.CylinderGeometry(radius * 1.02, radius * 1.02, 0.03, 14), col, length * 0.62);          // colour band
    add(new THREE.CylinderGeometry(radius * 1.05, radius * 1.05, 0.03, 14), col, length - 0.015);         // cap end
  }

  onFrame(dt) {
    const board = this.world.whiteboard;
    const hand = this.body.held;
    let drawing = false;
    if (board && hand) {
      const loc = board.locate(this.tipWorld);
      if (loc.inside && loc.z < 0.015 && loc.z > -0.04) {
        board.stroke(this._last ?? loc, loc, this.ink, 0.008);
        this._last = { u: loc.u, v: loc.v };
        drawing = true;
        hand.pulse?.(0.12, 15);
        this.world.audio?.play('scribble', 0.8);
      }
    }
    if (!drawing) this._last = null;
    // anything else that takes ink (e.g. the cat's fur)
    if (hand && !drawing) {
      for (const m of this.world.markables) {
        if (!m.markTouch?.(this.tipWorld, this.ink, dt)) continue;
        hand.pulse?.(0.1, 15);
        this.world.audio?.play('scribble', 0.4);
        break;
      }
    }
  }
}
