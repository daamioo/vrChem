import * as THREE from 'three';
import { LabObject } from './LabObject.js';

/**
 * Magnetic whiteboard eraser. Pressed against the board while held it wipes a rectangle the
 * size of its felt; released near the board it snaps on and sticks magnetically.
 */
export class Eraser extends LabObject {
  build() {
    this.size = { w: 0.12, h: 0.035, d: 0.06 };
    this.height = this.size.h; this.grabRadius = 0.07;
    const { w, h, d } = this.size;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.7, d), new THREE.MeshStandardMaterial({ color: 0x3b4252, roughness: 0.5 }));
    body.position.y = h * 0.35 + h * 0.3;
    const felt = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, h * 0.3, d * 0.96), new THREE.MeshStandardMaterial({ color: 0xd9d4c4, roughness: 1 }));
    felt.position.y = h * 0.15;
    const magnet = new THREE.Mesh(new THREE.BoxGeometry(w * 0.3, 0.004, d * 0.4), new THREE.MeshStandardMaterial({ color: 0xdc2626 }));
    magnet.position.y = h + 0.0005;
    this.object3D.add(body, felt, magnet);
    this._c = new THREE.Vector3(); this._ax = new THREE.Vector3();
  }

  update() {
    const board = this.world.whiteboard;
    if (!board || !this.body.held) return;
    this.object3D.updateMatrixWorld(true);
    const loc = board.locate(this.worldPointAt(this.size.h / 2, this._c));
    if (!loc.inside || loc.z > 0.04 || loc.z < -0.03) return;
    const angle = board.boardAngle(this._ax.set(1, 0, 0).transformDirection(this.object3D.matrixWorld));
    board.erase(loc.u, loc.v, this.size.w, this.size.d, angle);
    this.body.held.pulse?.(0.1, 15);
    this.world.audio?.play('scribble', 0.4);
  }

  onRelease() { this.world.whiteboard?.tryAttach(this, this.size.h / 2 + 0.003); }
}
