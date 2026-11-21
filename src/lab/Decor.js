import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { CanvasPanel } from '../ui/CanvasPanel.js';
import { Registry } from '../core/Registry.js';

const M = {
  dark: new THREE.MeshStandardMaterial({ color: 0x252a32, roughness: 0.5, metalness: 0.5 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.8 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf0f3f6, roughness: 0.3 }),
};

/** Base class for static, non-interactive furnishings placed from `lab.json` -> `decor`. */
export class Decor extends Entity {
  constructor(world, def) {
    super(world);
    this.def = def;
    this.object3D.position.set(...(def.position ?? [0, 0, 0]));
    this.object3D.rotation.y = THREE.MathUtils.degToRad(def.rotationY ?? 0);
    this.build(def);
    this.object3D.traverse((o) => { o.raycast = () => {}; });
  }
  build(_def) {}
  add(geo, mat, x, y, z) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); this.object3D.add(m); return m; }
}

class SignPanel extends CanvasPanel {
  constructor(w, h, { title, subtitle = '', color = '#ff7a1a', bg = '#f8f8f4', fg = '#1a1a1a', stripes = true }) {
    super(w, h, 700);
    Object.assign(this, { title, subtitle, color, bg, fg, stripes });
    this.redraw();
  }
  draw(g, w, h) {
    g.fillStyle = this.bg; g.fillRect(0, 0, w, h);
    if (this.stripes) {
      g.fillStyle = this.color; g.fillRect(0, 0, w, h * 0.16);
      g.fillStyle = '#1a1a1a';
      for (let x = -h; x < w + h; x += h * 0.28) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h * 0.14, 0); g.lineTo(x + h * 0.14 - h * 0.16, h * 0.16); g.lineTo(x - h * 0.16, h * 0.16); g.fill(); }
    }
    g.strokeStyle = this.color; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = this.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = h * 0.3; g.font = `bold ${size}px sans-serif`;
    while (g.measureText(this.title).width > w * 0.9 && size > 8) { size -= 2; g.font = `bold ${size}px sans-serif`; }
    g.fillText(this.title, w / 2, h * (this.subtitle ? 0.5 : 0.58));
    if (this.subtitle) { g.font = `${h * 0.14}px sans-serif`; g.fillText(this.subtitle, w / 2, h * 0.78); }
  }
}

/** Wall sign with a hazard-stripe header. def: { title, subtitle, color, size:[w,h] } */
export class SignPlate extends Decor {
  build({ size = [0.5, 0.3], title = 'CAUTION', subtitle = '', color = '#ff7a1a', bg, fg }) {
    const p = new SignPanel(size[0], size[1], { title, subtitle, color, bg, fg });
    this.object3D.add(p.mesh);
  }
}

/** Ceiling pipe runs, cable trays and brackets. */
export class CeilingPipes extends Decor {
  build() {
    const { width: w, depth: d, height: h } = this.world.settings.room;
    this.object3D.position.y = h;
    for (const x of [-1.95, -1.7, 1.7, 1.95]) {
      this.add(new THREE.CylinderGeometry(0.055, 0.055, d - 0.1, 14).rotateX(Math.PI / 2), x === -1.7 || x === 1.7 ? M.metal : M.white, x, -0.3, 0);
      for (let z = -d / 2 + 0.4; z < d / 2; z += 0.9) this.add(new THREE.BoxGeometry(0.03, 0.25, 0.04), M.dark, x, -0.17, z);
    }
    this.add(new THREE.CylinderGeometry(0.07, 0.07, w - 0.1, 14).rotateZ(Math.PI / 2), M.white, 0, -0.27, -d / 2 + 0.25);
    for (const x of [-0.7, 0.7]) {
      this.add(new THREE.BoxGeometry(0.3, 0.05, d - 0.1), M.dark, x, -0.1, 0);
      for (let z = -d / 2 + 0.3; z < d / 2; z += 0.25) this.add(new THREE.BoxGeometry(0.3, 0.01, 0.015), M.metal, x, -0.07, z);
    }
  }
}

/** Glowing guide line on the floor. def: { from:[x,z], to:[x,z], width, color } */
export class FloorStrip extends Decor {
  build({ from, to, width = 0.05, color = '#ff9a2e' }) {
    this.object3D.position.set(0, 0.004, 0);
    this.object3D.rotation.y = 0;
    const dx = to[0] - from[0], dz = to[1] - from[1], len = Math.hypot(dx, dz);
    const m = this.add(new THREE.BoxGeometry(width, 0.006, len), new THREE.MeshBasicMaterial({ color }), (from[0] + to[0]) / 2, 0, (from[1] + to[1]) / 2);
    m.rotation.y = Math.atan2(dx, dz);
    const n = Math.floor(len / 0.5);
    for (let i = 1; i < n; i++) {
      const c = this.add(new THREE.ConeGeometry(width * 1.4, 0.12, 3).rotateX(-Math.PI / 2).scale(1, 0.05, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }),
        from[0] + (dx * i) / n, 0.004, from[1] + (dz * i) / n);
      c.rotation.y = Math.atan2(dx, dz);
    }
  }
}

export const decorRegistry = new Registry('decor class')
  .register('SignPlate', SignPlate).register('CeilingPipes', CeilingPipes)
  .register('FloorStrip', FloorStrip);
