import * as THREE from 'three';
import { Hand } from './Hand.js';

/**
 * Mouse-driven "hand" for testing without a headset.
 *   hover: hand sits where the cursor ray hits the scene   left-click: grip (grab / press buttons)
 *   wheel: push/pull held object      Q / E: roll (tilt) held object      R: reset roll
 */
export class DesktopHand extends Hand {
  constructor(world, dom) {
    super('mouse');
    this.world = world;
    this.dom = dom;
    this.ndc = new THREE.Vector2(0, 0);
    this.depth = 0.8;
    this.roll = 0;
    this.keys = new Set();
    this.raycaster = new THREE.Raycaster();
    this._rollQ = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);

    this.marker = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd7b5, depthTest: false, transparent: true, opacity: 0.8 }));
    this.marker.renderOrder = 20;
    this.marker.raycast = () => {};
    world.scene.add(this.marker);

    dom.addEventListener('mousemove', (e) => {
      const r = dom.getBoundingClientRect();
      this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    });
    dom.addEventListener('mousedown', (e) => { if (e.button === 0) this.gripPressed = true; });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.gripPressed = false; });
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.depth = THREE.MathUtils.clamp(this.depth - Math.sign(e.deltaY) * 0.025, 0.25, 2.5);
    }, { passive: false });
    window.addEventListener('keydown', (e) => { this.keys.add(e.code); if (e.code === 'KeyR') this.roll = 0; });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  update(dt) {
    const cam = this.world.camera;
    cam.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.ndc, cam);
    const ray = this.raycaster.ray;

    if (this.held) {
      this.position.copy(ray.origin).addScaledVector(ray.direction, this.depth);
    } else {
      const hits = this.raycaster.intersectObjects(this.world.scene.children, true);
      const hit = hits.find((h) => h.object.visible && h.object !== this.marker && h.object.isMesh);
      if (hit) { this.position.copy(hit.point); this.depth = THREE.MathUtils.clamp(hit.distance, 0.25, 2.5); }
      else this.position.copy(ray.origin).addScaledVector(ray.direction, this.depth);
    }

    if (this.keys.has('KeyQ')) this.roll += 1.8 * dt;
    if (this.keys.has('KeyE')) this.roll -= 1.8 * dt;
    this.triggerPressed = this.keys.has('Space');
    this.squeeze = THREE.MathUtils.clamp(this.squeeze + (this.triggerPressed ? 4 : -6) * dt, 0, 1);

    cam.getWorldQuaternion(this.quaternion);
    this._rollQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.roll);
    this.quaternion.multiply(this._rollQ);
    this.matrixWorld.compose(this.position, this.quaternion, this._s);
    this.touchPoint.copy(this.position);
    this.touching = this.gripPressed && !this.held;
    this.marker.position.copy(this.position);
  }

  setHighlight(on) { this.marker.material.color.set(on ? 0x7dffb0 : 0xffd7b5); }
}
