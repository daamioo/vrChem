import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { Surface } from '../physics/Surface.js';

/**
 * Wall-mounted whiteboard with a marker tray. The board is a canvas texture that Markers draw
 * on and Erasers wipe. Board space: local origin at the centre of the writing surface, +z out of
 * the wall, so world points convert with worldToLocal(). Registers itself as `world.whiteboard`.
 */
export class Whiteboard extends Entity {
  constructor(world, def) {
    super(world);
    this.def = def;
    const [W, H] = def.size;
    this.W = W; this.H = H;
    this.pxPerM = def.pxPerM ?? 850;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(W * this.pxPerM);
    this.canvas.height = Math.round(H * this.pxPerM);
    this.ctx = this.canvas.getContext('2d');
    this.ctx.lineCap = 'round'; this.ctx.lineJoin = 'round';
    this.clear();

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    surface.raycast = () => {};
    this.object3D.add(surface);

    // aluminium frame, backing and marker tray
    const alu = new THREE.MeshStandardMaterial({ color: 0xc7ccd3, metalness: 0.7, roughness: 0.35 });
    const t = 0.03;
    const bar = (w, h, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), alu); m.position.set(x, y, 0.005); this.object3D.add(m); };
    bar(W + 2 * t, t, 0, H / 2 + t / 2); bar(W + 2 * t, t, 0, -H / 2 - t / 2);
    bar(t, H, -W / 2 - t / 2, 0); bar(t, H, W / 2 + t / 2, 0);
    const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.02), new THREE.MeshStandardMaterial({ color: 0x444a52 }));
    back.position.z = -0.011; this.object3D.add(back);
    this.tray = new THREE.Mesh(new THREE.BoxGeometry(W * 0.92, 0.025, 0.1), alu);
    this.tray.position.set(0, -H / 2 - t - 0.0125 + t, 0.05);
    this.object3D.add(this.tray);

    this.object3D.position.set(...def.position);
    this.object3D.rotation.y = THREE.MathUtils.degToRad(def.rotationY ?? 0);
    this._p = new THREE.Vector3(); this._q = new THREE.Quaternion();
  }

  onAdded() {
    this.world.whiteboard = this;
    this.object3D.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.tray);
    this.traySurface = this.world.physics.addSurface(new Surface({
      owner: this, shape: 'rect', x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2,
      top: box.max.y, halfX: (box.max.x - box.min.x) / 2, halfZ: (box.max.z - box.min.z) / 2,
    }));
  }
  onRemoved() { this.world.physics.removeSurface(this.traySurface); if (this.world.whiteboard === this) this.world.whiteboard = null; }

  clear() { this.ctx.fillStyle = '#fbfbfd'; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); this.texture && (this.texture.needsUpdate = true); }

  /**
   * Where a world point sits relative to the writing surface.
   * @returns {{u:number, v:number, z:number, inside:boolean}} u/v in canvas pixels, z = metres in front of the board
   */
  locate(worldPoint) {
    const l = this.object3D.worldToLocal(this._p.copy(worldPoint));
    return {
      u: ((l.x + this.W / 2) / this.W) * this.canvas.width,
      v: ((this.H / 2 - l.y) / this.H) * this.canvas.height,
      z: l.z,
      inside: Math.abs(l.x) < this.W / 2 && Math.abs(l.y) < this.H / 2,
    };
  }

  stroke(from, to, color, widthM) {
    const g = this.ctx;
    g.strokeStyle = color; g.lineWidth = widthM * this.pxPerM;
    g.beginPath(); g.moveTo(from.u, from.v); g.lineTo(to.u + 0.01, to.v); g.stroke();
    this.texture.needsUpdate = true;
  }

  /** Wipes a rotated rectangle (metres) centred at canvas pixel (u,v). */
  erase(u, v, wM, hM, angle) {
    const g = this.ctx;
    g.save(); g.translate(u, v); g.rotate(angle);
    g.fillStyle = '#fbfbfd';
    g.fillRect((-wM * this.pxPerM) / 2, (-hM * this.pxPerM) / 2, wM * this.pxPerM, hM * this.pxPerM);
    g.restore();
    this.texture.needsUpdate = true;
  }

  /** Board-space angle (canvas radians) of a world-space direction projected onto the board. */
  boardAngle(worldDir) {
    this.object3D.getWorldQuaternion(this._q).invert();
    const d = this._p.copy(worldDir).applyQuaternion(this._q);
    return Math.atan2(-d.y, d.x);
  }

  /** Magnet snap: pins an object flat against the board if it is released close enough. */
  tryAttach(obj, thickness) {
    const loc = this.locate(obj.object3D.position);
    if (!loc.inside || Math.abs(loc.z) > 0.12) return false;
    const local = this.object3D.worldToLocal(obj.object3D.position.clone());
    local.z = thickness;
    obj.body.pinned = {
      position: this.object3D.localToWorld(local),
      quaternion: this.object3D.getWorldQuaternion(new THREE.Quaternion()),
    };
    obj.body.support = null;
    this.world.audio?.play('clink', 0.7);
    return true;
  }
}
