import * as THREE from 'three';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const GAUGE = 1.435, SLEEPER_STEP = 0.65;

/** Polyline in the ground plane (x, z) with arc-length lookup. */
class Path {
  constructor(points) {
    this.pts = points.map(([x, z]) => new THREE.Vector2(x, z));
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + this.pts[i].distanceTo(this.pts[i - 1]));
    this.length = this.cum[this.cum.length - 1];
  }
  /** Point at distance s (clamped), written into target (Vector2). */
  at(s, target = new THREE.Vector2()) {
    s = THREE.MathUtils.clamp(s, 0, this.length);
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < s) i++;
    const t = (s - this.cum[i - 1]) / Math.max(1e-9, this.cum[i] - this.cum[i - 1]);
    return target.copy(this.pts[i - 1]).lerp(this.pts[i], t);
  }
}

/**
 * The train yard in the view outside the window (built into a FactoryVista, in its local frame:
 * +X away from the building, Z along it). Five tracks: main lines on the outside, three yard
 * tracks between two switch ladders, plus a short siding with a buffer stop near the building.
 * Switch blades move when a route is set, colour-light signals (steady — never blinking) show
 * red / green, overhead catenary runs along the main lines, floodlight masts glow at night.
 * Traffic: a container train on one main line, a tank train on the other that stops at a red
 * signal, and a shunting engine with three wagons that pulls out of the yard through the ladder
 * onto the main line and back — only once the line is clear.
 */
export class RailYard {
  constructor(vista) {
    this.v = vista;
    this.g = vista.g;
    this.sleepers = [];
    this.junctions = [];                 // { blades: Group, set(diverge) }
    this.signals = [];
    this.root = new THREE.Group();
    vista.object3D.add(this.root);
    const T = this.tracks = [8, 12, 16, 20, 24];
    const mats = this.mats = {
      ballast: vista.lam(0x4a4642), gravel: vista.lam(0x5a5550), sleeper: vista.lam(0x7d7770),
      rail: vista.mat.steel, dark: vista.mat.darkMetal, white: vista.mat.white, red: vista.lam(0xc0392b),
      sigOff: new THREE.MeshBasicMaterial({ color: 0x1a1a1a }),
      red_on: new THREE.MeshBasicMaterial({ color: 0xff2a1a, fog: false }), green_on: new THREE.MeshBasicMaterial({ color: 0x22e06a, fog: false }),
    };
    const add = (geo, mat, x, y, z, parent = this.root) => vista.add(geo, mat, x, y, z, parent);
    this.add = add;
    const g = this.g;

    // gravel bed for the whole yard
    add(new THREE.PlaneGeometry(26, 900).rotateX(-Math.PI / 2), mats.gravel, 15, g + 0.01, 0);

    // ---- track layout (ladder slope 0.3 m sideways per metre)
    const k = 0.3;
    const south = (x) => -150 + (x - 8) / k;           // south ladder: (8,-150) -> (20,-110)
    const north = (x) => 110 + (x - 12) / k;            // north ladder: (12, 110) -> (24, 150)
    this.track(T[0], -420, T[0], 420);                  // main line west (northbound)
    this.track(T[4], -420, T[4], 420);                  // main line east (southbound)
    this.track(8, south(8), 20, south(20));             // south ladder
    this.track(12, north(12), 24, north(24));           // north ladder
    for (let i = 1; i <= 3; i++) this.track(T[i], south(T[i]), T[i], north(T[i]));
    // siding near the building: turnout off the west main line, buffer stop at the south end
    this.track(8, 40, 4, 40 - 4 / k);
    this.track(4, 40 - 4 / k, 4, -60);
    this.bufferStop(4, -60);

    // switches (points) at every junction; the shunting route uses track 2 -> north ladder -> east main
    for (const x of [8, 12, 16, 20]) this.junction(x, south(x), 1, x === 8 ? 'main' : 'yard');
    for (const x of [12, 16, 20, 24]) this.junction(x, north(x), -1, x === 24 ? 'main' : 'yard');
    this.junction(8, 40, -1, 'siding');
    this.jYard2N = this.junctions.find((j) => j.x === 16 && j.z > 0);
    this.jMainN = this.junctions.find((j) => j.x === 24);

    // signals: east main (protecting the north ladder), yard exit on track 2, west main (decor)
    this.sigMain = this.signal(T[4] + 1.9, 212, Math.PI, false);
    this.sigExit = this.signal(T[2] - 1.9, 112, 0, false);
    this.signal(T[0] - 1.9, -168, 0, true);
    this.signal(T[3] + 1.9, 104, 0, false);
    this.signal(T[1] - 1.9, 104, 0, false);

    this.catenary(T[0], -1); this.catenary(T[4], 1);
    for (const z of [-90, 10, 95]) this.floodMast(27.4, z);
    this.signalBox(3.5, 120);

    // parked rolling stock (static)
    for (let i = 0; i < 9; i++) this.place(this.boxcar(i % 3 ? 0x7a4a32 : 0x4f6d7a), T[1], -95 + i * 15.5);
    for (let i = 0; i < 4; i++) this.place(this.hopper(), T[3], -80 + i * 13.5);
    for (let i = 0; i < 4; i++) this.place(this.containerFlat(i), T[3], -20 + i * 17);
    for (let i = 0; i < 4; i++) this.place(this.tankWagon(i % 2 ? 0xd8dbe0 : 0x2d3a46), 4, -52 + i * 13);

    // sleepers: one instanced mesh for the whole yard
    const geo = new THREE.BoxGeometry(2.6, 0.16, 0.26);
    const inst = new THREE.InstancedMesh(geo, mats.sleeper, this.sleepers.length);
    this.sleepers.forEach((mm, i) => inst.setMatrixAt(i, mm));
    this.root.add(inst);

    // ---- moving trains
    // west main: container train, northbound, steady
    this.trainW = this.rigidTrain([this.locomotive(0x1f4e8c), ...Array.from({ length: 10 }, (_, i) => this.containerFlat(i + 3))]);
    this.trainW.position.set(T[0], g + 0.3, -300);
    this.trainW.userData = { speed: 7, len: this.trainW.userData.len };
    // east main: tank train, southbound, obeys the main signal
    this.trainE = this.rigidTrain([this.locomotive(0xe0a21b), ...Array.from({ length: 12 }, (_, i) => this.tankWagon([0x2d3a46, 0xd8dbe0, 0x8b2f2a][i % 3]))]);
    this.trainE.rotation.y = Math.PI;
    this.trainE.position.set(T[4], g + 0.3, 380);
    this.trainE.userData = { speed: 6, v: 6, len: this.trainE.userData.len };
    // shunter: engine + 3 wagons on track 2, out onto the east main and back
    this.shuntPath = new Path([[T[2], -40], [T[2], north(T[2])], [T[4], north(T[4])], [T[4], 196]]);
    this.consist = [this.shunter(), this.boxcar(0x5d7a3a), this.hopper(), this.boxcar(0x7a4a32)];
    this.consistLen = this.consist.reduce((s, c) => s + c.userData.len + 0.8, 0);
    for (const c of this.consist) this.root.add(c);
    this.shunt = { s: 60, from: 60, to: this.shuntPath.length - 2, v: 0, state: 'wait', timer: 6 };

    this.animated = [this.trainW, this.trainE, ...this.consist, ...this.junctions.map((j) => j.blades), ...this.signals.flatMap((s) => [s.red, s.green])];
    this.placeConsist();
  }

  // ------------------------------------------------------------------ building blocks

  /** Straight track segment: two rails, ballast, sleepers (instanced later). */
  track(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, g = this.g;
    const ballast = this.add(new THREE.BoxGeometry(3.4, 0.25, len), this.mats.ballast, cx, g + 0.12, cz);
    ballast.rotation.y = yaw;
    const side = new THREE.Vector2(Math.cos(yaw), -Math.sin(yaw));      // perpendicular in the ground plane
    for (const s of [-1, 1]) {
      const r = this.add(new THREE.BoxGeometry(0.07, 0.15, len), this.mats.rail, cx + side.x * s * GAUGE / 2, g + 0.38, cz + side.y * s * GAUGE / 2);
      r.rotation.y = yaw;
    }
    _q.setFromAxisAngle(UP, yaw);
    for (let d = 0.3; d < len; d += SLEEPER_STEP) {
      _p.set(x0 + (dx * d) / len, g + 0.27, z0 + (dz * d) / len);
      this.sleepers.push(new THREE.Matrix4().compose(_p, _q, _s));
    }
  }

  /** Switch blades at a junction on the straight track `x`, diverging toward `dir` (+1 east, -1 west). */
  junction(x, z, dir, kind) {
    const blades = new THREE.Group();
    blades.position.set(x, this.g + 0.4, z);
    for (const s of [-1, 1]) {
      const b = this.add(new THREE.BoxGeometry(0.07, 0.12, 6), this.mats.rail, s * GAUGE / 2 - s * 0.05, 0, 0, blades);
      b.position.z = 3;
    }
    this.root.add(blades);
    this.add(new THREE.BoxGeometry(0.5, 0.4, 0.8), this.mats.dark, x - dir * 1.4, this.g + 0.45, z + 0.5);   // point machine
    const j = { x, z, dir, kind, blades, state: 0, target: 0 };
    j.set = (diverge) => { j.target = diverge ? 1 : 0; };
    this.junctions.push(j);
    return j;
  }

  /** Colour-light signal on a mast: steady red or green (state changes only, never blinking). */
  signal(x, z, yaw, green) {
    const g = this.g, grp = new THREE.Group();
    grp.position.set(x, g, z); grp.rotation.y = yaw;
    this.add(new THREE.CylinderGeometry(0.09, 0.12, 5, 8), this.mats.dark, 0, 2.5, 0, grp);
    this.add(new THREE.BoxGeometry(0.6, 1.3, 0.35), this.mats.dark, 0, 5.2, 0, grp);
    this.add(new THREE.BoxGeometry(1.1, 1.5, 0.05), this.mats.white, 0, 5.2, -0.2, grp);          // backboard
    const red = this.add(new THREE.SphereGeometry(0.16, 10, 8), this.mats.sigOff, 0, 5.5, 0.19, grp);
    const greenL = this.add(new THREE.SphereGeometry(0.16, 10, 8), this.mats.sigOff, 0, 4.9, 0.19, grp);
    this.root.add(grp);
    const s = { red, green: greenL, state: null };
    s.set = (isGreen) => {
      if (s.state === isGreen) return;
      s.state = isGreen;
      red.material = isGreen ? this.mats.sigOff : this.mats.red_on;
      greenL.material = isGreen ? this.mats.green_on : this.mats.sigOff;
    };
    s.set(green);
    this.signals.push(s);
    return s;
  }

  bufferStop(x, z) {
    const g = this.g;
    this.add(new THREE.BoxGeometry(2.4, 1.2, 0.5), this.mats.red, x, g + 1.0, z - 0.6);
    for (let i = 0; i < 4; i++) this.add(new THREE.BoxGeometry(0.6, 0.3, 0.52), this.mats.white, x - 0.9 + i * 0.6, g + 1.2, z - 0.6);
    for (const s of [-1, 1]) { const b = this.add(new THREE.BoxGeometry(0.2, 0.2, 2.2), this.mats.dark, x + s * 0.72, g + 0.7, z + 0.2); b.rotation.x = -0.4; }
  }

  catenary(x, side) {
    const g = this.g;
    for (let z = -400; z <= 400; z += 45) {
      this.add(new THREE.BoxGeometry(0.25, 7.2, 0.25), this.mats.dark, x + side * 2.6, g + 3.6, z);
      this.add(new THREE.BoxGeometry(2.8, 0.12, 0.12), this.mats.dark, x + side * 1.3, g + 6.9, z);
    }
    this.add(new THREE.BoxGeometry(0.03, 0.03, 800), this.mats.dark, x, g + 6.4, 0);       // contact wire
    this.add(new THREE.BoxGeometry(0.03, 0.03, 800), this.mats.dark, x, g + 7.2, 0);       // messenger wire
  }

  floodMast(x, z) {
    const g = this.g;
    this.add(new THREE.CylinderGeometry(0.25, 0.45, 24, 8), this.mats.dark, x, g + 12, z);
    this.add(new THREE.BoxGeometry(3, 0.5, 0.8), this.mats.dark, x, g + 24.2, z);
    for (const dz of [-1, 1]) this.add(new THREE.BoxGeometry(1.2, 0.7, 0.2), this.v.mat.lamp, x - 0.5, g + 23.6, z + dz * 0.5).rotation.y = Math.PI / 2;
  }

  signalBox(x, z) {
    const g = this.g;
    this.add(new THREE.BoxGeometry(5, 3.4, 7), this.v.lam(0x8f6f58), x, g + 1.7, z);
    this.add(new THREE.BoxGeometry(5.4, 2.6, 7.4), this.v.lam(0xd9d4c9), x, g + 4.7, z);
    this.add(new THREE.BoxGeometry(0.05, 1.4, 6.4), this.v.mat.glazing, x + 2.71, g + 4.8, z);      // operator's windows
    this.add(new THREE.BoxGeometry(6, 0.3, 8.2), this.mats.dark, x, g + 6.15, z);
  }

  // ------------------------------------------------------------------ rolling stock (built along +Z, length in userData.len)

  _vehicle(len) {
    const v = new THREE.Group(); v.userData.len = len;
    for (const s of [-1, 1]) this.add(new THREE.BoxGeometry(2.2, 0.7, 2.6), this.mats.dark, 0, 0.45, s * (len / 2 - 2.2), v);   // bogies
    this.add(new THREE.BoxGeometry(2.6, 0.35, len), this.mats.dark, 0, 0.95, 0, v);                                           // frame
    return v;
  }
  locomotive(color) {
    const v = this._vehicle(18), c = this.v.lam(color);
    this.add(new THREE.BoxGeometry(2.9, 3.0, 17), c, 0, 2.6, 0, v);
    for (const s of [-1, 1]) this.add(new THREE.BoxGeometry(2.75, 0.9, 0.08), this.mats.dark, 0, 3.4, s * 8.52, v);
    this.add(new THREE.BoxGeometry(1.4, 0.25, 14), this.mats.dark, 0, 4.2, 0, v);                       // roof gear
    this.add(new THREE.BoxGeometry(0.1, 1.1, 1.6), this.mats.dark, 0, 4.9, -3, v);                      // pantograph
    this.add(new THREE.BoxGeometry(0.5, 0.3, 0.08), this.v.mat.lamp, 0, 1.7, 8.52, v);
    return v;
  }
  shunter() {
    const v = this._vehicle(10), c = this.v.lam(0xd35400);
    this.add(new THREE.BoxGeometry(2.4, 2.3, 6.5), c, 0, 2.2, -1.4, v);                                 // hood
    this.add(new THREE.BoxGeometry(2.9, 3.0, 3), c, 0, 2.6, 3.4, v);                                     // cab
    this.add(new THREE.BoxGeometry(2.95, 0.8, 2.4), this.mats.dark, 0, 3.4, 3.4, v);                    // cab windows
    for (let i = 0; i < 6; i++) this.add(new THREE.BoxGeometry(2.42, 0.18, 0.05), this.v.lam(0xf5c518), 0, 1.2 + (i % 2) * 0.4, -4.6 + i * 0.01, v);
    return v;
  }
  boxcar(color) {
    const v = this._vehicle(15), c = this.v.lam(color);
    this.add(new THREE.BoxGeometry(2.8, 3.2, 14.6), c, 0, 2.75, 0, v);
    for (const s of [-1, 1]) this.add(new THREE.BoxGeometry(0.06, 2.8, 3), this.mats.dark, s * 1.42, 2.7, 0, v);   // sliding doors
    return v;
  }
  hopper() {
    const v = this._vehicle(13), c = this.v.lam(0x6d7075);
    this.add(new THREE.BoxGeometry(2.9, 2.6, 12.4), c, 0, 2.6, 0, v);
    this.add(new THREE.BoxGeometry(2.6, 0.4, 12), this.v.lam(0x2b2622), 0, 3.85, 0, v);                // load
    return v;
  }
  containerFlat(i) {
    const v = this._vehicle(16.5);
    const cols = [0xb03a2e, 0x1f618d, 0x117a65, 0xd68910, 0x7d3c98, 0x839192];
    for (const s of [-1, 1]) this.add(new THREE.BoxGeometry(2.5, 2.6, 7.6), this.v.lam(cols[(i * 2 + (s > 0 ? 1 : 0)) % cols.length]), 0, 2.45, s * 3.95, v);
    return v;
  }
  tankWagon(color) {
    const v = this._vehicle(13);
    this.add(new THREE.CapsuleGeometry(1.4, 9.2, 4, 14).rotateX(Math.PI / 2), this.v.lam(color), 0, 2.6, 0, v);
    this.add(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 10), this.mats.dark, 0, 4.1, 0, v);
    return v;
  }

  place(vehicle, x, z) { vehicle.position.set(x, this.g + 0.3, z); this.root.add(vehicle); }

  /** A whole train as one rigid group (for straight main lines); front at local z = 0, cars behind. */
  rigidTrain(cars) {
    const grp = new THREE.Group();
    let z = 0;
    for (const c of cars) { c.position.z = z - c.userData.len / 2; z -= c.userData.len + 0.8; grp.add(c); }
    grp.userData.len = -z;
    this.root.add(grp);
    return grp;
  }

  // ------------------------------------------------------------------ animation

  /** Lay the shunting consist along the path: front of the engine at distance shunt.s. */
  placeConsist() {
    const a = new THREE.Vector2(), b = new THREE.Vector2();
    let s = this.shunt.s;
    for (const c of this.consist) {
      const L = c.userData.len, front = s, back = s - L;
      this.shuntPath.at(front - 1.5, a); this.shuntPath.at(back + 1.5, b);     // bogie points -> smooth through the switch
      c.position.set((a.x + b.x) / 2, this.g + 0.3, (a.y + b.y) / 2);
      c.rotation.y = Math.atan2(a.x - b.x, a.y - b.y);
      s -= L + 0.8;
    }
  }

  /** Is any part of the east-main tank train between z0 and z1? */
  _eastTrainIn(z0, z1) {
    const front = this.trainE.position.z, tail = front + this.trainE.userData.len;   // southbound: tail is north of the front
    return front < z1 && tail > z0;
  }

  update(dt) {
    // west main: steady, loops
    const W = this.trainW;
    W.position.z += W.userData.speed * dt;
    if (W.position.z - W.userData.len > 430) W.position.z = -430;

    // east main: slows to a stop at a red main signal, otherwise runs; loops
    const E = this.trainE, eu = E.userData, stopAt = 214;
    let vTarget = eu.speed;
    if (this.sigMain.state === false && E.position.z > stopAt - 1) vTarget = Math.min(eu.speed, Math.sqrt(2 * 0.35 * Math.max(0, E.position.z - stopAt)));
    eu.v += THREE.MathUtils.clamp(vTarget - eu.v, -0.6 * dt, 0.4 * dt);
    E.position.z -= eu.v * dt;
    if (E.position.z + eu.len < -430) E.position.z = 430;

    // shunting: wait -> (line clear?) set route -> pull out onto the east main -> wait -> push back -> release route
    const sh = this.shunt;
    sh.timer -= dt;
    const drive = (goal) => {
      const dist = goal - sh.s, dir = Math.sign(dist);
      const vMax = Math.min(4, Math.sqrt(2 * 0.5 * Math.abs(dist)));
      sh.v += THREE.MathUtils.clamp(dir * vMax - sh.v, -0.5 * dt, 0.5 * dt);
      sh.s += sh.v * dt;
      return Math.abs(dist) < 0.05 && Math.abs(sh.v) < 0.05;
    };
    const routeOut = sh.state === 'out' || sh.state === 'outWait' || sh.state === 'back';
    if (sh.state === 'wait' && sh.timer <= 0) {
      if (!this._eastTrainIn(120, 300) || (this.trainE.position.z > stopAt - 1 && this.sigMain.state === false)) {
        this.sigMain.set(false);                               // protect the line first
        if (!this._eastTrainIn(120, 213)) { this.jYard2N.set(true); this.jMainN.set(true); sh.state = 'setting'; sh.timer = 2.5; }
      } else sh.timer = 2;
    } else if (sh.state === 'setting' && sh.timer <= 0) { this.sigExit.set(true); sh.state = 'out'; }
    else if (sh.state === 'out' && drive(sh.to)) { sh.state = 'outWait'; sh.timer = 5; this.sigExit.set(false); }
    else if (sh.state === 'outWait' && sh.timer <= 0) sh.state = 'back';
    else if (sh.state === 'back' && drive(sh.from)) {
      this.jYard2N.set(false); this.jMainN.set(false); this.sigMain.set(true);
      sh.state = 'wait'; sh.timer = 10 + Math.random() * 8;
    }
    if (routeOut || sh.state === 'setting') this.placeConsist();

    // switch blades swing over smoothly
    for (const j of this.junctions) {
      j.state += THREE.MathUtils.clamp(j.target - j.state, -dt / 1.5, dt / 1.5);
      j.blades.rotation.y = j.dir * 0.035 * j.state;
    }
  }
}
