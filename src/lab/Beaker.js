import * as THREE from 'three';
import { Container } from './Container.js';

/** Open-topped cylinder with volume graduation marks. */
export class Beaker extends Container {
  build() {
    super.build();
    const marks = this.def.marks ?? 4;
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
    for (let i = 1; i <= marks; i++) {
      const y = this.profile.heightForVolume((this.capacityMl * i) / (marks + 1));
      const r = this.profile.radiusAt(y) + this.profile.wall + 0.0004;
      const pts = [];
      const arc = i % 2 ? 0.9 : 0.6;          // longer ticks on odd marks
      for (let k = 0; k <= 8; k++) {
        const a = -arc / 2 + (arc * k) / 8;
        pts.push(new THREE.Vector3(r * Math.sin(a), y, r * Math.cos(a)));
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
      line.renderOrder = 4;
      this.object3D.add(line);
    }
  }
}
