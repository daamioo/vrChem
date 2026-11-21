import * as THREE from 'three';

const DARK = new THREE.MeshStandardMaterial({ color: 0x252a32, roughness: 0.5, metalness: 0.4 });
const ORANGE = new THREE.MeshBasicMaterial({ color: 0xff7a1a });
// clear, faintly tinted glass so the view outside shows through
const GLASS = new THREE.MeshStandardMaterial({ color: 0xbfd6e2, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.1, depthWrite: false });

/**
 * One wall in its own local frame: u runs along the wall (centred), v is height, +z faces into the room.
 * The panel is a Shape with rectangular holes for windows; each window gets a deep frame, mullions,
 * a sill and a glass pane. Trim (skirting, orange stripe, accent band) is added along the full length.
 */
export class Wall {
  /**
   * @param {object} o
   * @param {number} o.length @param {number} o.height
   * @param {THREE.Material} o.material  wall panel material (UVs are metres)
   * @param {Array<{u:[number,number], v:[number,number]}>} o.windows  in the wall's local u
   */
  constructor({ length, height, material, windows = [] }) {
    this.length = length; this.height = height; this.windows = windows;
    this.group = new THREE.Group();

    const L = length / 2;
    const shape = new THREE.Shape([new THREE.Vector2(-L, 0), new THREE.Vector2(L, 0), new THREE.Vector2(L, height), new THREE.Vector2(-L, height)]);
    for (const { u: [u0, u1], v: [v0, v1] } of windows) {
      shape.holes.push(new THREE.Path([new THREE.Vector2(u0, v0), new THREE.Vector2(u0, v1), new THREE.Vector2(u1, v1), new THREE.Vector2(u1, v0)]));
    }
    this.group.add(new THREE.Mesh(new THREE.ShapeGeometry(shape), material));
    this._addTrim(height);
    windows.forEach((w) => this._addWindow(w));
  }

  _box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    this.group.add(m);
    return m;
  }

  _addTrim(h) {
    const L = this.length;
    this._box(L, 0.14, 0.03, DARK, 0, 0.07, 0.015);
    this._box(L, 0.04, 0.012, ORANGE, 0, 0.16, 0.008);
    this._box(L, 0.06, 0.012, ORANGE, 0, h - 0.5, 0.008);
  }

  _addWindow({ u: [u0, u1], v: [v0, v1] }) {
    const w = u1 - u0, h = v1 - v0, cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, t = 0.06, depth = 0.18;
    const zc = -depth / 2 + 0.02;
    this._box(w + 2 * t, t, depth, DARK, cu, v1 + t / 2, zc);
    this._box(w + 2 * t, t, depth, DARK, cu, v0 - t / 2, zc);
    this._box(t, h, depth, DARK, u0 - t / 2, cv, zc);
    this._box(t, h, depth, DARK, u1 + t / 2, cv, zc);
    const bars = Math.floor(w / 1.2);
    for (let i = 1; i <= bars; i++) this._box(0.04, h, 0.05, DARK, u0 + (w * i) / (bars + 1), cv, -0.04);
    this._box(w + 0.1, 0.035, 0.14, new THREE.MeshStandardMaterial({ color: 0xf0f3f6, roughness: 0.3 }), cu, v0 + 0.0175, 0.07);   // sill
    this._box(w, 0.012, 0.012, ORANGE, cu, v0 + 0.04, 0.14);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), GLASS);
    glass.position.set(cu, cv, -0.04);
    glass.renderOrder = 1;
    this.group.add(glass);
  }
}
