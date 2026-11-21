import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { CanvasPanel } from './CanvasPanel.js';

class ToastPanel extends CanvasPanel {
  constructor(title, body) {
    super(0.5, 0.2, 900, { transparent: true });
    this.title = title; this.body = body;
    this.redraw();
  }
  draw(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10,20,40,0.82)';
    ctx.beginPath(); ctx.roundRect(0, 0, w, h, 24); ctx.fill();
    ctx.strokeStyle = '#6ee7b7'; ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = '#6ee7b7'; ctx.font = `bold ${h * 0.24}px sans-serif`; ctx.textBaseline = 'top';
    ctx.fillText(this.title, 24, 16);
    ctx.fillStyle = '#fff'; ctx.font = `${h * 0.17}px sans-serif`;
    CanvasPanel.wrap(ctx, this.body, 24, h * 0.46, w - 48, h * 0.2);
  }
}

/** A billboarded message that floats above a point and fades out. */
export class FloatingText extends Entity {
  constructor(world, { title, body, anchor, lifetime = 5 }) {
    super(world);
    this.anchor = anchor;        // () => THREE.Vector3
    this.life = lifetime; this.age = 0;
    this.panel = new ToastPanel(title, body);
    this.object3D.add(this.panel.mesh);
  }

  update(dt) {
    this.age += dt;
    if (this.age > this.life) return this.world.remove(this);
    const p = this.anchor();
    this.object3D.position.set(p.x, p.y + 0.22 + this.age * 0.015, p.z);
    const cam = this.world.camera.getWorldPosition(new THREE.Vector3());
    this.object3D.lookAt(cam.x, this.object3D.position.y, cam.z);
    this.panel.mesh.material.opacity = Math.min(1, (this.life - this.age) * 2);
  }
}
