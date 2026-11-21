import * as THREE from 'three';

/** WASD + right-mouse-drag look, for desktop testing. Disabled automatically inside an XR session. */
export class DesktopRig {
  constructor(world, rig, dom) {
    this.world = world; this.rig = rig; this.dom = dom;
    this.keys = new Set();
    this.looking = false;
    this.pitch = -0.25;
    this._f = new THREE.Vector3();

    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('mousedown', (e) => { if (e.button === 2) this.looking = true; });
    window.addEventListener('mouseup', (e) => { if (e.button === 2) this.looking = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.looking || this.world.renderer.xr.isPresenting) return;
      rig.rotation.y -= e.movementX * 0.003;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.003, -1.4, 1.4);
    });
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  update(dt) {
    if (this.world.renderer.xr.isPresenting) return;
    this.world.camera.rotation.x = this.pitch;
    const k = this.keys;
    const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    if (!f && !s) return;
    const speed = this.world.settings.player.moveSpeed * dt;
    const yaw = this.rig.rotation.y;
    this._f.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.rig.position.addScaledVector(this._f, f * speed);
    this.rig.position.x += Math.cos(yaw) * s * speed;
    this.rig.position.z += -Math.sin(yaw) * s * speed;
    const room = this.world.settings.room;
    this.rig.position.x = THREE.MathUtils.clamp(this.rig.position.x, -room.width / 2 + 0.3, room.width / 2 - 0.3);
    this.rig.position.z = THREE.MathUtils.clamp(this.rig.position.z, -room.depth / 2 + 0.3, room.depth / 2 - 0.3);
  }
}
