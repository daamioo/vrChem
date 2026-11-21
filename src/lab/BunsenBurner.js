import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { Surface } from '../physics/Surface.js';
import { Valve } from './Valve.js';

const _p = new THREE.Vector3(), _c = new THREE.Color();
const YELLOW = new THREE.Color('#ffb03a'), BLUE = new THREE.Color('#6f7dff');

/**
 * Bunsen burner on a bench gas tap, with a tripod and gauze over it.
 *  - Turn the yellow tap handwheel to let gas through (it hisses), then bring any flame (lighter,
 *    burning splint) to the top of the barrel to light it.
 *  - Twist the brass collar to open the air hole: closed = lazy, luminous yellow "safety" flame;
 *    open = noisy blue roaring flame, much hotter.
 *  - Anything set on the gauze heats up (like the hot plate); a vessel held in the flame heats too.
 *  - Flame tests: a wire loop carrying a sample colours the flame (see FlameTestLoop).
 * Shut the gas to put it out. def: { maxHeatC }
 */
export class BunsenBurner extends Entity {
  constructor(world, def) {
    super(world);
    this.def = def;
    this.gas = 0; this.air = 0; this.lit = false;
    this._tint = new THREE.Color(); this._tintK = 0;
    this.barrelTop = 0.142; this.gauzeY = 0.245;

    const steel = new THREE.MeshStandardMaterial({ color: 0xb4bcc6, roughness: 0.3, metalness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.6, metalness: 0.4 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); this.object3D.add(m); return m; };
    add(new THREE.CylinderGeometry(0.042, 0.046, 0.012, 24), dark, 0, 0.006, 0);
    add(new THREE.CylinderGeometry(0.0095, 0.0095, this.barrelTop - 0.012, 16), steel, 0, 0.012 + (this.barrelTop - 0.012) / 2, 0);
    add(new THREE.CylinderGeometry(0.004, 0.005, 0.04, 8).rotateZ(Math.PI / 2), steel, 0.025, 0.02, 0);     // gas inlet

    // rubber hose from the inlet to the bench tap
    const tapPos = new THREE.Vector3(0.17, 0, -0.1);
    const hose = new THREE.CatmullRomCurve3([new THREE.Vector3(0.045, 0.02, 0), new THREE.Vector3(0.09, 0.006, -0.02), new THREE.Vector3(0.14, 0.006, -0.08), tapPos.clone().setY(0.03)]);
    add(new THREE.TubeGeometry(hose, 24, 0.005, 8), new THREE.MeshStandardMaterial({ color: 0xc2410c, roughness: 0.8 }), 0, 0, 0);
    add(new THREE.BoxGeometry(0.04, 0.05, 0.04), dark, tapPos.x, 0.025, tapPos.z);
    this.gasValve = new Valve(world, { radius: 0.02, turns: 0.75, color: '#e0a21b', onChange: (o) => { this.gas = o; } });
    this.gasValve.object3D.position.set(tapPos.x, 0.06, tapPos.z);
    this.object3D.add(this.gasValve.object3D);

    // air-hole collar on the barrel
    this.collar = new Valve(world, { radius: 0.016, turns: 0.5, color: '#b8862b', onChange: (o) => { this.air = o; } });
    this.collar.object3D.position.set(0, 0.035, 0);
    this.object3D.add(this.collar.object3D);
    add(new THREE.BoxGeometry(0.006, 0.008, 0.002), dark, 0, 0.035, 0.0098);                            // air hole

    // tripod + gauze
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = add(new THREE.CylinderGeometry(0.003, 0.003, this.gauzeY, 6), dark, Math.cos(a) * 0.075, this.gauzeY / 2, Math.sin(a) * 0.075);
      leg.rotation.set(Math.sin(a) * 0.08, 0, -Math.cos(a) * 0.08);
    }
    add(new THREE.TorusGeometry(0.072, 0.003, 6, 24).rotateX(Math.PI / 2), dark, 0, this.gauzeY - 0.002, 0);
    add(new THREE.BoxGeometry(0.15, 0.002, 0.15), new THREE.MeshStandardMaterial({ color: 0x8a9099, metalness: 0.6, roughness: 0.5 }), 0, this.gauzeY, 0);
    this.gauzeHot = add(new THREE.CylinderGeometry(0.035, 0.035, 0.0025, 20), new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.9, emissive: 0x000000 }), 0, this.gauzeY + 0.0003, 0);

    // flame: outer cone (yellow luminous <-> pale blue) and inner blue core
    const fm = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flame = new THREE.Group();
    this.flame.position.y = this.barrelTop;
    this.outer = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 16, 1, true).translate(0, 0.5, 0), fm(0xffb03a, 0.85));
    this.inner = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 12, 1, true).translate(0, 0.5, 0), fm(0x8fe8ff, 0.9));
    this.flame.add(this.outer, this.inner);
    this.flame.visible = false;
    this.object3D.add(this.flame);
    this.light = new THREE.PointLight(0xffa040, 0, 1.8, 2);
    this.light.position.y = this.barrelTop + 0.05;
    this.object3D.add(this.light);
    this.object3D.traverse((o) => { if (o.isMesh && (o.parent === this.flame)) o.raycast = () => {}; });
    this.flameLen = 0; this.flameR = 0.01;
  }

  onAdded() {
    const w = this.world;
    w.flames.add(this);
    this.object3D.updateMatrixWorld(true);
    const p = this.object3D.localToWorld(_p.set(0, this.gauzeY, 0));
    this.surface = w.physics.addSurface(new Surface({
      owner: this, shape: 'circle', x: p.x, z: p.z, top: p.y + 0.001, radius: 0.07,
      temperature: () => (this.lit ? 60 + (this.def.maxHeatC ?? 450) * this.gas * (0.45 + 0.55 * this.air) : null),
    }));
  }

  onRemoved() {
    const w = this.world;
    w.flames.delete(this);
    w.physics.removeSurface(this.surface);
    this.gasValve.dispose(); this.collar.dispose();
  }

  /** Hotter with more gas and more air. */
  get flameHeat() { return 200 + (this.def.maxHeatC ?? 450) * this.gas * (0.4 + 0.9 * this.air); }

  /** Flame test colour: `k` 0..1 how strongly. Fades by itself when no longer fed. */
  tintFlame(color, k = 1) {
    if (!this.lit) return;
    this._tint.set(color);
    this._tintK = Math.max(this._tintK, k);
  }

  flameDistance(p) {
    if (!this.lit) return Infinity;
    this.object3D.updateMatrixWorld(true);
    const base = this.object3D.localToWorld(_p.set(0, this.barrelTop, 0));
    const along = p.y - base.y;
    const radial = Math.hypot(p.x - base.x, p.z - base.z);
    if (along < 0) return Math.hypot(radial, along);
    if (along > this.flameLen) return Math.hypot(Math.max(0, radial - this.flameR * 0.3), along - this.flameLen);
    return Math.max(0, radial - this.flameR * (1 - (along / this.flameLen) * 0.6));
  }

  update(dt) {
    const w = this.world, t = w.time;
    this.gasValve.update(dt);
    this.collar.update(dt);
    this.object3D.updateMatrixWorld(true);
    const top = this.object3D.localToWorld(_p.set(0, this.barrelTop + 0.005, 0));

    if (this.gas <= 0.02) this.lit = false;
    else if (!this.lit && w.flameAt(top, 0.015, this)) { this.lit = true; w.audio?.play('whoomp', 0.35); }
    if (this.lit) {
      for (const src of w.gasSources) {
        if (src.jetAt(top.clone().setY(top.y + 0.03))?.combustion === 'smothers') { this.lit = false; w.audio?.play('hiss', 0.4); }
      }
    }

    this.flame.visible = this.lit;
    this._tintK = Math.max(0, this._tintK - dt * 1.5);
    const gauzeHeat = this.lit ? THREE.MathUtils.clamp(this.gas * (0.3 + this.air), 0, 1) : 0;
    this.gauzeHot.material.emissive.setRGB(gauzeHeat * 0.8, gauzeHeat * 0.22, 0);
    if (!this.lit) {
      this.light.intensity = 0;
      if (this.gas > 0.02) w.audio?.play('gasLeak', 0.08 + this.gas * 0.15);
      return;
    }

    // Shape: luminous flame is tall, wide and wavy; with air it turns into a short, steady blue cone.
    const a = this.air, g = this.gas;
    const flick = 1 + Math.sin(t * (14 - a * 6)) * (0.1 - a * 0.07) + (Math.random() - 0.5) * (0.12 - a * 0.08);
    this.flameLen = (0.05 + 0.07 * g) * (1.25 - 0.45 * a) * flick;
    this.flameR = 0.008 + 0.006 * g * (1 - 0.3 * a);
    this.outer.scale.set(this.flameR, this.flameLen, this.flameR);
    this.outer.position.x = Math.sin(t * 3.1) * 0.003 * (1 - a);
    this.inner.scale.set(this.flameR * 0.55, this.flameLen * 0.38 * a, this.flameR * 0.55);
    this.inner.visible = a > 0.08;
    _c.copy(YELLOW).lerp(BLUE, a);
    if (this._tintK > 0) _c.lerp(this._tint, Math.min(1, this._tintK));
    this.outer.material.color.copy(_c);
    this.outer.material.opacity = THREE.MathUtils.lerp(0.9, 0.5, a) + this._tintK * 0.3 * a;
    this.light.color.copy(_c);
    this.light.intensity = (0.25 + 0.6 * g) * (1 - 0.6 * a + this._tintK * 0.5) * (1 + Math.sin(t * 6) * 0.04);
    w.audio?.play('flame', 0.12 + g * (0.15 + a * 0.5));
  }
}
