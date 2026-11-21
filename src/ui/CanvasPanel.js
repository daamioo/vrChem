import * as THREE from 'three';

/**
 * A flat quad textured from a 2D canvas. Subclasses implement `draw(ctx, w, h)`; call
 * `redraw()` whenever the content changes. Used for displays, labels and wall boards.
 */
export class CanvasPanel {
  constructor(widthM, heightM, pxPerM = 600, { transparent = false } = {}) {
    this.widthM = widthM;
    this.heightM = heightM;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(16, Math.round(widthM * pxPerM));
    this.canvas.height = Math.max(16, Math.round(heightM * pxPerM));
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(widthM, heightM),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent, toneMapped: false }),
    );
    this.mesh.raycast = () => {};
  }

  draw(_ctx, _w, _h) {}

  redraw() {
    this.draw(this.ctx, this.canvas.width, this.canvas.height);
    this.texture.needsUpdate = true;
  }

  /** Word-wraps `text`, returns the y after the last line. */
  static wrap(ctx, text, x, y, maxWidth, lineHeight) {
    let line = '';
    for (const word of text.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) { ctx.fillText(line, x, y); line = word; y += lineHeight; }
      else line = test;
    }
    if (line) { ctx.fillText(line, x, y); y += lineHeight; }
    return y;
  }
}

/** Small LCD-style readout. */
export class DisplayPanel extends CanvasPanel {
  constructor(widthM, heightM, { fg = '#7dff9b', bg = '#06140a', font = 'bold {s}px monospace' } = {}) {
    super(widthM, heightM, 900);
    this.fg = fg; this.bg = bg; this.fontTpl = font;
    this.text = ''; this.sub = '';
    this.redraw();
  }

  setText(text, sub = '') {
    if (text === this.text && sub === this.sub) return;
    this.text = text; this.sub = sub;
    this.redraw();
  }

  draw(ctx, w, h) {
    ctx.fillStyle = this.bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = this.fg; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    const size = Math.floor(h * (this.sub ? 0.58 : 0.72));
    ctx.font = this.fontTpl.replace('{s}', size);
    ctx.fillText(this.text, w / 2, h * (this.sub ? 0.4 : 0.52));
    if (this.sub) { ctx.font = this.fontTpl.replace('{s}', Math.floor(h * 0.22)); ctx.fillText(this.sub, w / 2, h * 0.82); }
  }
}

/** Reagent label: chemical name, formula and a hazard stripe. */
export class LabelPanel extends CanvasPanel {
  constructor(widthM, heightM, { title, formula, stripe = '#3b82f6', subtitle = '' }) {
    super(widthM, heightM, 1400);
    Object.assign(this, { title, formula, stripe, subtitle });
    this.redraw();
  }

  draw(ctx, w, h) {
    ctx.fillStyle = '#fbfaf3'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = this.stripe; ctx.fillRect(0, 0, w, h * 0.16);
    ctx.strokeStyle = '#222'; ctx.lineWidth = 3; ctx.strokeRect(2, 2, w - 4, h - 4);
    ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let size = h * 0.2;
    ctx.font = `bold ${size}px sans-serif`;
    while (ctx.measureText(this.title).width > w * 0.92 && size > 8) { size -= 2; ctx.font = `bold ${size}px sans-serif`; }
    ctx.fillText(this.title, w / 2, h * 0.42);
    ctx.font = `${h * 0.22}px sans-serif`;
    ctx.fillStyle = '#333';
    ctx.fillText(this.formula, w / 2, h * 0.7);
    if (this.subtitle) { ctx.font = `bold ${h * 0.12}px sans-serif`; ctx.fillStyle = '#a00'; ctx.fillText(this.subtitle, w / 2, h * 0.9); }
  }
}
