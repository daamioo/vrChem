import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { ParticleSystem } from '../effects/ParticleSystem.js';
import { skyColors, fogColor, outdoorLight, sunDirection, daylight, duskness } from '../core/DayCycle.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3(), _v = new THREE.Vector3();

/** Seeded random so the plant looks the same every load. */
function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }

function canvasTex(w, h, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Merges every plain mesh below `root` into one mesh per material (draw calls matter on Quest).
 * Subtrees in `skip` (animated parts) and instanced meshes / sprites / multi-material meshes are left alone.
 */
function bake(root, skip = new Set()) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), rel = new THREE.Matrix4();
  const byMat = new Map(), victims = [];
  const visit = (o) => {
    if (skip.has(o)) return;
    if (o.isMesh && !o.isInstancedMesh && !Array.isArray(o.material) && o !== root) {
      rel.multiplyMatrices(inv, o.matrixWorld);
      const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(rel);
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(g);
      victims.push(o);
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  for (const o of victims) { o.parent.remove(o); o.geometry.dispose(); }
  for (const [mat, geos] of byMat) {
    const names = ['position', 'normal', 'uv', 'color'].filter((n) => geos.every((g) => g.attributes[n]));
    const out = new THREE.BufferGeometry();
    for (const n of names) {
      const size = geos[0].attributes[n].itemSize, total = geos.reduce((s, g) => s + g.attributes[n].count, 0);
      const arr = new Float32Array(total * size);
      let off = 0;
      for (const g of geos) { arr.set(g.attributes[n].array, off); off += g.attributes[n].array.length; }
      out.setAttribute(n, new THREE.BufferAttribute(arr, size));
    }
    geos.forEach((g) => g.dispose());
    out.computeBoundingSphere();
    root.add(new THREE.Mesh(out, mat));
  }
}

/** Per-vertex colour bands by height (chimney stripes). */
function bands(geo, h, colors, n) {
  const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / h + 0.5;
    c.set(y > 0.62 && Math.floor(y * n) % 2 === 0 ? colors[1] : colors[0]);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}

/**
 * The view out of the lab's window: a big chemical plant at dusk seen from an upper floor.
 * Factory halls with lit windows and sawtooth roofs, smoking chimneys with blinking aircraft
 * lights, cooling towers venting steam, a flare stack, a tank farm, a gantry crane working a
 * container yard, a conveyor bridge carrying crates, trucks on the road and a freight train.
 * Everything is procedural (no assets). Local frame: origin at the base of the window wall,
 * +X points away from the building, Z runs along it. Nothing out here is raycast or physical.
 * Its background sound (hum, machinery, the odd horn or clank) comes from the window: faint with
 * the window shut, much louder when it's open (world.env.outsideOpen).
 * The time of day (world.env.hours, set by the WallClock) drives the sky (day blue, sunset,
 * night with stars), the haze, how brightly the buildings are lit and how much the factory
 * windows and street lamps glow — all changing smoothly.
 * def: { position, rotationY, groundY = -9, ambienceAt = [x, y, z] local position of the window }
 */
export class FactoryVista extends Entity {
  constructor(world, def) {
    super(world);
    this.def = def;
    this.object3D.position.set(...(def.position ?? [0, 0, 0]));
    this.object3D.rotation.y = THREE.MathUtils.degToRad(def.rotationY ?? 0);
    this.g = def.groundY ?? -9;
    this.rand = rng(def.seed ?? 7);
    this.movers = [];      // { obj, axis, speed, min, max }
    this.blinkers = [];
    this.fans = [];
    this.stacks = [];      // smoke / steam emitters
    this._lam = new Map();
    this.mat = {
      concrete: this.lam(0x8c8f93),
      darkMetal: this.lam(0x3a4048),
      steel: this.lam(0x9aa3ad),
      rust: this.lam(0x8a4b2a),
      yellow: this.lam(0xe0a21b),
      white: this.lam(0xd9dde2),
      redLight: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xffe2a0 }),
      striped: new THREE.MeshLambertMaterial({ vertexColors: true }),
      glazing: new THREE.MeshBasicMaterial({ color: 0xb59a6a }),
    };

    this.buildSky();
    this.buildGround();
    this.buildRoadAndRail();
    this.buildHalls();
    this.buildContainerYard();
    this.buildConveyor();
    this.buildTankFarm();
    this.buildChimneysAndTowers();
    this.buildSkyline();
    this.buildLedge();

    // merge static scenery and each moving rig into as few draw calls as possible
    for (const m of this.movers) bake(m.obj);
    for (const f of this.fans) bake(f.obj);
    bake(this.crane, new Set([this.trolley]));
    const animated = new Set([...this.movers.map((m) => m.obj), ...this.fans.map((f) => f.obj), ...this.blinkers.map((b) => b.obj),
      this.crane, this.flare, this.weld, this.crates]);
    bake(this.object3D, animated);
    this.object3D.traverse((o) => { o.raycast = () => {}; });
    // Outdoor materials and their base colours: the time of day scales them (the lab's indoor
    // lights also light these meshes, so their colour carries the outdoor brightness instead).
    this.outdoorMats = [];
    const seen = new Set();
    this.object3D.traverse((o) => {
      for (const m of [o.material].flat()) {
        if (!m || seen.has(m) || !(m.isMeshLambertMaterial || m.isMeshStandardMaterial)) continue;
        seen.add(m); this.outdoorMats.push({ m, base: m.color.clone() });
      }
    });
    this.basics = [this.mat.lamp, this.mat.glazing].map((m) => ({ m, base: m.color.clone() }));
    this.smoke = new ParticleSystem(world.scene, { capacity: 1300, gravity: -0.35, drag: 0.12 });
    this.smoke.points.material.fog = false;
  }

  onAdded() {
    this._prevFog = this.world.scene.fog;
    // Haze for the distance only: starts far beyond the lab's walls, so nothing indoors is tinted.
    this.world.scene.fog = new THREE.Fog(0x7f6f78, 40, 330);
    this.world.particles?.all.push(this.smoke);
  }

  onRemoved() {
    if (this.amb) { try { this.amb.src.stop(); this.amb.lfo.stop(); } catch { /* not started */ } this.amb.out.disconnect(); }
    this.world.scene.fog = this._prevFog ?? null;
    const all = this.world.particles?.all;
    if (all) all.splice(all.indexOf(this.smoke), 1);
    this.world.scene.remove(this.smoke.points);
  }

  /** Shared Lambert material per colour, so baking can merge everything of one colour. */
  lam(color) {
    if (!this._lam.has(color)) this._lam.set(color, new THREE.MeshLambertMaterial({ color }));
    return this._lam.get(color);
  }

  add(geo, mat, x, y, z, parent = this.object3D) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  // ------------------------------------------------------------------ scenery

  buildSky() {
    this.skyU = {
      sun: { value: new THREE.Vector3(0.9, 0.08, -0.42).normalize() },
      zenith: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
      glow: { value: 1 }, night: { value: 0 }, dusk: { value: 1 },
    };
    const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: this.skyU,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 sun, zenith, mid, horizon; uniform float glow, night, dusk; varying vec3 vDir;
        float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main(){
          float h = vDir.y;
          vec3 c = mix(horizon, mid, smoothstep(0.0, 0.18, h));
          c = mix(c, zenith, smoothstep(0.15, 0.6, h));
          float s = max(dot(vDir, sun), 0.0);
          float up = smoothstep(-0.12, 0.04, sun.y);
          c += (vec3(1.0,0.55,0.25) * pow(s, 12.0) * 0.6 * dusk + vec3(1.0,0.85,0.6) * pow(s, 400.0) * 1.5) * glow * up;
          // fixed stars at night (static — no twinkle)
          vec3 g = floor(vDir * 180.0);
          float st = step(0.9965, hash(g)) * night * smoothstep(0.05, 0.3, h);
          c += vec3(st * 0.9);
          if (h < 0.0) c = mix(horizon * 0.8, horizon * 0.35, smoothstep(0.0, -0.1, h));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    }));
    sky.renderOrder = -10;
    this.object3D.add(sky);
  }

  buildGround() {
    const tex = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#5d6064'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) { const v = 80 + Math.random() * 30; g.fillStyle = `rgba(${v},${v},${v + 4},0.35)`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
      g.strokeStyle = 'rgba(40,42,46,0.6)'; g.lineWidth = 2; g.strokeRect(0, 0, w, h);
    }, { repeat: [80, 80] });
    this.add(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: tex }), 200, this.g, 0);
  }

  buildRoadAndRail() {
    const g = this.g;
    const roadTex = canvasTex(64, 256, (c, w, h) => {
      c.fillStyle = '#2f3236'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#e8e2c8'; c.fillRect(w / 2 - 2, 0, 4, h * 0.5);
      c.fillRect(2, 0, 3, h); c.fillRect(w - 5, 0, 3, h);
    }, { repeat: [1, 60] });
    this.add(new THREE.PlaneGeometry(9, 600).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: roadTex }), 13, g + 0.02, 0);
    // street lamps
    for (let z = -90; z <= 90; z += 18) {
      this.add(new THREE.CylinderGeometry(0.08, 0.1, 7, 6), this.mat.darkMetal, 8, g + 3.5, z);
      this.add(new THREE.BoxGeometry(1.2, 0.15, 0.3), this.mat.darkMetal, 8.6, g + 7, z);
      this.add(new THREE.BoxGeometry(0.5, 0.06, 0.25), this.mat.lamp, 9, g + 6.9, z);
    }
    // trucks in both lanes
    const colors = [0xc0392b, 0x2e86c1, 0xf2f3f4, 0x27ae60, 0xe67e22];
    for (let i = 0; i < 6; i++) {
      const dir = i % 2 ? 1 : -1;
      const t = this.truck(colors[i % colors.length]);
      t.position.set(13 + dir * 2.2, g, -150 + i * 55);
      t.rotation.y = dir > 0 ? 0 : Math.PI;
      this.object3D.add(t);
      this.movers.push({ obj: t, speed: dir * (9 + this.rand() * 4), min: -160, max: 160 });
    }
    // railway with a freight train of tank wagons
    const sleeperGeo = new THREE.BoxGeometry(2.6, 0.15, 0.25);
    const sleepers = new THREE.InstancedMesh(sleeperGeo, this.mat.rust, 400);
    for (let i = 0; i < 400; i++) sleepers.setMatrixAt(i, _m.makeTranslation(22, g + 0.08, -200 + i));
    this.object3D.add(sleepers);
    for (const dx of [-0.72, 0.72]) this.add(new THREE.BoxGeometry(0.1, 0.15, 400), this.mat.steel, 22 + dx, g + 0.22, 0);
    const train = new THREE.Group();
    train.add(this.locomotive());
    for (let i = 1; i <= 12; i++) { const w = this.tankWagon(i % 3 === 0 ? 0x2d3a46 : i % 3 === 1 ? 0xd8dbe0 : 0x8b2f2a); w.position.z = -i * 13; train.add(w); }
    train.position.set(22, g + 0.3, 40);
    this.object3D.add(train);
    this.movers.push({ obj: train, speed: 5, min: -60, max: 360 });
  }

  truck(color) {
    const t = new THREE.Group(), paint = this.lam(color);
    this.add(new THREE.BoxGeometry(2.4, 2.6, 2.2), paint, 0, 1.8, 5.2, t);                 // cab
    this.add(new THREE.BoxGeometry(2.2, 0.7, 0.1), this.mat.darkMetal, 0, 2.4, 6.31, t);   // windscreen
    this.add(new THREE.BoxGeometry(2.5, 3, 10), this.mat.white, 0, 2.1, -1.2, t);        // trailer
    for (const x of [-0.8, 0.8]) this.add(new THREE.BoxGeometry(0.4, 0.25, 0.06), this.mat.lamp, x, 1.0, 6.32, t);   // headlights
    for (const x of [-1, 1]) this.add(new THREE.BoxGeometry(0.3, 0.2, 0.06), this.mat.redLight, x, 1.0, -6.22, t);  // tail lights
    const wheel = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 10).rotateZ(Math.PI / 2);
    for (const z of [5, 1.5, -3, -4.4]) for (const x of [-1.1, 1.1]) this.add(wheel, this.mat.darkMetal, x, 0.5, z, t);
    return t;
  }

  locomotive() {
    const l = new THREE.Group();
    this.add(new THREE.BoxGeometry(2.9, 3.6, 16), this.mat.yellow, 0, 2.1, 0, l);
    this.add(new THREE.BoxGeometry(2.7, 0.9, 0.1), this.lam(0x1a222b), 0, 3.1, 8.01, l);
    this.add(new THREE.BoxGeometry(0.5, 0.3, 0.08), this.mat.lamp, 0, 1.4, 8.02, l);
    return l;
  }

  tankWagon(color) {
    const w = new THREE.Group();
    this.add(new THREE.BoxGeometry(2.6, 0.5, 12), this.mat.darkMetal, 0, 0.6, 0, w);
    this.add(new THREE.CapsuleGeometry(1.4, 9, 4, 14).rotateX(Math.PI / 2), this.lam(color), 0, 2.3, 0, w);
    this.add(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 10), this.mat.darkMetal, 0, 3.8, 0, w);
    return w;
  }

  /** Hall facade: corrugated panels with rows of windows, some lit (emissive map). */
  hallTextures(seed) {
    const r = rng(seed), lit = [];
    const map = canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#6f7780'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 4) { g.fillStyle = x % 8 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)'; g.fillRect(x, 0, 2, h); }
      for (let row = 0; row < 2; row++) for (let col = 0; col < 12; col++) {
        const on = r() < 0.55; lit.push(on);
        g.fillStyle = on ? '#e8d49a' : '#20262d';
        g.fillRect(8 + col * 20.5, 18 + row * 46, 14, 24);
      }
      g.fillStyle = '#2b3036'; g.fillRect(100, 92, 56, 36);        // loading door
    });
    let i = 0;
    const emissive = canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      for (let row = 0; row < 2; row++) for (let col = 0; col < 12; col++) {
        if (lit[i++]) { g.fillStyle = '#ffcf73'; g.fillRect(8 + col * 20.5, 18 + row * 46, 14, 24); }
      }
    });
    return { map, emissive };
  }

  hall(x, z, len, width, height, seed, { sign = null } = {}) {
    const g = this.g, grp = new THREE.Group();
    grp.position.set(x, g, z);
    const { map, emissive } = this.hallTextures(seed);
    map.repeat.set(len / 40, 1); emissive.repeat.set(len / 40, 1);
    const wallMat = new THREE.MeshLambertMaterial({ map, emissiveMap: emissive, emissive: 0xffffff, emissiveIntensity: 0.9 });
    (this.hallMats ??= []).push(wallMat);
    const endMat = this.lam(0x6a727b);
    // box: long sides use the window texture, ends plain. Long axis = Z.
    this.add(new THREE.BoxGeometry(width, height, len), [wallMat, wallMat, this.mat.darkMetal, this.mat.darkMetal, endMat, endMat], 0, height / 2, 0, grp);
    // sawtooth roof extruded along the hall
    const teeth = Math.max(2, Math.round(width / 6)), tw = width / teeth, shape = new THREE.Shape();
    shape.moveTo(-width / 2, 0);
    for (let i = 0; i < teeth; i++) { shape.lineTo(-width / 2 + i * tw, 3); shape.lineTo(-width / 2 + (i + 1) * tw, 0); }
    shape.lineTo(-width / 2, 0);
    const roof = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
    roof.translate(0, 0, -len / 2);
    this.add(roof, this.lam(0x4d555e), 0, height, 0, grp);
    // glazing on the steep side of each tooth catches the light
    for (let i = 0; i < teeth; i++) this.add(new THREE.PlaneGeometry(len, 2.6).rotateY(Math.PI / 2), this.mat.glazing, -width / 2 + i * tw + 0.02, height + 1.5, 0, grp);
    // rooftop vent turbines
    for (let k = 0; k < Math.floor(len / 14); k++) {
      const fan = new THREE.Group();
      fan.position.set((this.rand() - 0.5) * width * 0.6, height + 3.2, -len / 2 + 7 + k * 14);
      this.add(new THREE.CylinderGeometry(0.9, 0.9, 1.2, 8), this.mat.steel, 0, 0.6, 0, fan);
      for (let b = 0; b < 4; b++) this.add(new THREE.BoxGeometry(1.9, 0.08, 0.3), this.mat.steel, 0, 1.25, 0, fan).rotation.y = (b * Math.PI) / 4;
      grp.add(fan);
      this.fans.push({ obj: fan, speed: 1.5 + this.rand() * 2 });
    }
    if (sign) {
      const tex = canvasTex(512, 96, (c, w, h) => {
        c.fillStyle = '#0b0d10'; c.fillRect(0, 0, w, h);
        c.font = 'bold 64px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.shadowColor = '#ff3b2e'; c.shadowBlur = 18; c.fillStyle = '#ff6a55'; c.fillText(sign, w / 2, h / 2 + 4);
      });
      this.signMat = new THREE.MeshBasicMaterial({ map: tex, fog: false });
      this.add(new THREE.PlaneGeometry(len * 0.5, len * 0.5 * 96 / 512).rotateY(-Math.PI / 2), this.signMat, -width / 2 - 0.3, height - 2.2, 0, grp);
    }
    this.object3D.add(grp);
    return grp;
  }

  buildHalls() {
    this.hall(48, -30, 70, 26, 14, 3, { sign: 'ZAKŁADY CHEMICZNE' });
    this.hall(52, 38, 50, 22, 12, 11);
    this.hall(92, -5, 80, 30, 18, 19);
    // welding glow in the open bay door of the first hall
    this.weld = this.add(new THREE.PlaneGeometry(10, 6).rotateY(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7fb4ff, fog: false }), 48 - 13.05, this.g + 3, -42);
    // pipe rack connecting the halls
    for (let z = -60; z <= 60; z += 8) {
      this.add(new THREE.BoxGeometry(0.4, 9, 0.4), this.mat.rust, 30, this.g + 4.5, z);
      this.add(new THREE.BoxGeometry(4, 0.4, 0.4), this.mat.rust, 30, this.g + 9, z);
    }
    const pipeCols = [0xb8bec6, 0xd0a33c, 0x5d8aa8, 0xb8bec6];
    pipeCols.forEach((c, i) => this.add(new THREE.CylinderGeometry(0.35, 0.35, 124, 10).rotateX(Math.PI / 2), this.lam(c), 28.6 + i * 0.95, this.g + 9.6, 0));
  }

  buildContainerYard() {
    const g = this.g, x0 = 40, z0 = 72;
    const colors = [0xb03a2e, 0x1f618d, 0x117a65, 0xd68910, 0x7d3c98, 0x839192];
    const geo = new THREE.BoxGeometry(2.5, 2.6, 12);
    const count = 48, boxes = new THREE.InstancedMesh(geo, this.lam(0xffffff), count);
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const row = i % 8, stack = Math.floor(i / 8) % 3, lane = Math.floor(i / 24);
      boxes.setMatrixAt(i, _m.makeTranslation(x0 + row * 2.8, g + 1.3 + stack * 2.6, z0 + lane * 14));
      boxes.setColorAt(i, col.set(colors[Math.floor(this.rand() * colors.length)]));
    }
    this.object3D.add(boxes);
    // gantry crane rolling along the yard, trolley crossing it
    const crane = this.crane = new THREE.Group();
    const span = 30, h = 16;
    for (const x of [-span / 2, span / 2]) for (const dz of [-3, 3]) this.add(new THREE.BoxGeometry(0.8, h, 0.8), this.mat.yellow, x, h / 2, dz, crane);
    for (const dz of [-3, 3]) this.add(new THREE.BoxGeometry(span + 2, 1.2, 1), this.mat.yellow, 0, h, dz, crane);
    this.trolley = new THREE.Group();
    this.add(new THREE.BoxGeometry(3, 1.6, 7.5), this.mat.darkMetal, 0, h + 0.6, 0, this.trolley);
    this.cable = this.add(new THREE.CylinderGeometry(0.05, 0.05, 1, 4).translate(0, -0.5, 0), this.mat.darkMetal, 0, h - 0.3, 0, this.trolley);
    this.spreader = this.add(new THREE.BoxGeometry(2.6, 0.5, 12), this.mat.yellow, 0, 0, 0, this.trolley);
    this.carried = this.add(new THREE.BoxGeometry(2.5, 2.6, 12), this.lam(0x1f618d), 0, 0, 0, this.trolley);
    crane.add(this.trolley);
    crane.position.set(x0 + 10, g, z0 + 7);
    this.object3D.add(crane);
    this.add(new THREE.BoxGeometry(span + 4, 0.2, 60), this.lam(0x6d7075), x0 + 10, g + 0.05, z0 + 14);
  }

  buildConveyor() {
    const g = this.g;
    this.convA = new THREE.Vector3(36, g + 5, 2);
    this.convB = new THREE.Vector3(76, g + 21, 2);
    const len = this.convA.distanceTo(this.convB), mid = this.convA.clone().lerp(this.convB, 0.5);
    const dir = this.convB.clone().sub(this.convA).normalize();
    const belt = this.add(new THREE.BoxGeometry(len, 0.4, 2.2), this.mat.darkMetal, mid.x, mid.y, mid.z);
    belt.rotation.z = Math.atan2(dir.y, dir.x);
    for (const dz of [-1.2, 1.2]) { const rail = this.add(new THREE.BoxGeometry(len, 0.9, 0.12), this.mat.rust, mid.x, mid.y + 0.5, mid.z + dz); rail.rotation.z = belt.rotation.z; }
    for (let i = 1; i < 6; i++) {
      const p = this.convA.clone().lerp(this.convB, i / 6);
      this.add(new THREE.BoxGeometry(0.6, p.y - g, 0.6), this.mat.rust, p.x, (p.y + g) / 2, p.z);
    }
    this.add(new THREE.BoxGeometry(8, 26, 8), this.lam(0x7a838c), 80, g + 13, 2);   // tower it feeds
    this.crates = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 1.1, 1.4), this.lam(0xa9793f), 14);
    this.crateAngle = belt.rotation.z;
    this.object3D.add(this.crates);
  }

  buildTankFarm() {
    const g = this.g;
    for (let i = 0; i < 4; i++) {           // spherical gas tanks on legs
      const x = 125 + (i % 2) * 22, z = -60 + Math.floor(i / 2) * 24, r = 8;
      this.add(new THREE.SphereGeometry(r, 20, 14), this.mat.white, x, g + r + 6, z);
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; this.add(new THREE.CylinderGeometry(0.4, 0.4, r + 6, 6), this.mat.steel, x + Math.cos(a) * r * 0.85, g + (r + 6) / 2, z + Math.sin(a) * r * 0.85); }
      this.blink(x, g + 2 * r + 6.4, z, i * 0.3);
    }
    for (let i = 0; i < 5; i++) {           // squat storage tanks
      const x = 70 + i * 13, z = -85, r = 5.5;
      this.add(new THREE.CylinderGeometry(r, r, 9, 20), i % 2 ? this.mat.white : this.mat.steel, x, g + 4.5, z);
      this.add(new THREE.ConeGeometry(r, 1.2, 20), this.mat.steel, x, g + 9.6, z);
    }
  }

  blink(x, y, z, phase = 0) {
    this._blinkMat ??= new THREE.MeshBasicMaterial({ color: 0xff2a1a, fog: false });
    const m = this.add(new THREE.SphereGeometry(0.6, 8, 6), this._blinkMat, x, y, z);
    this.blinkers.push({ obj: m, phase });
  }

  buildChimneysAndTowers() {
    const g = this.g;
    // tall red/white stacks
    for (const [x, z, h, rate] of [[110, 30, 70, 1], [124, 40, 85, 1.3], [138, 22, 60, 0.8]]) {
      const geo = bands(new THREE.CylinderGeometry(2.2, 3.4, h, 16), h, ['#c9ccd1', '#c0392b'], 9);
      this.add(geo, this.mat.striped, x, g + h / 2, z);
      this.blink(x + 2.4, g + h - 1, z, x * 0.01);
      this.stacks.push({ p: new THREE.Vector3(x, g + h + 0.5, z), rate: 14 * rate, size: 4, color: [0.5, 0.48, 0.52, 0.45], speed: 2.5 });
    }
    // cooling towers
    for (const [x, z] of [[170, -20], [200, 15]]) {
      const pts = [];
      for (let i = 0; i <= 12; i++) { const t = i / 12, y = t * 55; pts.push(new THREE.Vector2(18 - 9 * Math.sin(t * Math.PI * 0.85) + t * 2, y)); }
      this.add(new THREE.LatheGeometry(pts, 32), this._towerMat ??= new THREE.MeshLambertMaterial({ color: 0xa7a39d, side: THREE.DoubleSide }), x, g, z);
      this.stacks.push({ p: new THREE.Vector3(x, g + 56, z), rate: 18, size: 9, color: [0.85, 0.84, 0.86, 0.35], speed: 3, spread: 12 });
    }
    // flare stack with a flickering flame
    const fx = 150, fz = -95, fh = 48;
    this.add(new THREE.CylinderGeometry(0.8, 1.4, fh, 10), this.mat.darkMetal, fx, g + fh / 2, fz);
    this.flare = new THREE.Group();
    this.flare.position.set(fx, g + fh, fz);
    const fm = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.flareOuter = this.add(new THREE.ConeGeometry(2.2, 9, 12, 1, true).translate(0, 4.5, 0), fm(0xff7a22, 0.8), 0, 0, 0, this.flare);
    this.flareInner = this.add(new THREE.ConeGeometry(1.1, 5, 10, 1, true).translate(0, 2.5, 0), fm(0xffe08a, 0.9), 0, 0, 0, this.flare);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: canvasTex(64, 64, (c, w) => { const gr = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,170,80,0.9)'); gr.addColorStop(1, 'rgba(255,120,40,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, w); }),
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true,
    }));
    glow.scale.set(30, 30, 1); glow.position.y = 4;
    this.flare.add(glow);
    this.flareGlow = glow;
    this.object3D.add(this.flare);
    this.stacks.push({ p: new THREE.Vector3(fx, g + fh + 9, fz), rate: 5, size: 3, color: [0.2, 0.18, 0.2, 0.4], speed: 3 });
  }

  buildSkyline() {
    const n = 70, geo = new THREE.BoxGeometry(1, 1, 1);
    const city = new THREE.InstancedMesh(geo, this.lam(0x3d3f4a), n);
    for (let i = 0; i < n; i++) {
      const a = (this.rand() - 0.5) * 2.2, d = 240 + this.rand() * 90, h = 15 + this.rand() * 55, w = 10 + this.rand() * 18;
      _m.compose(_p.set(Math.cos(a) * d, this.g + h / 2, Math.sin(a) * d), _q.identity(), _v.set(w, h, w));
      city.setMatrixAt(i, _m);
    }
    this.object3D.add(city);
  }

  /** Concrete ledge and facade strip right outside the window, so the drop below reads. */
  buildLedge() {
    this.add(new THREE.BoxGeometry(0.5, 0.12, 4.4), this.mat.concrete, 0.42, 0.98, 0);
    this.add(new THREE.BoxGeometry(0.3, 0.6, 30), this.lam(0x7c8187), 0.3, this.g + 0.3, 0);
  }

  // ------------------------------------------------------------------ animation

  update(dt) {
    const t = this.world.time;
    for (const m of this.movers) {
      m.obj.position.z += m.speed * dt;
      if (m.speed > 0 && m.obj.position.z > m.max) m.obj.position.z = m.min;
      if (m.speed < 0 && m.obj.position.z < m.min) m.obj.position.z = m.max;
    }
    for (const f of this.fans) f.obj.rotation.y += f.speed * dt;
    for (const b of this.blinkers) b.obj.visible = ((t * 0.7 + b.phase) % 1) < 0.25;

    // gantry crane: roll along the yard, trolley across, hoist up and down
    if (this.crane) {
      const cycle = (t / 28) % 1;
      this.crane.position.z = this.def.craneZ ?? (79 + Math.sin(t * 0.09) * 12);
      this.trolley.position.x = Math.sin(cycle * Math.PI * 2) * 11;
      const drop = 6 + Math.sin(cycle * Math.PI * 4 - Math.PI / 2) * 5;
      this.cable.scale.y = drop;
      this.spreader.position.y = 16 - 0.3 - drop - 0.25;
      this.carried.position.y = this.spreader.position.y - 1.55;
      this.carried.visible = cycle < 0.5;
    }

    // conveyor crates
    if (this.crates) {
      _q.setFromAxisAngle(_v.set(0, 0, 1), this.crateAngle);
      for (let i = 0; i < 14; i++) {
        const k = (t * 0.035 + i / 14) % 1;
        _p.copy(this.convA).lerp(this.convB, k);
        _p.y += 0.75;
        this.crates.setMatrixAt(i, _m.compose(_p, _q, _s));
      }
      this.crates.instanceMatrix.needsUpdate = true;
    }

    // Flare, welding glow and neon sign: slow, smooth changes only (well under 1 Hz, low contrast),
    // never random per-frame flicker — rapid flashing can trigger photosensitive seizures.
    if (this.flare) {
      const f = 1 + Math.sin(t * 1.3) * 0.06 + Math.sin(t * 0.7 + 1) * 0.04;
      this.flareOuter.scale.set(1, f, 1);
      this.flareInner.scale.set(1, f * 0.97, 1);
      this.flareGlow.material.opacity = 0.75 + (f - 1) * 0.8;
      this.flare.rotation.z = Math.sin(t * 0.6) * 0.12;
    }
    if (this.weld) {
      // a soft blue work-light glow that slowly swells and fades
      const k = 0.5 + 0.25 * Math.sin(t * 0.5) + 0.1 * Math.sin(t * 0.23 + 2);
      this.weld.material.color.setRGB(0.12 + 0.3 * k, 0.16 + 0.38 * k, 0.24 + 0.5 * k);
    }

    // smoke and steam (world-space particles)
    this.object3D.updateMatrixWorld();
    const wind = _v.set(0, 0, 1.6).applyQuaternion(this.object3D.quaternion);
    for (const s of this.stacks) {
      const origin = this.object3D.localToWorld(_p.copy(s.p));
      this.smoke.emitRate(s.rate * dt, () => {
        const sp = s.spread ?? 1.5;
        const o = origin.clone().add(new THREE.Vector3((Math.random() - 0.5) * sp, 0, (Math.random() - 0.5) * sp));
        const v = new THREE.Vector3((Math.random() - 0.5) * 0.8, s.speed * (0.7 + Math.random() * 0.6), (Math.random() - 0.5) * 0.8).add(wind);
        const k = this._smokeLight ?? 1, col = [s.color[0] * k, s.color[1] * k, s.color[2] * k, s.color[3]];
        this.smoke.emit(o, v, col, s.size * (0.7 + Math.random() * 0.6), 9 + Math.random() * 5, 3.5);
      });
    }
    if (!this.world.particles) this.smoke.update(dt);
    this._ambience(dt);
    this._applyTimeOfDay();
  }

  /** Sky, haze and outdoor brightness from world.env.hours — recomputed every frame, so it's continuous. */
  _applyTimeOfDay() {
    const env = this.world.env, h = env.hours ?? 18, indoor = env.indoorLight ?? 1;
    const sky = skyColors(h), dl = daylight(h), dk = duskness(h), out = outdoorLight(h);
    const U = this.skyU;
    U.zenith.value.setRGB(...sky.zenith); U.mid.value.setRGB(...sky.mid); U.horizon.value.setRGB(...sky.horizon);
    U.sun.value.set(...sunDirection(h)).normalize();
    U.night.value = 1 - dl; U.dusk.value = 0.35 + 0.65 * dk; U.glow.value = 0.4 + 0.6 * Math.max(dl, dk);
    this.world.scene.fog?.color.setRGB(...fogColor(h));
    // buildings: outdoor light level and tint, compensated for the indoor lights that also hit them
    const k = Math.min(3, out.level / Math.max(0.05, indoor));
    for (const { m, base } of this.outdoorMats) m.color.setRGB(base.r * out.tint[0] * k, base.g * out.tint[1] * k, base.b * out.tint[2] * k);
    const night = 1 - dl;
    for (const hm of this.hallMats ?? []) hm.emissiveIntensity = 0.25 + 0.75 * night;
    const [lamp, glazing] = this.basics;
    lamp.m.color.copy(lamp.base).multiplyScalar(0.45 + 0.55 * night);
    glazing.m.color.copy(glazing.base).multiplyScalar(0.25 + 0.75 * Math.max(dl, dk * 0.8));
    if (this.signMat) this.signMat.color.setScalar(0.6 + 0.4 * night);
    this._smokeLight = 0.35 + 0.65 * out.level;
  }

  /** Industrial hum + machinery through the window, plus occasional distant horns and clanks. */
  _ambience(dt) {
    const audio = this.world.audio, ctx = audio?.ctx;
    if (!ctx || !audio.master) return;
    if (!this.amb) {
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const rumble = ctx.createBiquadFilter(); rumble.type = 'lowpass'; rumble.frequency.value = 160;
      const hiss = ctx.createBiquadFilter(); hiss.type = 'bandpass'; hiss.frequency.value = 1100; hiss.Q.value = 0.8;
      const gR = ctx.createGain(); gR.gain.value = 1.2;
      const gH = ctx.createGain(); gH.gain.value = 0.12;
      const lfo = ctx.createOscillator(), lfoAmt = ctx.createGain();       // machines cycling, slowly
      lfo.frequency.value = 0.18; lfoAmt.gain.value = 0.06; lfo.connect(lfoAmt).connect(gH.gain);
      const out = ctx.createGain(); out.gain.value = 0;
      const panner = ctx.createPanner();
      Object.assign(panner, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1.2, rolloffFactor: 0.8 });
      src.connect(rumble).connect(gR).connect(out);
      src.connect(hiss).connect(gH).connect(out);
      out.connect(panner).connect(audio.master);
      src.start(); lfo.start();
      this.amb = { src, lfo, out, panner, next: 4 };
      this.object3D.updateMatrixWorld(true);
      const p = this.object3D.localToWorld(new THREE.Vector3(...(this.def.ambienceAt ?? [0, 1.7, -0.5])));
      if (panner.positionX) { panner.positionX.value = p.x; panner.positionY.value = p.y; panner.positionZ.value = p.z; } else panner.setPosition(p.x, p.y, p.z);
    }
    const open = this.world.env?.outsideOpen ?? 0;
    this.amb.out.gain.setTargetAtTime(0.025 + 0.5 * open, ctx.currentTime, 0.25);
    this.amb.next -= dt;
    if (this.amb.next <= 0) {
      this.amb.next = 7 + Math.random() * 12;
      const r = Math.random();
      if (r < 0.35) this._horn(ctx); else if (r < 0.8) this._clank(ctx); else this._rumbleBy(ctx);
    }
  }

  _env(ctx, gain, attack, hold, release) {
    const g = ctx.createGain(), t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    g.connect(this.amb.out);
    return { g, end: t + attack + hold + release };
  }

  /** Distant factory / train horn: two detuned low notes. */
  _horn(ctx) {
    const { g, end } = this._env(ctx, 0.12, 0.15, 1.1, 0.6);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650; lp.connect(g);
    for (const f of [155, 196]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); o.stop(end); }
  }

  /** Metal clank from the crane / yard: a few short pings. */
  _clank(ctx) {
    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
      const delay = i * (0.15 + Math.random() * 0.2), t = ctx.currentTime + delay;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      g.connect(this.amb.out);
      for (const f of [700 + Math.random() * 300, 1900 + Math.random() * 600]) { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(g); o.start(t); o.stop(t + 0.55); }
    }
  }

  /** A heavy truck / train rumbling past. */
  _rumbleBy(ctx) {
    const { g, end } = this._env(ctx, 0.5, 2.0, 1.0, 2.5);
    const src = ctx.createBufferSource(); src.buffer = this.amb.src.buffer; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
    src.connect(lp).connect(g); src.start(); src.stop(end);
  }
}
