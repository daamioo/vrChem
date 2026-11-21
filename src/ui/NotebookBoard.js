import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { CanvasPanel } from './CanvasPanel.js';

const STORE_KEY = 'chemlab.discovered.v1';

class NotebookPanel extends CanvasPanel {
  constructor(w, h, board) { super(w, h, 520); this.board = board; this.redraw(); }

  draw(ctx, w, h) {
    const { reactions, db, discovered } = this.board;
    ctx.fillStyle = '#f7f3e3'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1f3a5f'; ctx.fillRect(0, 0, w, h * 0.12);
    ctx.fillStyle = '#fff'; ctx.font = `bold ${h * 0.07}px sans-serif`; ctx.textBaseline = 'middle';
    ctx.fillText('NOTATNIK LABORATORYJNY', w * 0.03, h * 0.06);
    ctx.textAlign = 'right';
    ctx.font = `${h * 0.045}px sans-serif`;
    ctx.fillText(`Odkryto ${discovered.size} / ${reactions.length}`, w * 0.97, h * 0.06);
    ctx.textAlign = 'left';

    const cols = 2, perCol = Math.ceil(reactions.length / cols);
    const colW = w / cols, rowH = (h * 0.88) / perCol;
    reactions.forEach((r, i) => {
      const col = Math.floor(i / perCol), row = i % perCol;
      const x = col * colW + w * 0.025, y = h * 0.12 + row * rowH + rowH * 0.18;
      const known = discovered.has(r.id);
      ctx.textBaseline = 'top';
      ctx.fillStyle = known ? '#14532d' : '#6b7280';
      ctx.font = `bold ${rowH * 0.2}px sans-serif`;
      ctx.fillText(`${known ? '✓' : '?'} ${known ? r.name : '???'}`, x, y);
      ctx.font = `${rowH * 0.17}px ${known ? 'monospace' : 'sans-serif'}`;
      ctx.fillStyle = known ? '#111827' : '#4b5563';
      CanvasPanel.wrap(ctx, known ? r.equation(db) : r.hint, x, y + rowH * 0.26, colW - w * 0.05, rowH * 0.2);
      ctx.strokeStyle = '#d6d3c4'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y + rowH * 0.8); ctx.lineTo(x + colW - w * 0.05, y + rowH * 0.8); ctx.stroke();
    });
  }
}

/** Wall board listing every reaction in config; entries unlock the first time you trigger them. */
export class NotebookBoard extends Entity {
  constructor(world, def) {
    super(world);
    this.reactions = world.reactions.all();
    this.db = world.chemicals;
    this.discovered = new Set(this._load());
    this.panel = new NotebookPanel(def.size[0], def.size[1], this);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(def.size[0] + 0.08, def.size[1] + 0.08, 0.03), new THREE.MeshStandardMaterial({ color: 0x252a32 }));
    frame.position.z = -0.018;
    this.object3D.add(frame, this.panel.mesh);
    this.object3D.position.set(...def.position);
    this._off = world.bus.on('reaction:step', ({ event }) => this.discover(event.reaction.id));
  }

  discover(id) {
    if (this.discovered.has(id)) return;
    this.discovered.add(id);
    this.world.bus.emit('reaction:discovered', { reaction: this.world.reactions.get(id) });
    this.world.audio?.play('ding', 1);
    this.panel.redraw();
    this._save();
  }

  _load() { try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]'); } catch { return []; } }
  _save() { try { localStorage.setItem(STORE_KEY, JSON.stringify([...this.discovered])); } catch { /* storage unavailable */ } }
  onRemoved() { this._off(); }
}
