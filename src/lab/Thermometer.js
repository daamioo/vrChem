import * as THREE from 'three';
import { Probe } from './Probe.js';
import { DisplayPanel } from '../ui/CanvasPanel.js';

/** Dip the bulb into a container to read its temperature on the little display. */
export class Thermometer extends Probe {
  buildBody(length, radius, color) {
    super.buildBody(length, radius, color);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.5, 12, 8), new THREE.MeshPhongMaterial({ color: 0xff3b30 }));
    this.object3D.add(bulb);
    this.display = new DisplayPanel(0.05, 0.026);
    this.display.mesh.position.set(0, length * 0.8, radius + 0.003);
    this.display.setText('--.-°C');
    this.object3D.add(this.display.mesh);
  }

  onImmersed(container) { this._reading = container.mixture.temperature; }

  onFrame() {
    if (!this.immersedIn) this._reading = null;
    this.display.setText(this._reading == null ? '--.-°C' : `${this._reading.toFixed(1)}°C`);
  }
}
