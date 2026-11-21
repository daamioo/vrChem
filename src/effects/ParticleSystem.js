import * as THREE from 'three';

const VERT = `
attribute vec4 aColor; attribute float aSize;
uniform float uScale; varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, aSize * uScale / max(0.05, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.35, d) * vColor.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}`;

/** A fixed-size pool of billboard points with CPU simulation (gravity, drag, growth, fade). */
export class ParticleSystem {
  constructor(scene, { capacity = 800, additive = false, gravity = 0, drag = 0.5 } = {}) {
    this.capacity = capacity; this.gravity = gravity; this.drag = drag;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    this.age = new Float32Array(capacity).fill(1e9);
    this.life = new Float32Array(capacity).fill(1);
    this.growth = new Float32Array(capacity);
    this.baseAlpha = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.next = 0;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 900 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    this.points.frustumCulled = false;
    this.points.raycast = () => {};
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  /** Spawns one particle. color = [r,g,b,a] (sRGB-ish 0..1). */
  emit(p, v, color, size, life, growth = 0) {
    const i = this.next; this.next = (this.next + 1) % this.capacity;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set(color, i * 4);
    this.baseAlpha[i] = color[3];
    this.baseSize[i] = size; this.size[i] = size;
    this.age[i] = 0; this.life[i] = life; this.growth[i] = growth;
  }

  /** Spawns `count` particles around `origin` with random direction. */
  emitBurst(origin, count, { color = [1, 1, 1, 0.6], speed = 0.3, size = 0.01, life = 1, up = 0, spread = 0.02, growth = 0 } = {}) {
    const v = new THREE.Vector3(), p = new THREE.Vector3();
    for (let n = 0; n < count; n++) {
      p.set(origin.x + (Math.random() - 0.5) * spread, origin.y, origin.z + (Math.random() - 0.5) * spread);
      v.set((Math.random() - 0.5) * speed, up * (0.5 + Math.random()) , (Math.random() - 0.5) * speed);
      this.emit(p, v, color, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.8), growth);
    }
  }

  /** Emits a fractional number of particles per call (use with rate*dt). */
  emitRate(count, fn) {
    let n = Math.floor(count);
    if (Math.random() < count - n) n++;
    for (let i = 0; i < n; i++) fn(i);
  }

  update(dt) {
    for (let i = 0; i < this.capacity; i++) {
      if (this.age[i] >= this.life[i]) { this.size[i] = 0; continue; }
      this.age[i] += dt;
      const k = Math.exp(-this.drag * dt), i3 = i * 3;
      this.vel[i3] *= k; this.vel[i3 + 2] *= k; this.vel[i3 + 1] = this.vel[i3 + 1] * k - this.gravity * dt;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = this.age[i] / this.life[i];
      this.col[i * 4 + 3] = this.baseAlpha[i] * Math.min(1, t * 8) * (1 - t);
      this.size[i] = this.baseSize[i] * (1 + this.growth[i] * t);
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.aColor.needsUpdate = a.aSize.needsUpdate = true;
  }
}

/** The named particle systems used by effects. */
export class ParticleHub {
  constructor(scene) {
    this.bubbles = new ParticleSystem(scene, { capacity: 700, gravity: -0.05, drag: 1.5 });
    this.puffs = new ParticleSystem(scene, { capacity: 1400, gravity: -0.03, drag: 0.8 });       // foam & smoke
    this.foam = new ParticleSystem(scene, { capacity: 1600, gravity: 1.2, drag: 1.2 });
    this.droplets = new ParticleSystem(scene, { capacity: 500, gravity: 5, drag: 0.2 });
    this.sparks = new ParticleSystem(scene, { capacity: 500, gravity: 3, drag: 0.4, additive: true });
    this.all = [this.bubbles, this.puffs, this.foam, this.droplets, this.sparks];
  }
  /** Keeps point size consistent with the camera's field of view / viewport. */
  setScale(pixelsPerMetre) { for (const s of this.all) s.uniforms.uScale.value = pixelsPerMetre; }
  update(dt) { for (const s of this.all) s.update(dt); }
}
