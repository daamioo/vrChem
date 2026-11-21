import * as THREE from 'three';
import { Entity } from '../core/Entity.js';

const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();

/**
 * A burst of real glass fragments: small random triangles that fly out, tumble, land on the
 * floor / tables, lie there for a while and then fade away. Created by Container.shatter().
 */
export class GlassShards extends Entity {
  isDebris = true;   // swept away by the room reset
  /**
   * @param {World} world
   * @param {{origin: THREE.Vector3, color?: string|number, count?: number, size?: number, kick?: THREE.Vector3}} o
   */
  constructor(world, { origin, color = '#cfe8ff', count = 18, size = 0.05, kick = null }) {
    super(world);
    this.material = new THREE.MeshPhongMaterial({
      color, transparent: true, opacity: 0.55, shininess: 140, specular: 0xffffff,
      side: THREE.DoubleSide, depthWrite: false,
    });
    this.life = 7;
    this.age = 0;
    this.shards = [];
    for (let i = 0; i < count; i++) {
      const s = size * (0.25 + Math.random() * 0.75);
      const g = new THREE.BufferGeometry();
      const pts = [0, 0, 0, s * (0.4 + Math.random() * 0.6), 0, 0, s * (Math.random() - 0.3), s * (0.3 + Math.random() * 0.7), 0];
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      g.computeVertexNormals();
      g.center();
      const m = new THREE.Mesh(g, this.material);
      m.raycast = () => {};
      m.renderOrder = 3;
      m.position.copy(origin).add(new THREE.Vector3((Math.random() - 0.5) * 0.06, Math.random() * 0.08, (Math.random() - 0.5) * 0.06));
      m.quaternion.random();
      const v = new THREE.Vector3((Math.random() - 0.5) * 2.2, 0.6 + Math.random() * 1.6, (Math.random() - 0.5) * 2.2);
      if (kick) v.addScaledVector(kick, 0.25);
      const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      this.shards.push({ mesh: m, v, spin, spinRate: 8 + Math.random() * 18, resting: false, bounces: 0 });
      this.object3D.add(m);
    }
  }

  update(dt) {
    this.age += dt;
    const g = this.world.settings.gravity ?? 9.81;
    const room = this.world.settings.room;
    for (const s of this.shards) {
      if (s.resting) continue;
      const p = s.mesh.position;
      const prevY = p.y;
      s.v.y -= g * dt;
      p.addScaledVector(s.v, dt);
      p.x = THREE.MathUtils.clamp(p.x, -room.width / 2 + 0.02, room.width / 2 - 0.02);
      p.z = THREE.MathUtils.clamp(p.z, -room.depth / 2 + 0.02, room.depth / 2 - 0.02);
      s.mesh.quaternion.premultiply(_q.setFromAxisAngle(_axis.copy(s.spin), s.spinRate * dt));
      const surf = this.world.physics.surfaceAt(p.x, p.z, prevY + 0.01);
      const floor = surf ? surf.top + 0.002 : 0.002;
      if (p.y <= floor) {
        p.y = floor;
        if (s.bounces < 1 && s.v.y < -1.2) {
          s.bounces++;
          s.v.set(s.v.x * 0.35, -s.v.y * 0.2, s.v.z * 0.35);
          s.spinRate *= 0.4;
        } else {
          s.resting = true;
          // Lie flat-ish on the surface, keeping a random heading.
          s.mesh.rotation.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.3, 0, Math.random() * Math.PI * 2);
        }
      }
    }
    const fade = this.life - 1.5;
    if (this.age > fade) this.material.opacity = 0.55 * Math.max(0, 1 - (this.age - fade) / 1.5);
    if (this.age >= this.life) this.world.remove(this);
  }
}
