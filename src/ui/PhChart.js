import { Entity } from '../core/Entity.js';
import { CanvasPanel } from './CanvasPanel.js';
import { universalIndicatorColor } from '../chemistry/Mixture.js';

const EXAMPLES = { 1: 'HCl', 3: 'ocet', 7: 'woda', 8: 'soda', 9: 'mydło', 13: 'NaOH' };

class ChartPanel extends CanvasPanel {
  constructor(w, h) { super(w, h, 900); this.redraw(); }
  draw(g, w, h) {
    g.fillStyle = '#f8f8f4'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2b3036'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = '#1a1a1a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${h * 0.12}px sans-serif`; g.fillText('SKALA pH', w / 2, h * 0.12);
    g.font = `${h * 0.065}px sans-serif`; g.fillText('papierek wskaźnikowy / wskaźnik uniwersalny', w / 2, h * 0.23);
    const n = 15, pad = w * 0.04, cw = (w - 2 * pad) / n, y0 = h * 0.33, ch = h * 0.3;
    for (let i = 0; i < n; i++) {
      const c = universalIndicatorColor(i);
      g.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
      g.fillRect(pad + i * cw + 2, y0, cw - 4, ch);
      g.fillStyle = i < 3 || i > 11 ? '#fff' : '#1a1a1a';
      g.font = `bold ${ch * 0.38}px sans-serif`; g.fillText(String(i), pad + (i + 0.5) * cw, y0 + ch / 2);
      if (EXAMPLES[i]) { g.fillStyle = '#333'; g.font = `${h * 0.055}px sans-serif`; g.fillText(EXAMPLES[i], pad + (i + 0.5) * cw, y0 + ch + h * 0.06); }
    }
    g.font = `bold ${h * 0.07}px sans-serif`;
    g.fillStyle = '#c0392b'; g.fillText('← KWAŚNY', pad + cw * 3, h * 0.88);
    g.fillStyle = '#2e7d32'; g.fillText('OBOJĘTNY', w / 2, h * 0.88);
    g.fillStyle = '#4527a0'; g.fillText('ZASADOWY →', w - pad - cw * 3, h * 0.88);
  }
}

/** Wall chart of universal indicator colours, pH 0–14, with everyday examples. def: { position, rotationY, size } */
export class PhChart extends Entity {
  constructor(world, def) {
    super(world);
    const [w, h] = def.size ?? [0.62, 0.4];
    const p = new ChartPanel(w, h);
    this.object3D.add(p.mesh);
    this.object3D.position.set(...def.position);
    this.object3D.rotation.y = ((def.rotationY ?? 0) * Math.PI) / 180;
  }
}
