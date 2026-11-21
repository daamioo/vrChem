import * as THREE from 'three';

/**
 * Describes a vessel by its inner radius profile [[r, y], ...] from bottom to rim (metres).
 * Gives volume<->height conversion (so flasks fill correctly) and builds lathe geometry.
 */
export class GlassProfile {
  constructor(points, wall = 0.003) {
    this.points = points;
    this.wall = wall;
    this.height = points[points.length - 1][1];
    this.openingRadius = points[points.length - 1][0];
    this.maxRadius = Math.max(...points.map((p) => p[0]));
    this._buildTable();
  }

  radiusAt(y) {
    const pts = this.points;
    if (y <= pts[0][1]) return pts[0][0];
    for (let i = 1; i < pts.length; i++) {
      const [r0, y0] = pts[i - 1], [r1, y1] = pts[i];
      if (y <= y1 && y1 > y0) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
    }
    return pts[pts.length - 1][0];
  }

  _buildTable(steps = 96) {
    this._heights = []; this._volumes = [];
    let vol = 0;
    for (let i = 0; i <= steps; i++) {
      const y = (this.height * i) / steps;
      if (i > 0) {
        const yPrev = (this.height * (i - 1)) / steps;
        const r = (this.radiusAt(y) + this.radiusAt(yPrev)) / 2;
        vol += Math.PI * r * r * (y - yPrev) * 1e6;   // m^3 -> mL
      }
      this._heights.push(y); this._volumes.push(vol);
    }
    this.capacityMl = vol;
  }

  /** Height (m) at which the liquid surface sits for a given volume. */
  heightForVolume(ml) {
    if (ml <= 0) return 0;
    if (ml >= this.capacityMl) return this.height;
    const v = this._volumes;
    let lo = 0, hi = v.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (v[mid] < ml) lo = mid; else hi = mid; }
    const t = (ml - v[lo]) / Math.max(1e-9, v[hi] - v[lo]);
    return this._heights[lo] + t * (this._heights[hi] - this._heights[lo]);
  }

  /** Lathe of the interior (for liquid / powder). `shrink` keeps it just inside the glass. */
  innerGeometry(shrink = 0.96, segments = 28) {
    return new THREE.LatheGeometry(this.points.map(([r, y]) => new THREE.Vector2(r * shrink, y)), segments);
  }

  /** Lathe of the outer glass surface (inner profile pushed out by the wall thickness). */
  outerGeometry(segments = 28) {
    const w = this.wall;
    const pts = [new THREE.Vector2(0, -w), ...this.points.map(([r, y]) => new THREE.Vector2(r + w, Math.max(y, 0)))];
    pts[1].y = -w * 0.2;
    return new THREE.LatheGeometry(pts, segments);
  }
}
