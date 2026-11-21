/** Parses "#rrggbb" into 0..1 components (no THREE dependency, so chemistry runs in Node). */
export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/**
 * The physical contents of a container: grams per chemical plus temperature and stir state.
 * Solids dissolve into the liquid up to their solubility; the rest is "sediment".
 * All derived values (volumes, colours) are cached until the contents change.
 */
export class Mixture {
  constructor(db, ambientC = 22) {
    this.db = db;
    this.grams = new Map();
    this.temperature = ambientC;
    this.stir = 0;                 // 0..1, decays over time, raised by stirring
    this._cache = null;
  }

  get isEmpty() { return this.totalMass < 1e-4; }
  get totalMass() { let m = 0; for (const g of this.grams.values()) m += g; return m; }
  amount(id) { return this.grams.get(id) ?? 0; }
  ids() { return [...this.grams.keys()]; }

  _touch() { this._cache = null; }

  /** Adds mass; temperature becomes the mass-weighted average (equal heat capacities assumed). */
  add(id, g, temperatureC = this.temperature) {
    if (g <= 0) return;
    const m0 = this.totalMass;
    this.grams.set(id, this.amount(id) + g);
    this.temperature = (this.temperature * m0 + temperatureC * g) / (m0 + g);
    this._touch();
  }

  addAll(map, temperatureC) {
    const incoming = [...map.values()].reduce((a, b) => a + b, 0);
    if (incoming <= 0) return;
    const m0 = this.totalMass;
    for (const [id, g] of map) this.grams.set(id, this.amount(id) + g);
    this.temperature = (this.temperature * m0 + temperatureC * incoming) / (m0 + incoming);
    this._touch();
  }

  /** Removes up to `g` grams of one chemical and returns what was actually removed. */
  remove(id, g) {
    const have = this.amount(id);
    const taken = Math.min(have, g);
    if (taken <= 0) return 0;
    if (have - taken < 1e-6) this.grams.delete(id); else this.grams.set(id, have - taken);
    this._touch();
    return taken;
  }

  clear() { this.grams.clear(); this.stir = 0; this._touch(); }

  /** Derived, cached description of liquid/dissolved/sediment layers. */
  get layers() {
    if (this._cache) return this._cache;
    let liquidVol = 0;
    for (const [id, g] of this.grams) {
      const c = this.db.get(id);
      if (c.isLiquid) liquidVol += g / c.density;
    }
    const dissolved = new Map();
    const sediment = new Map();
    let sedimentVol = 0;
    for (const [id, g] of this.grams) {
      const c = this.db.get(id);
      if (!c.isSolid) continue;
      const cap = (c.solubility * liquidVol) / 100;
      const d = Math.min(g, cap);
      if (d > 0) dissolved.set(id, d);
      if (g - d > 1e-6) { sediment.set(id, g - d); sedimentVol += (g - d) / c.density; }
    }
    this._cache = {
      liquidVolume: liquidVol, sedimentVolume: sedimentVol, dissolved, sediment,
      totalVolume: liquidVol + sedimentVol,
      liquidColor: this._blendLiquid(dissolved),
      sedimentColor: this._blendSolids(sediment),
    };
    return this._cache;
  }

  get liquidVolume() { return this.layers.liquidVolume; }
  get sedimentVolume() { return this.layers.sedimentVolume; }
  get totalVolume() { return this.layers.totalVolume; }

  _blendLiquid(dissolved) {
    let w = 0, r = 0, g = 0, b = 0, a = 0;
    const accum = (hex, alpha, weight) => {
      const c = hexToRgb(hex);
      r += c.r * weight; g += c.g * weight; b += c.b * weight; a += alpha * weight; w += weight;
    };
    for (const [id, grams] of this.grams) {
      const c = this.db.get(id);
      if (c.isLiquid) accum(c.color, c.alpha, Math.max(0.0001, (grams / c.density) * Math.max(c.tintPower, 0.02)));
    }
    for (const [id, grams] of dissolved) {
      const c = this.db.get(id);
      accum(c.color, c.alpha, grams * c.tintPower);
    }
    if (w === 0) return { r: 0.7, g: 0.85, b: 1, a: 0.3 };
    return { r: r / w, g: g / w, b: b / w, a: Math.min(0.92, a / w) };
  }

  _blendSolids(sediment) {
    let w = 0, r = 0, g = 0, b = 0;
    for (const [id, grams] of sediment) {
      const c = this.db.get(id); const col = hexToRgb(c.color);
      r += col.r * grams; g += col.g * grams; b += col.b * grams; w += grams;
    }
    return w ? { r: r / w, g: g / w, b: b / w, a: 1 } : { r: 1, g: 1, b: 1, a: 1 };
  }

  /** Pours out `volumeMl` of liquid (including what is dissolved in it). Returns Map(id->g). */
  takeLiquid(volumeMl) {
    const { liquidVolume, dissolved } = this.layers;
    const out = new Map();
    if (liquidVolume <= 0 || volumeMl <= 0) return out;
    const f = Math.min(1, volumeMl / liquidVolume);
    for (const [id, g] of [...this.grams]) {
      const c = this.db.get(id);
      const part = c.isLiquid ? g * f : c.isSolid ? (dissolved.get(id) ?? 0) * f : 0;
      if (part > 0) out.set(id, this.remove(id, part));
    }
    return out;
  }

  /** Pours out `g` grams of undissolved solids, proportionally. Returns Map(id->g). */
  takeSediment(g) {
    const { sediment } = this.layers;
    const total = [...sediment.values()].reduce((a, b) => a + b, 0);
    const out = new Map();
    if (total <= 0 || g <= 0) return out;
    const f = Math.min(1, g / total);
    for (const [id, part] of [...sediment]) out.set(id, this.remove(id, part * f));
    return out;
  }

  /** Removes a fraction of everything (used for spills / explosions). */
  takeFraction(f) {
    const out = new Map();
    for (const [id, g] of [...this.grams]) out.set(id, this.remove(id, g * f));
    return out;
  }
}
