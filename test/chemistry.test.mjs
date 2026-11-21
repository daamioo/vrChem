import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './loadConfig.mjs';
import { ChemicalDatabase } from '../src/chemistry/Chemical.js';
import { ReactionDatabase } from '../src/chemistry/Reaction.js';
import { ReactionEngine } from '../src/chemistry/ReactionEngine.js';
import { Mixture } from '../src/chemistry/Mixture.js';
import { ConfigValidator } from '../src/chemistry/ConfigValidator.js';

const cfg = await loadConfig();
const chem = new ChemicalDatabase(cfg.chemicals);
const reactions = new ReactionDatabase(cfg.reactions);
const engine = new ReactionEngine(chem, reactions, cfg.settings);

const run = (m, seconds = 30, dt = 1 / 60) => {
  const all = [];
  for (let t = 0; t < seconds; t += dt) all.push(...engine.step(m, dt));
  return all;
};

test('config validates with no errors or mass imbalance', () => {
  const { errors, warnings } = ConfigValidator.validate(cfg);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test('every reaction is mass balanced', () => {
  for (const r of reactions.all()) assert.ok(Math.abs(r.massImbalance(chem)) < 0.5, r.id);
});

test('baking soda + vinegar releases CO2 and conserves mass', () => {
  const m = new Mixture(chem);
  m.add('baking_soda', 8.4); m.add('acetic_acid', 50);
  const before = m.totalMass;
  const events = run(m, 20);
  const gas = events.reduce((s, e) => s + (e.gas.get('carbon_dioxide') ?? 0), 0);
  assert.ok(gas > 0.3, `gas ${gas}`);
  assert.ok(Math.abs(before - (m.totalMass + gas)) < 1e-6);
  assert.ok(m.amount('baking_soda') < 1e-3);
});

test('no reaction without a liquid', () => {
  const m = new Mixture(chem);
  m.add('baking_soda', 5); m.add('citric_acid', 5);
  assert.equal(run(m, 5).length, 0);
});

test('neutralisation heats the mixture', () => {
  const m = new Mixture(chem);
  m.add('sodium_hydroxide', 10); m.add('hydrochloric_acid', 20); m.add('water', 20);
  run(m, 20);
  assert.ok(m.temperature > 30, `T=${m.temperature}`);
});

test('catalyst is required and not consumed', () => {
  const m = new Mixture(chem);
  m.add('hydrogen_peroxide', 30);
  assert.equal(run(m, 3).length, 0);
  m.add('potassium_iodide', 2);
  const ev = run(m, 20);
  assert.ok(ev.length > 0);
  assert.ok(Math.abs(m.amount('potassium_iodide') - 2) < 1e-9);
});

test('golden rain precipitates lead iodide as sediment', () => {
  const m = new Mixture(chem);
  m.add('lead_nitrate', 3.3); m.add('potassium_iodide', 3.3); m.add('water', 100);
  run(m, 20);
  assert.ok(m.layers.sediment.get('lead_iodide') > 1);
});

test('indicator turns pink in base then fades in acid', () => {
  const m = new Mixture(chem);
  m.add('water', 50); m.add('sodium_hydroxide', 1); m.add('phenolphthalein', 0.1);
  run(m, 10);
  assert.ok(m.amount('phenolphthalein_pink') > 0.05);
  m.add('hydrochloric_acid', 5);
  run(m, 10);
  assert.ok(m.amount('phenolphthalein_pink') < 0.01);
});

test('dissolving: salt dissolves in water up to solubility', () => {
  const m = new Mixture(chem);
  m.add('water', 100); m.add('sodium_chloride', 50);
  assert.ok(Math.abs(m.layers.dissolved.get('sodium_chloride') - 36) < 1e-9);
  assert.ok(Math.abs(m.layers.sediment.get('sodium_chloride') - 14) < 1e-9);
});

test('pouring liquid takes dissolved solids along and keeps sediment', () => {
  const m = new Mixture(chem);
  m.add('water', 100); m.add('sodium_chloride', 50);
  const out = m.takeLiquid(50);
  assert.ok(Math.abs(out.get('water') - 50) < 1e-9);
  assert.ok(Math.abs(out.get('sodium_chloride') - 18) < 1e-9);
  assert.ok(Math.abs(m.layers.sediment.get('sodium_chloride') - 14) < 1e-6 || m.amount('sodium_chloride') > 18);
});
