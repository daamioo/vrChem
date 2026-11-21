/**
 * Advances chemistry for one Mixture. Knows nothing about rendering: it mutates the mixture
 * and returns plain event objects that the rest of the game (effects, notebook, audio) reacts to.
 */
export class ReactionEngine {
  /**
   * @param {ChemicalDatabase} chemicals
   * @param {ReactionDatabase} reactions
   * @param {object} settings  config/settings.json
   */
  constructor(chemicals, reactions, settings = {}) {
    this.chemicals = chemicals;
    this.reactions = reactions;
    this.ambient = settings.ambientTemperatureC ?? 22;
    this.heatCapacity = settings.thermal?.heatCapacityJPerGK ?? 4.18;
    this.maxStepRise = 60;               // cap on temperature change per step (stability)
    this.minExtent = 1e-7;               // mol; below this a reaction is treated as finished
    this.floorRate = 0.01;               // mol/s; guarantees reactions actually finish
  }

  /**
   * @returns {Array<{reaction, extent, rate, gas: Map<string,number>, heat: number}>}
   */
  step(mixture, dt) {
    const events = [];
    if (mixture.grams.size < 2 && !this._hasSelfReactant(mixture)) return events;

    for (const reaction of this.reactions.candidates(mixture)) {
      if (!reaction.conditionsMet(mixture)) continue;
      const available = reaction.availableExtent(mixture, this.chemicals);
      if (available < this.minExtent) continue;

      const tempFactor = Math.min(8, Math.max(0.25, 2 ** ((mixture.temperature - this.ambient) / 10)));
      const k = reaction.speed * tempFactor;
      let extent = available * (1 - Math.exp(-k * dt));
      extent = Math.max(extent, Math.min(available, this.floorRate * dt));
      extent = Math.min(extent, available);

      events.push(this._apply(mixture, reaction, extent, dt));
    }
    return events;
  }

  _hasSelfReactant(mixture) {
    return mixture.grams.size === 1 && this.reactions.candidates(mixture).size > 0;
  }

  _apply(mixture, reaction, extent, dt) {
    const db = this.chemicals;
    for (const r of reaction.reactants) mixture.remove(r.id, db.get(r.id).grams(r.coeff * extent));

    const gas = new Map();
    const products = new Map();
    for (const p of reaction.products) {
      const grams = db.get(p.id).grams(p.coeff * extent);
      if (db.get(p.id).isGas) gas.set(p.id, grams);
      else products.set(p.id, grams);
    }
    const massBefore = mixture.totalMass;
    for (const [id, g] of products) mixture.add(id, g);

    // Heat released goes into the remaining mass (J = kJ*1000; dT = J / (m * cp)).
    const heatJ = -reaction.enthalpy * 1000 * extent;
    const m = Math.max(5, mixture.totalMass || massBefore);
    const dT = Math.max(-this.maxStepRise, Math.min(this.maxStepRise, heatJ / (m * this.heatCapacity)));
    mixture.temperature += dT;
    mixture._touch();

    return { reaction, extent, rate: extent / Math.max(dt, 1e-6), gas, heat: heatJ, dt };
  }
}
