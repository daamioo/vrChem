import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { CanvasPanel, DisplayPanel } from '../ui/CanvasPanel.js';
import { formatTime, daylight } from '../core/DayCycle.js';

const _l = new THREE.Vector3();

class ClockFace extends CanvasPanel {
  constructor(d) { super(d, d, 1600, { transparent: true }); this.redraw(); }
  draw(g, w, h) {
    const c = w / 2, r = w / 2 - 4;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#f8f8f4'; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1a1a1a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2, big = i % 5 === 0;
      const r0 = r * (big ? 0.84 : 0.9), r1 = r * 0.96;
      g.lineWidth = big ? w * 0.014 : w * 0.005;
      g.beginPath(); g.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0); g.lineTo(c + Math.sin(a) * r1, c - Math.cos(a) * r1); g.stroke();
    }
    g.font = `bold ${w * 0.11}px sans-serif`;
    for (let n = 1; n <= 12; n++) { const a = (n / 12) * Math.PI * 2; g.fillText(String(n), c + Math.sin(a) * r * 0.68, c - Math.cos(a) * r * 0.68); }
    g.fillStyle = '#ff7a1a'; g.font = `bold ${w * 0.05}px sans-serif`; g.fillText('LAB', c, c + r * 0.36);
  }
}

/**
 * Wall clock that drives the time of day (world.env.hours): the sky and factory outside, and the
 * daylight coming in, follow it. It runs on its own (`minutesPerSecond` game minutes per real
 * second); grab the clock face and circle your hand clockwise to wind time forward (one turn =
 * one hour), anticlockwise to go back. A small display under it shows the time and day / night.
 * def: { position, rotationY, radius = 0.16, startHours = 18, minutesPerSecond = 1 }
 */
export class WallClock extends Entity {
  constructor(world, def) {
    super(world);
    this.def = def;
    this.persistent = true;                       // the room reset doesn't change the time
    this.r = def.radius ?? 0.16;
    this.rate = def.minutesPerSecond ?? 1;
    world.env.hours = def.startHours ?? 18;
    this.hand = null;
    this.object3D.position.set(...(def.position ?? [0, 1.8, 0]));
    this.object3D.rotation.y = THREE.MathUtils.degToRad(def.rotationY ?? 0);

    const dark = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.4, metalness: 0.5 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(this.r, 0.014, 10, 48), dark);
    rim.position.z = 0.02;
    const back = new THREE.Mesh(new THREE.CylinderGeometry(this.r, this.r, 0.03, 48).rotateX(Math.PI / 2), dark);
    back.position.z = 0.012;
    const face = new ClockFace(this.r * 2);
    face.mesh.position.z = 0.0275;
    this.object3D.add(rim, back, face.mesh);
    const handMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 });
    const mkHand = (len, w, z) => {
      const g = new THREE.Group(); g.position.z = z;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.003).translate(0, len / 2 - len * 0.12, 0), handMat);
      g.add(m); this.object3D.add(g); return g;
    };
    this.hourHand = mkHand(this.r * 0.55, 0.012, 0.031);
    this.minuteHand = mkHand(this.r * 0.85, 0.007, 0.034);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 16).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xff7a1a }));
    cap.position.z = 0.037;
    this.object3D.add(cap);
    this.display = new DisplayPanel(0.11, 0.035, { fg: '#7dd3fc', bg: '#06101a' });
    this.display.mesh.position.set(0, -this.r - 0.04, 0.012);
    this.object3D.add(this.display.mesh);
  }

  onAdded() { this.world.controls.add(this); }
  onRemoved() { this.world.controls.delete(this); }

  // ---- control: grab the face and circle the hand around the centre
  _faceLocal(p) { this.object3D.updateMatrixWorld(true); return this.object3D.worldToLocal(_l.copy(p)); }

  distanceToPoint(p) {
    const l = this._faceLocal(p);
    const radial = Math.max(0, Math.hypot(l.x, l.y) - this.r);
    return Math.hypot(radial, Math.max(0, Math.abs(l.z - 0.03) - 0.03));
  }

  _angle(p) { const l = this._faceLocal(p); return Math.atan2(l.x, l.y); }     // clockwise from 12

  beginGrab(hand) { this.hand = hand; this._last = this._angle(hand.position); this._acc = 0; }
  endGrab() { this.hand = null; }

  update(dt) {
    const env = this.world.env;
    if (this.hand) {
      const a = this._angle(this.hand.position);
      let d = a - this._last;
      if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
      this._last = a;
      if (Math.abs(d) < 1) {                       // ignore tracking jumps
        env.hours += (d / (Math.PI * 2));            // one full turn = one hour
        this._acc += d;
        if (Math.abs(this._acc) > Math.PI / 6) { this._acc = 0; this.world.audio?.play('tick', 0.7); this.hand.pulse(0.3, 15); }
      }
    } else env.hours += (this.rate / 60) * dt;
    env.hours = ((env.hours % 24) + 24) % 24;

    const h = env.hours;
    this.minuteHand.rotation.z = -((h % 1) * Math.PI * 2);
    this.hourHand.rotation.z = -(((h % 12) / 12) * Math.PI * 2);
    const dl = daylight(h);
    this.display.setText(formatTime(h), dl > 0.6 ? 'DZIEŃ' : dl > 0.05 ? (h < 12 ? 'ŚWIT' : 'ZMIERZCH') : 'NOC');
  }
}
