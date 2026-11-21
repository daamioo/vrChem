import * as THREE from 'three';
import { Entity } from '../core/Entity.js';

const _l = new THREE.Vector3();

/**
 * Wall rocker switch for the ceiling lights (world.env.lightsOn). Press the top half in with a
 * fingertip to switch on, the bottom half to switch off (desktop: click the top or bottom half).
 * The lights fade over a moment (Room), no flicker. A small green dot glows when off so you can
 * find it in the dark. Survives the room reset.
 * def: { position, rotationY }
 */
export class LightSwitch extends Entity {
  constructor(world, def) {
    super(world);
    this.def = def;
    this.persistent = true;
    world.env.lightsOn = def.startOn ?? true;
    this._armed = true;
    this.object3D.position.set(...(def.position ?? [0, 1.2, 0]));
    this.object3D.rotation.y = THREE.MathUtils.degToRad(def.rotationY ?? 0);

    const white = new THREE.MeshStandardMaterial({ color: 0xf2f3f0, roughness: 0.4 });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.01), white);
    plate.position.z = 0.005;
    this.rocker = new THREE.Group();
    this.rocker.position.z = 0.012;
    const rock = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.055, 0.012), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }));
    rock.position.z = 0.004;
    this.rocker.add(rock);
    this.dot = new THREE.Mesh(new THREE.CircleGeometry(0.003, 12), new THREE.MeshBasicMaterial({ color: 0x0a2a10 }));
    this.dot.position.set(0, -0.034, 0.0102);
    this.object3D.add(plate, this.rocker, this.dot);
    this._apply();
  }

  _apply() {
    const on = this.world.env.lightsOn;
    this.rocker.rotation.x = on ? -0.18 : 0.18;          // top pressed in = on
    this.dot.material.color.set(on ? 0x0a2a10 : 0x34d058);
  }

  set(on) {
    if (this.world.env.lightsOn === on) return;
    this.world.env.lightsOn = on;
    this.world.audio?.play('tick', 1);
    this._apply();
  }

  update() {
    let pressed = null;
    for (const h of this.world.input?.hands ?? []) {
      if (h.held || h.heldControl || !h.touching) continue;
      this.object3D.updateMatrixWorld(true);
      const l = this.object3D.worldToLocal(_l.copy(h.touchPoint));
      if (Math.abs(l.x) > 0.03 || Math.abs(l.y) > 0.035) continue;
      const pushed = h.name === 'mouse' ? l.z < 0.035 : l.z < 0.018;     // fingertip pushed onto the rocker
      if (pushed) { pressed = l.y >= 0; h.pulse?.(0.4, 25); break; }
    }
    if (pressed === null) { this._armed = true; return; }
    if (this._armed) { this._armed = false; this.set(pressed); }
  }
}
