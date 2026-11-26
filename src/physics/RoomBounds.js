import * as THREE from 'three';

const _a = new THREE.Vector3();
const clamp = THREE.MathUtils.clamp;

/**
 * The room's walls (and ceiling / floor) as solid limits for hands and held objects, so they stop
 * at the wall instead of passing through it. Openings (openable windows) let them through while
 * they are open: `{ wall: 'right', a0, a1, v0, v1, isOpen() }`, where a0..a1 runs along the wall in
 * world coordinates (z for left/right walls, x for back/front) and v0..v1 is the height range.
 */
export class RoomBounds {
  constructor({ width, depth, height }, openings = []) {
    this.h = height;
    // k: axis across the wall, m: the other horizontal axis, s: which side, L: distance from the centre
    this.walls = [
      { name: 'back', k: 'z', m: 'x', s: -1, L: depth / 2 },
      { name: 'front', k: 'z', m: 'x', s: 1, L: depth / 2 },
      { name: 'left', k: 'x', m: 'z', s: -1, L: width / 2 },
      { name: 'right', k: 'x', m: 'z', s: 1, L: width / 2 },
    ];
    for (const w of this.walls) w.openings = openings.filter((o) => o.wall === w.name);
    this.halfX = width / 2; this.halfZ = depth / 2;
  }

  /** Inside the room's footprint (not out through a window). */
  isInside(p) { return Math.abs(p.x) <= this.halfX && Math.abs(p.z) <= this.halfZ; }

  /** The nearest point at least `r` inside the room. */
  clampInside(p, r, out = new THREE.Vector3()) {
    return out.set(
      clamp(p.x, -this.halfX + r, this.halfX - r),
      clamp(p.y, r, this.h - r),
      clamp(p.z, -this.halfZ + r, this.halfZ - r),
    );
  }

  /** Is there an open window where a sphere of radius r at p fits through the wall? */
  _passable(w, p, r) {
    return w.openings.some((o) => o.isOpen() && p[w.m] >= o.a0 + r && p[w.m] <= o.a1 - r && p.y >= o.v0 + r && p.y <= o.v1 - r);
  }

  /**
   * Moves a sphere of radius `r` from `prev` (where it was allowed to be) towards `target` and
   * returns in `out` where it ends up: against the wall it would have gone through, or still on
   * its way through an open window.
   */
  constrain(prev, target, r, out) {
    out.copy(target);
    for (const w of this.walls) {
      const { k, m, s, L } = w, inner = L - r, outer = L + r;
      const pk = s * prev[k], tk = s * out[k];
      if (pk <= inner + 1e-6) {                        // was inside the room
        if (tk > inner) {
          _a.lerpVectors(prev, out, (inner - pk) / (tk - pk));
          if (!this._passable(w, _a, r)) out[k] = s * inner;
        }
      } else if (pk >= outer - 1e-6) {                 // was outside (reached out through a window)
        if (tk < outer) {
          _a.lerpVectors(prev, out, (pk - outer) / (pk - tk));
          if (!this._passable(w, _a, r)) out[k] = s * outer;
        }
      } else {                                         // in the window opening itself: stay in its frame
        const o = w.openings.find((o) => o.isOpen() && prev[m] >= o.a0 && prev[m] <= o.a1 && prev.y >= o.v0 && prev.y <= o.v1);
        if (!o) out[k] = s * inner;
        else if (s * out[k] > inner && s * out[k] < outer) {
          out[m] = clamp(out[m], o.a0 + r, o.a1 - r);
          out.y = clamp(out.y, o.v0 + r, o.v1 - r);
        }
      }
    }
    if (this.isInside(out)) out.y = clamp(out.y, r, this.h - r);
    return out;
  }

  /**
   * How far a world-space box (a held object) must move to stay inside the walls and under the
   * ceiling. `ref` (the hand holding it) says which side of each wall it belongs on: a hand out
   * through a window is not pulled back in. The floor is left to the bench/floor Surfaces.
   */
  pushBox(box, ref, shift) {
    shift.set(0, 0, 0);
    for (const w of this.walls) {
      const { k, m, s, L } = w;
      if (s * ref[k] > L) continue;
      const far = s > 0 ? box.max[k] : -box.min[k];
      if (far <= L) continue;
      if (w.openings.some((o) => o.isOpen() && box.min[m] >= o.a0 && box.max[m] <= o.a1 && box.min.y >= o.v0 && box.max.y <= o.v1)) continue;
      shift[k] -= s * (far - L);
    }
    if (this.isInside(ref) && box.max.y > this.h) shift.y = this.h - box.max.y;
    return shift;
  }
}
