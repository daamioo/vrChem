/** Immutable description of a substance, built from config/chemicals.json. */
export class Chemical {
  constructor(id, def) {
    this.id = id;
    this.name = def.name ?? id;
    this.formula = def.formula ?? '';
    this.molarMass = def.molarMass;
    this.state = def.state ?? 'solid';          // 'solid' | 'liquid' | 'gas'
    this.density = def.density ?? 1;            // g/mL
    this.color = def.color ?? '#ffffff';
    this.alpha = def.alpha ?? (this.state === 'liquid' ? 0.4 : 1);
    this.solubility = def.solubility ?? 0;      // g per 100 mL of liquid
    this.tintPower = def.tintPower ?? (this.state === 'liquid' ? 0.2 : 0.5);
    this.boilingPoint = def.boilingPoint ?? 100;
    this.hazard = def.hazard ?? null;
    this.combustion = def.combustion ?? null;   // gases: 'fuel' | 'oxidizer' | 'smothers' (what a flame does in it)
  }

  get isSolid() { return this.state === 'solid'; }
  get isLiquid() { return this.state === 'liquid'; }
  get isGas() { return this.state === 'gas'; }

  moles(grams) { return grams / this.molarMass; }
  grams(moles) { return moles * this.molarMass; }
}

export class ChemicalDatabase {
  constructor(defs = {}) {
    this._byId = new Map(Object.entries(defs).map(([id, d]) => [id, new Chemical(id, d)]));
  }
  has(id) { return this._byId.has(id); }
  get(id) {
    const c = this._byId.get(id);
    if (!c) throw new Error(`Unknown chemical "${id}"`);
    return c;
  }
  all() { return [...this._byId.values()]; }
}
