import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { Surface } from '../physics/Surface.js';
import { DisplayPanel } from '../ui/CanvasPanel.js';
import { Dial } from './Dial.js';

/** Hot plate with a physical dial (OFF, then 25 C steps up to the max). Exposes its temperature through its Surface. */
export class HeatPlate extends Entity {
  constructor(world, def) {
    super(world);
    this.def = def;
    const th = world.settings.thermal;
    this.thermal = th;
    this.ambient = world.settings.ambientTemperatureC;
    this.on = false;
    this.setPoint = 100;
    this.temp = this.ambient;

    const [w, h, d] = def.size;
    this.topY = h + 0.006;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.6, metalness: 0.3 }));
    body.position.y = h / 2;
    this.plateMat = new THREE.MeshStandardMaterial({ color: 0x555a63, metalness: 0.8, roughness: 0.35, emissive: 0x000000 });
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(def.plateRadius, def.plateRadius, 0.006, 32), this.plateMat);
    plate.position.set(0, h + 0.003, -d * 0.08);
    this.plateLocal = plate.position.clone();

    this.display = new DisplayPanel(0.13, 0.05, { fg: '#ffb454' });
    this.display.mesh.rotation.x = -Math.PI / 2;
    this.display.mesh.position.set(-0.05, h + 0.002, d / 2 - 0.045);

    const steps = Math.round(th.plateMaxC / th.plateStepC) + 1;
    this.dial = new Dial(world, {
      steps, startStep: 0, color: '#dc2626',
      onChange: (k) => { this.on = k > 0; this.setPoint = Math.max(25, k * th.plateStepC); },
    });
    this.dial.object3D.position.set(w / 2 - 0.05, h, d / 2 - 0.05);
    this.object3D.add(this.dial.object3D);
    this.object3D.add(body, plate, this.display.mesh);
    this.surface = null;
  }

  onAdded() {
    const p = this.object3D.position;
    this.surface = this.world.physics.addSurface(new Surface({
      owner: this, shape: 'circle', x: p.x + this.plateLocal.x, z: p.z + this.plateLocal.z,
      top: p.y + this.topY, radius: this.def.plateRadius,
      solid: Surface.box({ depth: this.topY }),
      temperature: () => (this.temp > this.ambient + 3 ? this.temp : null),
    }));
  }
  onRemoved() { this.world.physics.removeSurface(this.surface); this.dial.dispose(); }

  update(dt) {
    this.dial.update(dt);
    const target = this.on ? this.setPoint : this.ambient;
    this.temp += (target - this.temp) * (1 - Math.exp(-dt / this.thermal.plateTimeConstantS));

    const heat = THREE.MathUtils.clamp((this.temp - this.ambient) / 200, 0, 1);
    this.plateMat.emissive.setRGB(heat * 0.9, heat * 0.25, 0);
    this.display.setText(`${Math.round(this.temp)}°C`, `${this.on ? 'WŁ.' : 'WYŁ.'}  ZAD. ${this.setPoint}°C`);
  }
}
