import * as THREE from 'three';

const HEAD_R = 0.1;          // head radius: the fade starts when this sphere touches a wall / bench
const FULL_AT = 0.13;        // penetration (m) at which the view is fully dark
const MAX_LAG = 0.6;         // head this far from its last free spot: start over from the nearest point inside
const DIRS = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]].map((d) => new THREE.Vector3(...d));
const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _out = new THREE.Vector3(), _iq = new THREE.Quaternion();

/**
 * Putting your head into a wall or a bench darkens the view, with an orange glow around the
 * edges that is brightest towards the way out. It fades in and out smoothly with how deep you are
 * (never flashes). Leaning out of an open window is fine. Lives on the camera, so it works in VR
 * (both eyes) and in the desktop test mode.
 */
export class HeadInsideFade {
  constructor(world, camera) {
    this.world = world;
    this.camera = camera;
    this.amount = 0;
    this.out = new THREE.Vector3(0, 0, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uAmount: { value: 0 }, uOut: { value: new THREE.Vector3(0, 0, 1) } },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform float uAmount; uniform vec3 uOut;
        varying vec3 vDir;
        // Everything is placed inside what a headset actually shows (~45 degrees from the centre).
        // uOut is the way out in camera space (-z = straight ahead, +z = behind you).
        void main() {
          vec3 d = normalize(vDir);
          float ang = acos(clamp(-d.z, -1.0, 1.0));                  // 0 at the centre of the view
          float sl = length(d.xy);
          vec2 p2 = d.xy / max(sl, 1e-4);                            // direction on the screen
          float side = length(uOut.xy);                              // how much the way out is to a side
          vec2 o2 = uOut.xy / max(side, 1e-4);
          float facing = dot(p2, o2);

          // orange rim inside the visible field: bright on the side that leads out; when the way
          // out is straight behind you, all the way round (= back up)
          float rim = smoothstep(0.22, 0.62, ang);
          float behind = smoothstep(0.1, 0.7, uOut.z) * (1.0 - smoothstep(0.2, 0.7, side));
          float lead = pow(max(0.0, facing), 2.0) * smoothstep(0.1, 0.5, side);
          float band = rim * clamp(0.22 + 1.2 * lead + 0.6 * behind, 0.0, 0.9);

          // chevrons pointing to the side that leads out
          float u = dot(d.xy, o2), v = dot(d.xy, vec2(-o2.y, o2.x));
          float chev = 0.0;
          if (u > 0.12 && u < 0.42 && abs(v) < 0.11) {
            float k = fract((u + abs(v) * 0.9) * 9.0);       // tips point outwards
            chev = smoothstep(0.0, 0.08, k) * (1.0 - smoothstep(0.38, 0.48, k)) * (1.0 - smoothstep(0.08, 0.11, abs(v)));
          }
          chev *= smoothstep(0.15, 0.45, side);

          // way out in front of you: a glowing patch there
          float ahead = pow(max(0.0, dot(d, uOut)), 6.0);

          float show = clamp(uAmount * 2.5, 0.0, 1.0);
          float glow = clamp(band + chev + ahead, 0.0, 1.0) * show;
          float darkA = smoothstep(0.1, 0.85, uAmount);
          vec3 col = mix(vec3(0.012, 0.008, 0.006), vec3(1.0, 0.5, 0.08), glow);
          col = mix(col, vec3(1.0, 0.88, 0.6), chev * show);                 // pale chevrons stand out on the orange
          gl_FragColor = vec4(col, max(darkA, glow));
        }`,
      transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.06, 24, 16), this.material);   // just past the near plane
    this.mesh.renderOrder = 1000;
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
    this.mesh.visible = false;
    camera.add(this.mesh);
  }

  /** How far the head sphere at `p` is into a bench/cabinet solid, and the way out (into `out`). */
  _solidDepth(p, out) {
    let best = 0;
    for (const s of this.world.physics.surfaces) {
      if (!s.solid || p.y - HEAD_R > s.top) continue;
      if (s.isInside(p.x, p.y, p.z)) {
        // eye inside: march out to find the nearest free direction
        let tMin = 0.6, dMin = DIRS[0];
        for (const d of DIRS) {
          for (let t = 0.01; t < tMin; t += 0.01) {
            _q.copy(p).addScaledVector(d, t);
            if (!s.isInside(_q.x, _q.y, _q.z)) { tMin = t; dMin = d; break; }
          }
        }
        if (HEAD_R + tMin > best) { best = HEAD_R + tMin; out.copy(dMin); }
      } else {
        // eye outside: how far the head sphere reaches into it
        for (const d of DIRS) {
          for (let t = 0.01; t <= HEAD_R; t += 0.01) {
            _q.copy(p).addScaledVector(d, t);
            if (s.isInside(_q.x, _q.y, _q.z)) { if (HEAD_R - t > best) { best = HEAD_R - t; out.copy(d).negate(); } break; }
          }
        }
      }
    }
    return best;
  }

  update(dt) {
    const rb = this.world.roomBounds;
    this.camera.updateMatrixWorld(true);
    const head = this.camera.getWorldPosition(_p);
    let depth = 0;
    if (rb) {
      // walls: sweep a head-sized sphere like the hands, so leaning out of an open window is allowed
      const free = this._free ? rb.constrain(this._free, head, HEAD_R, _q) : rb.clampInside(head, HEAD_R, _q);
      if (free.distanceTo(head) > MAX_LAG) rb.clampInside(head, HEAD_R, free);
      (this._free ??= new THREE.Vector3()).copy(free);
      depth = free.distanceTo(head);
      if (depth > 1e-4) _out.copy(free).sub(head).normalize();
    }
    const sd = this._solidDepth(head, this._sOut ??= new THREE.Vector3());
    if (sd > depth) { depth = sd; _out.copy(this._sOut); }

    const target = THREE.MathUtils.clamp(depth / FULL_AT, 0, 1);
    this.amount += (target - this.amount) * (1 - Math.exp(-(target > this.amount ? 14 : 7) * dt));
    if (this.amount < 0.003) this.amount = 0;
    this.mesh.visible = this.amount > 0;
    if (depth > 1e-4) {
      // the way out, in the camera's own space (the sphere is a child of the camera)
      this.camera.getWorldQuaternion(_iq).invert();
      this.out.lerp(_out.applyQuaternion(_iq), 1 - Math.exp(-10 * dt)).normalize();
    }
    this.material.uniforms.uAmount.value = this.amount;
    this.material.uniforms.uOut.value.copy(this.out);
  }
}
