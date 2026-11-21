import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { Surface } from '../physics/Surface.js';
import { DisplayPanel } from '../ui/CanvasPanel.js';

/** Digital scale: shows the mass of whatever rests on its pad. Setting a vessel down auto-tares its weight, so the display reads the contents. */
export class Scale extends Entity {
  constructor(world, def) {
    super(world);
    this.def = def;
    const [w, h, d] = def.size;
    this.size = def.size;
    this.tare = 0;
    this.reading = 0;
    this.maxG = def.maxG ?? 2000;

    const mat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.45, metalness: 0.2 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    base.position.y = h / 2;
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(def.padRadius, def.padRadius, 0.006, 32),
      new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.7, roughness: 0.3 }),
    );
    pad.position.set(0, h + 0.003, -d * 0.08);
    this.padLocal = pad.position.clone();
    this.padTop = h + 0.006;

    this.display = new DisplayPanel(0.14, 0.05);
    this.display.mesh.rotation.x = -Math.PI / 2;
    this.display.mesh.position.set(0, h + 0.002, d / 2 - 0.045);

    this.object3D.add(base, pad, this.display.mesh);
    this._prevGross = 0;
    this.surface = null;
  }

  onAdded() {
    const p = this.object3D.position;
    this.surface = this.world.physics.addSurface(new Surface({
      owner: this, shape: 'circle', x: p.x + this.padLocal.x, z: p.z + this.padLocal.z,
      top: p.y + this.padTop, radius: this.def.padRadius,
      solid: Surface.box({ depth: this.padTop }),
    }));
  }
  onRemoved() { this.world.physics.removeSurface(this.surface); }

  /** Objects resting on the pad. */
  get loads() {
    return [...this.world.physics.bodies].filter((o) => o.body.support === this.surface);
  }

  /** Total mass (g) of everything resting on the pad. */
  get gross() { return this.loads.reduce((g, o) => g + o.totalMassG, 0); }

  update() {
    const loads = this.loads;
    const gross = loads.reduce((g, o) => g + o.totalMassG, 0);
    // A vessel set on an empty pad is tared automatically (only its own weight is zeroed).
    if (gross > 0.5 && this._prevGross <= 0.5) this.tare = loads.reduce((g, o) => g + (o.mixture ? (o.def.massG ?? 0) : 0), 0);
    if (gross <= 0.5) this.tare = 0;
    this._prevGross = gross;

    this.reading = gross <= 0.5 ? 0 : gross - this.tare;
    if (gross > this.maxG) this.display.setText('PRZECIĄŻENIE');
    else this.display.setText(`${this.reading.toFixed(2)} g`, this.tare ? 'NETTO' : '');
  }
}
