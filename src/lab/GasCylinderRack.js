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
 * A flammable gas (`combustion: "fuel"` in chemicals.json) lit with the Lighter burns as a roaring
 * jet of flame until the valve is shut or the fire extinguisher's foam is sprayed on it.
 * def: { position, rotationY, cylinders: [{ gas: <chemical id>, color, hazard?, leakColor? }] }
 */
export class GasCylinderRack extends Decor {
  constructor(world, def) {
    super(world, def);
    // Decor makes everything non-raycastable; the cylinders should catch the desktop pointer.
    this.object3D.traverse((o) => { if (o.isMesh) delete o.raycast; });
    for (const c of this.cylinders) c.flame.traverse((o) => { o.raycast = () => {}; });
    this.light = new THREE.PointLight(0xff9a3c, 0, 3, 2);
    this.object3D.add(this.light);
  }

  onAdded() { this.world.gasSources.add(this); }

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
        combustion: chem?.combustion ?? null,
        burning: false, foamT: 0,
      };
      // flame jet (hidden until lit): additive cones along the outlet direction
      cyl.flame = new THREE.Group();
      cyl.flame.position.copy(cyl.nozzle);
      cyl.flame.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, outletDir);
      const fm = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
      cyl.flameOuter = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 16, 1, true).rotateX(Math.PI).translate(0, 0.5, 0), fm(0xff8a2a, 0.75));
      cyl.flameInner = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 12, 1, true).rotateX(Math.PI).translate(0, 0.5, 0), fm(0x7fa8ff, 0.8));
      cyl.flame.add(cyl.flameOuter, cyl.flameInner);
      cyl.flame.visible = false;
      this.object3D.add(cyl.flame);
      cyl.valve = new Valve(this.world, { radius: 0.035, turns: 1.5, onChange: (o) => { cyl.open = o; } });
      cyl.valve.object3D.position.set(x, 1.46, 0);
      this.object3D.add(cyl.valve.object3D);
      return cyl;
    });
    for (const y of [0.45, 0.9]) this.add(new THREE.BoxGeometry(0.26 * list.length + 0.07, 0.03, 0.03), dark, 0, y, -0.12);
  }

  onRemoved() { for (const c of this.cylinders) c.valve.dispose(); this.world.gasSources.delete(this); }

  /**
   * The open cylinder whose jet reaches `point` (world space), or null.
   * @returns {{cylinder, flow:number, combustion:string|null, gas:string}|null}
   */
  jetAt(point) {
    this.object3D.updateMatrixWorld(true);
    this.object3D.getWorldQuaternion(_q);
    let best = null;
    for (const c of this.cylinders) {
      if (c.open <= 0.001) continue;
      const flow = Math.pow(c.open, 0.7);
      const origin = this.object3D.localToWorld(_p.copy(c.nozzle));
      const dir = _d.copy(c.dir).applyQuaternion(_q);
      const rel = _h.copy(point).sub(origin);
      const along = rel.dot(dir);
      if (along < -0.01 || along > 0.15 + 0.5 * flow) continue;
      if (rel.addScaledVector(dir, -along).length() > 0.03 + Math.max(0, along) * 0.25) continue;
      if (!best || flow > best.flow) best = { cylinder: c, flow, combustion: c.combustion, gas: c.gas };
    }
    return best;
  }

  /** Sets a cylinder's jet alight (only if its gas is a fuel and it is flowing). */
  ignite(c) {
    if (c.burning || c.combustion !== 'fuel' || c.open <= 0.001) return false;
    c.burning = true; c.foamT = 0;
    this.world.audio?.play('whoomp', 1);
    this.world.bus.emit('gas:ignited', { rack: this, gas: c.gas });
    return true;
  }

  extinguish(c, smoke = true) {
    if (!c.burning) return;
    c.burning = false;
    c.flame.visible = false;
    if (smoke) {
      const origin = this.object3D.localToWorld(_p.copy(c.nozzle));
      this.world.particles?.puffs.emitBurst(origin, 14, { color: [0.55, 0.55, 0.58, 0.4], speed: 0.25, size: 0.03, life: 1.6, up: 0.3, growth: 3 });
      this.world.audio?.play('hiss', 0.7);
    }
  }

  /** Burning jet: flame cone, embers, light, heat on hands; foam from the extinguisher puts it out. */
  _burn(c, flow, origin, dir, dt) {
    const w = this.world, t = w.time;
    const len = 0.14 + 0.5 * flow, flick = 1 + Math.sin(t * 27 + c.nozzle.x * 40) * 0.07 + (Math.random() - 0.5) * 0.1;
    c.flame.visible = true;
    c.flameOuter.scale.set(0.03 + 0.05 * flow, len * flick, 0.03 + 0.05 * flow);
    c.flameInner.scale.set(0.012 + 0.015 * flow, len * 0.45 * flick, 0.012 + 0.015 * flow);
    const sparks = w.particles?.sparks;
    sparks?.emitRate(90 * flow * dt + 20 * dt, () => {
      _v.set((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3).add(dir).normalize().multiplyScalar(1 + 2 * flow);
      _v.y += 0.4;
      sparks.emit(origin, _v, [1, 0.45 + Math.random() * 0.35, 0.12, 0.9], 0.008 + Math.random() * 0.01, 0.15 + Math.random() * 0.2);
    });
    const tip = _h.copy(origin).addScaledVector(dir, len * 0.6);
    this.light.position.copy(this.object3D.worldToLocal(tip.clone()));
    this.light.intensity = Math.max(this.light.intensity, (1.2 + 1.5 * flow) * flick);
    w.audio?.play('flame', 0.5 + 0.6 * flow);

    // hands in the fire: strong buzz
    for (const hand of w.input?.hands ?? []) {
      const rel = _v.copy(hand.position).sub(origin), along = rel.dot(dir);
      if (along > 0 && along < len && rel.addScaledVector(dir, -along).length() < 0.05 + along * 0.2) { hand.pulse?.(0.8, 40); w.audio?.play('hiss', 0.25); }
    }
    // extinguisher foam landing in the flame (checks the live foam particles)
    let hits = 0;
    const foam = w.particles?.foam;
    if (foam) {
      const P = foam.pos, reach = 0.08 + 0.06 * flow;
      for (let i = 0; i < foam.capacity; i++) {
        if (foam.age[i] >= foam.life[i]) continue;
        const rx = P[i * 3] - origin.x, ry = P[i * 3 + 1] - origin.y, rz = P[i * 3 + 2] - origin.z;
        const a = THREE.MathUtils.clamp(rx * dir.x + ry * dir.y + rz * dir.z, 0, len);
        if (Math.hypot(rx - dir.x * a, ry - dir.y * a, rz - dir.z * a) < reach && ++hits >= 3) break;
      }
    }
    const foamed = hits >= 3;
    c.foamT = foamed ? c.foamT + dt : Math.max(0, c.foamT - dt);
    if (c.foamT > 0.5) this.extinguish(c);
  }

  update(dt) {
    const w = this.world;
    let loudest = 0;
    this.object3D.updateMatrixWorld(true);
    this.object3D.getWorldQuaternion(_q);
    this.light.intensity = 0;
    for (const c of this.cylinders) {
      c.valve.update(dt);
      if (c.open <= 0.001) { if (c.burning) this.extinguish(c, false); continue; }
      const flow = Math.pow(c.open, 0.7);
      loudest = Math.max(loudest, flow);
      const origin = this.object3D.localToWorld(_p.copy(c.nozzle));
      const dir = _d.copy(c.dir).applyQuaternion(_q);
      const col = [c.color.r, c.color.g, c.color.b];
      // any flame (lighter, burning splint, Bunsen) held in a fuel jet sets it alight
      if (!c.burning && c.combustion === 'fuel' && w.flames.size) {
        for (let k = 1; k <= 5 && !c.burning; k++) if (w.flameAt(_h.copy(origin).addScaledVector(dir, k * (0.03 + 0.1 * flow)), 0.012)) this.ignite(c);
      }
      if (c.burning) { this._burn(c, flow, origin, dir, dt); continue; }

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
