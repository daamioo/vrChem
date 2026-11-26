import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { CanvasPanel } from '../ui/CanvasPanel.js';

// Paw layout in badge space (metres, y up, faces +z): four toes and the big heel pad.
const TOES = [[-0.165, 0.06, 0.042, 0.058, 0.35], [-0.065, 0.135, 0.045, 0.064, 0.1], [0.065, 0.135, 0.045, 0.064, -0.1], [0.165, 0.06, 0.042, 0.058, -0.35]];
const HEEL_CY = -0.045;

function toeShape([x, y, rx, ry, rot], m = 0) {
  const s = new THREE.Shape();
  s.absellipse(x, y, rx + m, ry + m, 0, Math.PI * 2, false, rot);
  return s;
}

/** The heel pad: a rounded, slightly heart-bottomed blob; `m` grows it outwards (for the white rim). */
function heelShape(m = 0) {
  const sx = 1 + m / 0.14, sy = 1 + m / 0.1;
  const P = (x, y) => [x * sx, HEEL_CY + (y - HEEL_CY) * sy];
  const s = new THREE.Shape();
  s.moveTo(...P(0, 0.06));
  const c = (a, b, d) => s.bezierCurveTo(...P(...a), ...P(...b), ...P(...d));
  c([0.07, 0.06], [0.1, -0.01], [0.13, -0.05]);
  c([0.16, -0.09], [0.15, -0.15], [0.08, -0.15]);
  c([0.04, -0.15], [0.02, -0.13], [0, -0.13]);
  c([-0.02, -0.13], [-0.04, -0.15], [-0.08, -0.15]);
  c([-0.15, -0.15], [-0.16, -0.09], [-0.13, -0.05]);
  c([-0.1, -0.01], [-0.07, 0.06], [0, 0.06]);
  return s;
}

class SloganPanel extends CanvasPanel {
  constructor() { super(0.23, 0.13, 1800, { transparent: true }); this.redraw(); }
  draw(g, w, h) {
    g.clearRect(0, 0, w, h);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const line = (text, y, size, color, weight = 'bold') => {
      let px = h * size;
      g.font = `${weight} ${px}px Arial, Helvetica, sans-serif`;
      const fit = (w * 0.94) / g.measureText(text).width;
      if (fit < 1) { px *= fit; g.font = `${weight} ${px}px Arial, Helvetica, sans-serif`; }
      g.fillStyle = color; g.fillText(text, w / 2, h * y);
      return px;
    };
    line('THERE IS', 0.14, 0.17, '#ffffff', '600');
    line('NO EXCUSE', 0.39, 0.27, '#e3141b', '900');
    line('FOR', 0.62, 0.15, '#ffffff', '600');
    const px = line('ANIMAL ABUSE', 0.85, 0.22, '#ffffff', '900');
    // the red full stop
    g.font = `900 ${px}px Arial, Helvetica, sans-serif`;
    const half = g.measureText('ANIMAL ABUSE').width / 2;
    g.fillStyle = '#e3141b'; g.textAlign = 'left';
    g.fillText('.', w / 2 + half, h * 0.85);
  }
}

/**
 * A 3D paw-print badge ("There is no excuse for animal abuse") that grows in where the cat was
 * after something dangerous was poured on it, then floats there turning slowly. Swept away by
 * the room reset (which brings the cat back).
 */
export class PawBadge extends Entity {
  isDebris = true;

  constructor(world, { position, yaw = 0 }) {
    super(world);
    this.base = new THREE.Vector3().copy(position);
    this.object3D.position.copy(position);
    this.object3D.rotation.y = yaw;
    this.age = 0;

    const extrude = (shapes, depth, bevel) => {
      const g = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 28 });
      g.translate(0, 0, -depth / 2);
      return g;
    };
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.5, emissive: 0x5a5a58 });   // stays white in the dim corner
    const grey = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.6 });
    const black = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.35, metalness: 0.1 });

    this.badge = new THREE.Group();
    this.object3D.add(this.badge);
    const rimShapes = (m) => {
      const bridge = new THREE.Shape(); bridge.absellipse(0, 0.02, 0.15 + m * 0.5, 0.12 + m * 0.5, 0, Math.PI * 2);
      return [heelShape(m), ...TOES.map((t) => toeShape(t, m)), bridge];
    };
    const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.raycast = () => {}; this.badge.add(m); return m; };
    add(extrude(rimShapes(0.03), 0.012, 0), grey);                    // thin grey edge
    add(extrude(rimShapes(0.026), 0.016, 0), white);                  // white sticker rim
    add(extrude([heelShape(), ...TOES.map((t) => toeShape(t))], 0.016, 0.003), black);   // raised black pads

    // the slogan on the heel pad, front and back
    const slogan = new SloganPanel();
    for (const side of [1, -1]) {
      const m = side === 1 ? slogan.mesh : slogan.mesh.clone();
      m.position.set(0, HEEL_CY - 0.032, side * 0.0115);
      if (side === -1) m.rotation.y = Math.PI;
      this.badge.add(m);
    }
    this.badge.scale.setScalar(0.001);
  }

  update(dt) {
    this.age += dt;
    // grow in with a little overshoot, then hover and turn slowly
    const t = Math.min(1, this.age / 0.7);
    const s = 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
    this.badge.scale.setScalar(Math.max(0.001, s));
    this.object3D.position.y = this.base.y + Math.sin(this.age * 1.3) * 0.015;
    this.object3D.rotation.y += dt * 0.5;
  }
}
