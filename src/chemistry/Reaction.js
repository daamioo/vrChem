/** One reaction loaded from config/reactions.json. Pure data + queries; the engine applies it. */
export class Reaction {
  constructor(id, def) {
    this.id = id;
    this.name = def.name ?? id;
    this.hint = def.hint ?? '';
    this.message = def.message ?? '';
    this.reactants = Object.entries(def.reactants ?? {}).map(([id, coeff]) => ({ id, coeff }));
    this.products = Object.entries(def.products ?? {}).filter(([, c]) => c > 0).map(([id, coeff]) => ({ id, coeff }));
    this.catalysts = Object.entries(def.catalysts ?? {}).map(([id, minGrams]) => ({ id, minGrams }));
    this.speed = def.speed ?? 1;                    // first-order rate constant (1/s)
    this.enthalpy = def.enthalpy ?? 0;              // kJ per mole of reaction; negative = exothermic
    this.conditions = {
      minTemp: -Infinity, maxTemp: Infinity, stirred: false, requiresLiquid: false,
      ...(def.conditions ?? {}),
    };
    this.effects = def.effects ?? [];
    this.disabled = !!def.disabled;
  }

  /** Human readable equation, e.g. "NaOH + HCl -> NaCl + H2O". */
  equation(db) {
    const sub = (f) => f.replace(/\d/g, (d) => '\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089'[d]);
    const name = (id) => sub(db.has(id) ? db.get(id).formula : id);
    const side = (list) => list.map(({ id, coeff }) => `${coeff !== 1 ? coeff + ' ' : ''}${name(id)}`).join(' + ');
    const cat = this.catalysts.length ? ` [${this.catalysts.map((c) => name(c.id)).join(', ')}]` : '';
    return `${side(this.reactants)} \u2192${cat} ${side(this.products)}`;
  }

  conditionsMet(mixture, minGrams = 0.005) {
    for (const r of this.reactants) if (mixture.amount(r.id) < minGrams) return false;
    for (const c of this.catalysts) if (mixture.amount(c.id) < c.minGrams) return false;
    const k = this.conditions;
    if (mixture.temperature < k.minTemp || mixture.temperature > k.maxTemp) return false;
    if (k.stirred && mixture.stir < 0.3) return false;
    if (k.requiresLiquid && mixture.liquidVolume <= 0.05) return false;
    return true;
  }

  /** Extent of reaction (mol) the current contents could still deliver; limited by the scarcest reactant. */
  availableExtent(mixture, db) {
    let ext = Infinity;
    for (const r of this.reactants) ext = Math.min(ext, db.get(r.id).moles(mixture.amount(r.id)) / r.coeff);
    return ext;
  }

  /** Mass imbalance in grams per mole of reaction (should be ~0 for a balanced config). */
  massImbalance(db) {
    const m = (l) => l.reduce((s, { id, coeff }) => s + coeff * db.get(id).molarMass, 0);
    return m(this.products) - m(this.reactants);
  }
}

export class ReactionDatabase {
  constructor(defs = {}) {
    this.reactions = Object.entries(defs).map(([id, d]) => new Reaction(id, d)).filter((r) => !r.disabled);
    this._byReactant = new Map();
    for (const r of this.reactions) {
      for (const { id } of r.reactants) {
        if (!this._byReactant.has(id)) this._byReactant.set(id, new Set());
        this._byReactant.get(id).add(r);
      }
    }
  }

  get(id) { return this.reactions.find((r) => r.id === id); }
  all() { return this.reactions; }

  /** Reactions that could possibly run given the substances present (cheap pre-filter). */
  candidates(mixture) {
    const out = new Set();
    for (const id of mixture.grams.keys()) for (const r of this._byReactant.get(id) ?? []) out.add(r);
    return out;
  }
}
