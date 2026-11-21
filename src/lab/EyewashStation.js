import * as THREE from 'three';
import { Decor } from './Decor.js';
import { Lever } from './Lever.js';
import { CanvasPanel } from '../ui/CanvasPanel.js';

class EyewashSign extends CanvasPanel {
  constructor() { super(0.45, 0.35, 700); this.redraw(); }
  draw(g, w, h) {
    g.fillStyle = '#e8f8ee'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#16a34a'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#16a34a'; g.font = `bold ${h * 0.2}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('PŁUKANIE OCZU', w / 2, h * 0.38);
    g.font = `${h * 0.14}px sans-serif`; g.fillText('POCIĄGNIJ UCHWYT W DÓŁ', w / 2, h * 0.7);
  }
}

/**
 * Wall-mounted eyewash. Grab the yellow ring and pull it down: two jets of water arc up from the
 * nozzles (droplet particles) and fill any open container held above them. Push it back up to stop.
 */
export class EyewashStation extends Decor {
  build() {
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.8 });
    const sign = new EyewashSign();
    sign.mesh.position.set(0, 1.55, 0.01);
    this.object3D.add(sign.mesh);

    // plumbing: wall pipe -> cross bar -> two nozzles; basin underneath
    this.add(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 10).rotateX(Math.PI / 2), metal, 0, 1.08, 0.1);
    this.add(new THREE.CylinderGeometry(0.015, 0.015, 0.14, 10).rotateZ(Math.PI / 2), metal, 0, 1.08, 0.2);
    this.nozzles = [-0.07, 0.07].map((x) => {
      this.add(new THREE.CylinderGeometry(0.012, 0.018, 0.05, 10), metal, x, 1.105, 0.2);
      return new THREE.Vector3(x, 1.135, 0.2);
    });
    const basin = this.add(new THREE.SphereGeometry(0.19, 24, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xdfe5ea, roughness: 0.25, metalness: 0.4, side: THREE.DoubleSide }), 0, 1.06, 0.2);
    basin.scale.y = 0.6;
    this.add(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 10), metal, 0, 0.82, 0.2);

    this.on = false;
    this._wasOn = false;
    this.lever = new Lever(this.world, { travel: 0.12, onChange: (on) => { this.on = on; } });
    this.lever.object3D.position.set(0.3, 1.32, 0.03);
    this.object3D.add(this.lever.object3D);
    this._p = new THREE.Vector3(); this._v = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this._rotY = new THREE.Euler(0, 0, 0);
  }

  onRemoved() { this.lever.dispose(); }

  update(dt) {
    this.lever.update(dt);
    if (!this.on) return;
    const w = this.world;
    this.object3D.updateMatrixWorld(true);
    this.object3D.getWorldQuaternion(this._q);
    const hub = w.particles?.droplets;

    for (const n of this.nozzles) {
      const p = this.object3D.localToWorld(this._p.copy(n));
      if (hub) {
        hub.emitRate(70 * dt, () => {
          // jets lean slightly toward the middle and out of the wall, then fall back with gravity
          this._v.set(-Math.sign(n.x) * 0.12 + (Math.random() - 0.5) * 0.1, 1.25 + Math.random() * 0.2, 0.12 + (Math.random() - 0.5) * 0.1).applyQuaternion(this._q);
          hub.emit(p, this._v, [0.65, 0.86, 1, 0.8], 0.006 + Math.random() * 0.004, 0.45 + Math.random() * 0.15);
        });
      }
      // Fill any open vessel held above this nozzle.
      for (const t of w.pourTargets) {
        if (!t.canAccept?.(this) || !t.getOpening) continue;
        const o = t.getOpening();
        if (o.center.y > p.y && o.center.y < p.y + 0.5 && Math.hypot(o.center.x - p.x, o.center.z - p.z) <= o.radius) {
          t.acceptPour(new Map([['water', 22 * dt]]), 14, this);
          break;
        }
      }
    }
    w.audio?.play('water', 0.6);
  }
}
