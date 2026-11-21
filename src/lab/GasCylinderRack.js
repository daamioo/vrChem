import * as THREE from 'three';
import { Decor } from './Decor.js';
import { Valve } from './Valve.js';
import { LabelPanel } from '../ui/CanvasPanel.js';

const DEFAULT_CYLINDERS = [
  { gas: 'carbon_dioxide', color: '#7d868f' },
  { gas: 'hydrogen', color: '#d23a2f', hazard: 'ŁATWOPALNY' },
  { gas: 'oxygen', color: '#dfe3e8', hazard: 'UTLENIAJĄCY' },
];

const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3(), _h = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * Rack of colour-coded gas cylinders chained to the wall. Each has a handwheel valve on top:
 * grip it and turn it counter-clockwise to open. Gas then hisses out of the side outlet as a
 * jet of cold mist; the further open, the stronger the jet. Turn clockwise to shut it.
 * def: { position, rotationY, cylinders: [{ gas: <chemical id>, color, hazard?, leakColor? }] }
 */
export class GasCylinderRack extends Decor {
  constructor(world, def) {
    super(world, def);
    // Decor makes everything non-raycastable; the cylinders should catch the desktop pointer.
    this.object3D.traverse((o) => { if (o.isMesh) delete o.raycast; });
  }

  build(def) {
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.8 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.35, metalness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x252a32, roughness: 0.5, metalness: 0.5 });
    const list = def.cylinders ?? DEFAULT_CYLINDERS;
    this.cylinders = list.map((c, i) => {
      const x = (i - (list.length - 1) / 2) * 0.26;
      const body = new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.35, metalness: 0.4 });
      this.add(new THREE.CylinderGeometry(0.11, 0.11, 1.15, 20), body, x, 0.575, 0);
      this.add(new THREE.SphereGeometry(0.11, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), body, x, 1.15, 0);
      this.add(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 10), metal, x, 1.3, 0);
      this.add(new THREE.BoxGeometry(0.06, 0.05, 0.05), brass, x, 1.38, 0);              // valve body
      this.add(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 8), brass, x, 1.43, 0);    // spindle
      // side outlet, angled out into the room
      const outletDir = new THREE.Vector3(Math.sin(-0.35 + i * 0.35) * 0.5, 0.08, -1).normalize();
      const outlet = this.add(new THREE.CylinderGeometry(0.01, 0.012, 0.06, 10), brass, x, 1.38, 0);
      outlet.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, outletDir);
      outlet.position.addScaledVector(outletDir, 0.045);

      const chem = this.world.chemicals.has(c.gas) ? this.world.chemicals.get(c.gas) : null;
      const label = new LabelPanel(0.14, 0.09, {
        title: chem?.name ?? c.gas, formula: chem?.formula ?? '', stripe: c.color, subtitle: c.hazard ?? 'GAZ SPRĘŻONY',
      });
      label.mesh.position.set(x, 0.85, -0.112);
      label.mesh.rotation.y = Math.PI;
      this.object3D.add(label.mesh);

      const cyl = {
        gas: c.gas, open: 0,
        nozzle: new THREE.Vector3(x, 1.38, 0).addScaledVector(outletDir, 0.08),
        dir: outletDir,
        color: new THREE.Color(c.leakColor ?? '#eef4fa'),
      };
      cyl.valve = new Valve(this.world, { radius: 0.035, turns: 1.5, onChange: (o) => { cyl.open = o; } });
      cyl.valve.object3D.position.set(x, 1.46, 0);
      this.object3D.add(cyl.valve.object3D);
      return cyl;
    });
    for (const y of [0.45, 0.9]) this.add(new THREE.BoxGeometry(0.26 * list.length + 0.07, 0.03, 0.03), dark, 0, y, -0.12);
  }

  onRemoved() { for (const c of this.cylinders) c.valve.dispose(); }

  update(dt) {
    const w = this.world;
    let loudest = 0;
    this.object3D.updateMatrixWorld(true);
    this.object3D.getWorldQuaternion(_q);
    for (const c of this.cylinders) {
      c.valve.update(dt);
      if (c.open <= 0.001) continue;
      const flow = Math.pow(c.open, 0.7);
      loudest = Math.max(loudest, flow);
      const origin = this.object3D.localToWorld(_p.copy(c.nozzle));
      const dir = _d.copy(c.dir).applyQuaternion(_q);
      const col = [c.color.r, c.color.g, c.color.b];

      // Expanding mist cloud: slows down, swells and drifts.
      const puffs = w.particles?.puffs;
      puffs?.emitRate(110 * flow * dt, () => {
        const speed = (1.2 + 2.6 * flow) * (0.7 + Math.random() * 0.5);
        _v.set((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25).add(dir).normalize().multiplyScalar(speed);
        puffs.emit(origin, _v, [...col, 0.18 + 0.2 * flow], 0.012 + Math.random() * 0.012, 0.7 + Math.random() * 0.7, 4 + 3 * flow);
      });
      // Sharp, fast jet core right at the outlet.
      const core = w.particles?.bubbles;
      core?.emitRate(160 * flow * dt, () => {
        _v.set((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08).add(dir).normalize().multiplyScalar(2.5 + 3 * flow);
        core.emit(origin, _v, [1, 1, 1, 0.55], 0.003 + Math.random() * 0.003, 0.12 + Math.random() * 0.12);
      });

      // Feel the jet: buzz any hand that's in its path.
      for (const hand of w.input?.hands ?? []) {
        const rel = _h.copy(hand.position).sub(origin);
        const along = rel.dot(dir);
        if (along > 0 && along < 0.6 && rel.addScaledVector(dir, -along).length() < 0.04 + along * 0.15) hand.pulse?.(0.15 + 0.4 * flow, 30);
      }
    }
    if (loudest > 0) w.audio?.play('gasLeak', 0.35 + 0.9 * loudest);
  }
}
