import * as THREE from 'three';
import { Entity } from '../core/Entity.js';

const _p = new THREE.Vector3();
const _h = new THREE.Vector3();
const _d = new THREE.Vector3();

/** Per-vertex colours from a function of the vertex position (fur patterns without textures). */
function tint(geo, colorAt) {
  const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    colorAt(pos.getX(i), pos.getY(i), pos.getZ(i), c);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}

// Cat-local layout (cat faces +Z, origin on the cushion). Body is an ellipsoid, head a sphere.
const BODY_C = new THREE.Vector3(0, 0.085, -0.02);
const BODY_R = new THREE.Vector3(0.105, 0.085, 0.19);
const HEAD_R = 0.068;
const TAIL_N = 10, TAIL_LEN = 0.032, TAIL_CURL = -0.2;

/**
 * A tabby cat loafing on a small cat-tree perch. Pet it by moving your hand (or desktop cursor)
 * over its back or head — no grip needed. Stroking builds contentment: it purrs (with a matching
 * controller rumble), squints, relaxes its tail and leans its head into your hand. Stroking
 * tail-to-head ruffles its fur and makes its ears flick. It watches nearby hands and meows
 * hello when you come over after a while away.
 * def: { position, rotationY?, perchHeight?, furColor?, stripeColor?, bellyColor?, eyeColor?, cushionColor? }
 */
export class Cat extends Entity {
  constructor(world, def) {
    super(world);
    this.def = def;
    this.object3D.position.set(...(def.position ?? [0, 0, 0]));
    if (def.rotationY != null) this.object3D.rotation.y = THREE.MathUtils.degToRad(def.rotationY);
    else {
      // face the player's start position
      const s = world.settings.player.start, p = this.object3D.position;
      this.object3D.rotation.y = Math.atan2(s[0] - p.x, s[2] - p.z);
    }

    this.contentment = 0;       // 0..1
    this._prev = new Map();     // hand -> previous cat-local position
    this._blinkAt = 2 + Math.random() * 4; this._blinkT = 1;
    this._twitchAt = 3 + Math.random() * 5; this._twitchT = 1; this._twitchEar = 0;
    this._lastMeow = -Infinity;
    this._handWasNear = false;
    this._yaw = 0; this._pitch = 0; this._roll = 0;
    this._lean = 0;

    this.buildPerch(def.perchHeight ?? 0.62);
    this.buildCat(def);
  }

  buildPerch(H) {
    const carpet = new THREE.MeshStandardMaterial({ color: 0xb9ad9a, roughness: 0.95 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); this.object3D.add(m); return m; };
    add(new THREE.BoxGeometry(0.4, 0.03, 0.4), carpet, 0, 0.015, 0);
    // sisal-wrapped post
    const rope = tint(new THREE.CylinderGeometry(0.055, 0.055, H - 0.065, 20, 40), (x, y, z, c) =>
      c.set(Math.sin(y * 420) > 0 ? '#c9a66b' : '#a8844c'));
    add(rope, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), 0, 0.03 + (H - 0.065) / 2, 0);
    add(new THREE.CylinderGeometry(0.22, 0.22, 0.035, 32), carpet, 0, H - 0.0175, 0);
    const cushion = new THREE.MeshStandardMaterial({ color: this.def.cushionColor ?? '#3f7f86', roughness: 0.9 });
    add(new THREE.TorusGeometry(0.16, 0.04, 12, 32).rotateX(Math.PI / 2), cushion, 0, H + 0.025, 0);
    add(new THREE.CylinderGeometry(0.165, 0.165, 0.025, 32), cushion, 0, H + 0.0125, 0);
    this.perchTop = H + 0.02;
  }

  buildCat(def) {
    const fur = new THREE.Color(def.furColor ?? '#e08a3c');
    const stripe = new THREE.Color(def.stripeColor ?? '#9a4f1c');
    const belly = new THREE.Color(def.bellyColor ?? '#f6e3c4');
    const furMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    const plainFur = new THREE.MeshStandardMaterial({ color: fur, roughness: 0.9 });
    const bellyMat = new THREE.MeshStandardMaterial({ color: belly, roughness: 0.9 });
    const pink = new THREE.MeshStandardMaterial({ color: 0xe89aa6, roughness: 0.7 });

    const cat = this.cat = new THREE.Group();
    cat.position.y = this.perchTop;
    this.object3D.add(cat);

    // --- body (loaf): tabby bands over the back, cream belly and chest
    const bodyGeo = new THREE.SphereGeometry(1, 36, 24).scale(BODY_R.x, BODY_R.y, BODY_R.z);
    tint(bodyGeo, (x, y, z, c) => {
      const nx = x / BODY_R.x, ny = y / BODY_R.y, nz = z / BODY_R.z;
      if (ny < -0.35 || (nz > 0.7 && ny < 0.35)) c.copy(belly);
      else if (ny > -0.25 && Math.sin(nz * 15 + nx * nx * 4) > 0.45) c.copy(stripe);
      else c.copy(fur);
    });
    this.body = new THREE.Mesh(bodyGeo, furMat);
    this.body.position.copy(BODY_C);
    cat.add(this.body);
    for (const sx of [-1, 1]) {                                     // haunches
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), plainFur);
      m.position.set(sx * 0.07, 0.06, -0.11); m.scale.set(1, 0.9, 1.3);
      cat.add(m);
      const paw = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), bellyMat);   // front paws
      paw.position.set(sx * 0.045, 0.016, 0.175); paw.scale.set(0.024, 0.017, 0.045);
      cat.add(paw);
    }

    // --- head on a neck pivot so it can look around / lean into a hand
    this.neck = new THREE.Group();
    this.neck.position.set(0, 0.13, 0.12);
    cat.add(this.neck);
    this.head = new THREE.Group();
    this.head.position.set(0, 0.035, 0.055);
    this.neck.add(this.head);
    const headGeo = new THREE.SphereGeometry(HEAD_R, 32, 24);
    tint(headGeo, (x, y, z, c) => {
      const nx = x / HEAD_R, ny = y / HEAD_R, nz = z / HEAD_R;
      if (nz > 0.5 && ny < -0.1) c.copy(belly);
      else if (ny > 0.4 && nz > -0.2 && Math.sin(nx * 24) > 0.55) c.copy(stripe);
      else c.copy(fur);
    });
    const skull = new THREE.Mesh(headGeo, furMat);
    skull.scale.set(1.05, 0.9, 0.95);
    this.head.add(skull);

    this.ears = [-1, 1].map((sx) => {
      const ear = new THREE.Group();
      ear.position.set(sx * 0.038, 0.045, -0.008);
      ear.rotation.z = -sx * 0.3;
      const outer = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.05, 12), plainFur);
      outer.position.y = 0.022; outer.scale.z = 0.55;
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.017, 0.036, 12), pink);
      inner.position.set(0, 0.018, 0.007); inner.scale.z = 0.35;
      ear.add(outer, inner);
      this.head.add(ear);
      return ear;
    });

    const eyeMat = new THREE.MeshStandardMaterial({ color: def.eyeColor ?? '#b8d43a', roughness: 0.2, emissive: def.eyeColor ?? '#b8d43a', emissiveIntensity: 0.15 });
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    this.eyes = [-1, 1].map((sx) => {
      const eye = new THREE.Group();
      eye.position.set(sx * 0.026, 0.01, 0.053);
      eye.rotation.y = sx * 0.35;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.0135, 16, 12), eyeMat);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), pupilMat);
      pupil.position.z = 0.011; pupil.scale.set(0.0035, 0.0105, 0.004);
      eye.add(ball, pupil);
      this.head.add(eye);
      return eye;
    });

    const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), pink);
    nose.position.set(0, -0.006, 0.066); nose.scale.set(0.009, 0.006, 0.006);
    this.head.add(nose);
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 10), bellyMat);
      m.position.set(sx * 0.013, -0.02, 0.054);
      this.head.add(m);
    }
    const wPts = [];
    for (const sx of [-1, 1]) for (const k of [-1, 0, 1]) {
      wPts.push(new THREE.Vector3(sx * 0.022, -0.018, 0.062), new THREE.Vector3(sx * 0.1, -0.012 + k * 0.014, 0.045 - Math.abs(k) * 0.006));
    }
    this.head.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wPts), new THREE.LineBasicMaterial({ color: 0xf5f5f5 })));

    // --- tail: a chain of joints curling round the side; each joint rotates to swish
    this.tail = [];
    let parent = cat;
    for (let i = 0; i < TAIL_N; i++) {
      const j = new THREE.Group();
      if (i === 0) { j.position.set(0.035, 0.028, -0.195); j.rotation.y = Math.PI - 0.5; }
      else j.position.z = TAIL_LEN;
      const r = 0.017 - i * 0.0006;
      const seg = new THREE.Mesh(new THREE.CapsuleGeometry(r, TAIL_LEN, 4, 10).rotateX(Math.PI / 2).translate(0, 0, TAIL_LEN / 2),
        new THREE.MeshStandardMaterial({ color: i >= TAIL_N - 2 || i % 3 === 1 ? stripe : fur, roughness: 0.9 }));
      j.add(seg);
      parent.add(j);
      this.tail.push(j);
      parent = j;
    }
  }

  onRemoved() { this._prev.clear(); }

  /** Signed-ish distance from a cat-local point to the cat's fur, and which part is closest. */
  _surface(lp) {
    _d.copy(lp).sub(BODY_C).divide(BODY_R);
    const body = (_d.length() - 1) * BODY_R.y;
    this.head.getWorldPosition(_h); this.cat.worldToLocal(_h);
    const head = lp.distanceTo(_h) - HEAD_R;
    return head < body ? { d: head, part: 'head' } : { d: body, part: 'body' };
  }

  update(dt) {
    const w = this.world, t = w.time;
    this.object3D.updateMatrixWorld(true);

    // --- petting: free hands moving along the fur
    let stroke = 0, touching = false, headTouch = false, ruffled = false, anyNear = false;
    let lookAt = null, lookD = 1.2, leanSide = 0;
    for (const hand of w.input?.hands ?? []) {
      if (hand.held || hand.heldControl || hand.airGrab) { this._prev.delete(hand); continue; }
      const lp = this.cat.worldToLocal(_p.copy(hand.position));
      const { d, part } = this._surface(lp);
      if (d < 0.35) anyNear = true;
      if (d < lookD) { lookD = d; lookAt = hand.position.clone(); }
      const prev = this._prev.get(hand);
      const onFur = d < 0.05 && d > -0.15;
      if (onFur && prev && dt > 0) {
        touching = true;
        const mv = _d.copy(lp).sub(prev);
        const speed = mv.length() / dt;
        if (speed > 0.06 && speed < 4) {
          let k = 1;
          if (part === 'body') {
            if (mv.z < -0.5 * mv.length()) k = 1.25;                       // head -> tail, with the grain
            else if (mv.z > 0.6 * mv.length() && speed > 0.15) { k = 0.4; ruffled = true; }
          } else { headTouch = true; leanSide = Math.sign(lp.x - _h.x); k = 1.4; }  // chin/cheek scritches
          stroke += Math.min(speed, 0.6) * k;
        } else if (part === 'head') { headTouch = true; leanSide = Math.sign(lp.x - _h.x); }
      }
      if (onFur || d < 0.15) this._prev.set(hand, (prev ?? new THREE.Vector3()).copy(lp));
      else this._prev.delete(hand);
      if (onFur && this.contentment > 0.12) hand.pulse?.(0.06 + this.contentment * 0.22, 30);   // feel the purr
    }

    if (stroke > 0) this.contentment = Math.min(1, this.contentment + stroke * dt * 1.6);
    else if (!touching) this.contentment = Math.max(0, this.contentment - dt * 0.05);
    if (ruffled && this._twitchT >= 1) { this._twitchT = 0; this._twitchEar = Math.random() < 0.5 ? 0 : 1; w.audio?.play('tick', 0.2); }

    // hello meow when someone comes over after a while
    if (anyNear && !this._handWasNear && this.contentment < 0.1 && t - this._lastMeow > 25) {
      this._lastMeow = t;
      w.audio?.play('meow', 0.8);
      this._twitchT = 0;
    }
    this._handWasNear = anyNear;

    if (this.contentment > 0.12) w.audio?.play('purr', 0.4 + this.contentment * 0.8);

    // --- head: watch the nearest hand, else the player; nuzzle into a hand on the head
    if (!lookAt) { const cam = w.camera.getWorldPosition(new THREE.Vector3()); if (cam.distanceTo(this.object3D.position) < 3) lookAt = cam; }
    let yaw = 0, pitch = 0;
    if (lookAt) {
      const v = this.neck.parent.worldToLocal(lookAt.clone()).sub(this.neck.position);
      yaw = THREE.MathUtils.clamp(Math.atan2(v.x, v.z), -0.8, 0.8);
      pitch = THREE.MathUtils.clamp(-Math.atan2(v.y, Math.hypot(v.x, v.z)), -0.5, 0.4);
    }
    if (headTouch) pitch = -0.2;
    const k = 1 - Math.exp(-(headTouch ? 3 : 4) * dt);
    this._yaw += (yaw - this._yaw) * k;
    this._pitch += (pitch - this._pitch) * k;
    this._roll += ((headTouch ? leanSide * 0.35 : 0) - this._roll) * (1 - Math.exp(-3 * dt));
    this.neck.rotation.set(this._pitch, this._yaw, this._roll, 'YXZ');

    // --- eyes: blink now and then, squint when content
    this._blinkT += dt / 0.18;
    if (t > this._blinkAt) { this._blinkT = 0; this._blinkAt = t + 2.5 + Math.random() * 5; }
    const blink = this._blinkT < 1 ? Math.abs(this._blinkT * 2 - 1) : 1;
    const open = Math.max(0.08, (1 - this.contentment * (headTouch ? 0.95 : 0.8)) * blink);
    for (const e of this.eyes) e.scale.y = open;

    // --- ears: random twitch
    this._twitchT += dt / 0.3;
    if (t > this._twitchAt) { this._twitchT = 0; this._twitchEar = Math.random() < 0.5 ? 0 : 1; this._twitchAt = t + 3 + Math.random() * 7; }
    this.ears.forEach((ear, i) => {
      const tw = i === this._twitchEar && this._twitchT < 1 ? Math.sin(this._twitchT * Math.PI) : 0;
      ear.rotation.x = -tw * 0.6;
      ear.rotation.y = (i ? 1 : -1) * tw * 0.4;
    });

    // --- body: breathing, and pushing up into a hand on the back
    this._lean += ((touching && !headTouch ? 1 : 0) - this._lean) * (1 - Math.exp(-4 * dt));
    const breath = Math.sin(t * (2.2 + this.contentment * 0.8)) * 0.015;
    this.body.scale.set(1 + breath * 0.6, 1 + breath + this._lean * 0.05, 1);

    // --- tail: lazy swish, slower and softer when content, flicks when ruffled
    const amp = THREE.MathUtils.lerp(0.22, 0.08, this.contentment) + (this._twitchT < 1 && ruffled ? 0.3 : 0);
    const freq = THREE.MathUtils.lerp(1.3, 0.6, this.contentment);
    this.tail.forEach((j, i) => {
      if (i === 0) return;
      j.rotation.y = TAIL_CURL + amp * Math.sin(t * freq - i * 0.55) * (i / TAIL_N);
      j.rotation.x = i > TAIL_N - 4 ? -0.15 - 0.1 * Math.sin(t * freq * 0.7) : 0;
    });
  }
}
