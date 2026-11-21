import * as THREE from 'three';
import { Probe } from './Probe.js';
import { universalIndicatorColor } from '../chemistry/Mixture.js';

/**
 * Universal indicator paper. Dip the end into a liquid and it changes colour with the pH
 * (red = strong acid, green = neutral, purple = strong base); compare it with the pH chart on
 * the wall. The colour stays, so you can carry it over. Origin = the dipping end.
 */
export class PhStrip extends Probe {
  buildBody(length, radius, color) {
    const paper = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 });
    const w = radius * 2, t = 0.0006, dip = length * 0.4;
    this.padMat = paper(color);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(w, dip, t).translate(0, dip / 2, 0), this.padMat);
    const rest = new THREE.Mesh(new THREE.BoxGeometry(w, length - dip, t).translate(0, dip + (length - dip) / 2, 0), paper(color));
    this.object3D.add(pad, rest);
    this.reading = null;
  }

  onImmersed(container) {
    if (this.tipWorld.y > container.liquidTopY()) return;     // only the wet part changes colour
    const ph = container.mixture.pH;
    if (ph == null) return;
    if (this.reading == null || Math.abs(ph - this.reading) > 0.3) this.world.audio?.play('pourSplash', 0.15);
    this.reading = ph;
    const c = universalIndicatorColor(ph);
    this.padMat.color.setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace);
  }
}
