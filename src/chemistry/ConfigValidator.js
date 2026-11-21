/** Cross-checks the config set so typos in JSON fail loudly at load time. Returns a list of problems. */
export class ConfigValidator {
  static validate(cfg) {
    const errors = [];
    const warnings = [];
    const chem = cfg.chemicals ?? {};
    const need = (cond, msg) => { if (!cond) errors.push(msg); };

    for (const [id, c] of Object.entries(chem)) {
      need(typeof c.molarMass === 'number' && c.molarMass > 0, `chemical ${id}: molarMass must be > 0`);
      need(['solid', 'liquid', 'gas'].includes(c.state), `chemical ${id}: state must be solid|liquid|gas`);
      need(/^#[0-9a-f]{6}$/i.test(c.color ?? ''), `chemical ${id}: color must be #rrggbb`);
      if (c.state !== 'gas') need(c.density > 0, `chemical ${id}: density required`);
    }

    for (const [id, r] of Object.entries(cfg.reactions ?? {})) {
      if (r.disabled) continue;
      need(r.reactants && Object.keys(r.reactants).length > 0, `reaction ${id}: needs reactants`);
      for (const group of ['reactants', 'products', 'catalysts']) {
        for (const cid of Object.keys(r[group] ?? {})) need(cid in chem, `reaction ${id}: unknown chemical "${cid}" in ${group}`);
      }
      for (const e of r.effects ?? []) {
        need(!!e.type, `reaction ${id}: effect without type`);
        for (const cid of e.requires ?? []) need(cid in chem, `reaction ${id}: effect requires unknown chemical "${cid}"`);
      }
      if (r.reactants && r.products && Object.keys(chem).length) {
        const m = (o) => Object.entries(o).reduce((s, [cid, k]) => s + k * (chem[cid]?.molarMass ?? 0), 0);
        const diff = Math.abs(m(r.products) - m(r.reactants));
        if (diff > 0.5) warnings.push(`reaction ${id}: mass imbalance of ${diff.toFixed(2)} g/mol`);
      }
    }

    const eq = cfg.equipment ?? {};
    for (const [id, e] of Object.entries(eq)) need(!!e.class, `equipment ${id}: missing class`);
    for (const [i, item] of (cfg.lab?.items ?? []).entries()) {
      need(item.equipment in eq, `lab item #${i}: unknown equipment "${item.equipment}"`);
      if (item.chemical) need(item.chemical in chem, `lab item #${i}: unknown chemical "${item.chemical}"`);
      if (item.anchor) need(item.anchor in (cfg.lab.anchors ?? {}), `lab item #${i}: unknown anchor "${item.anchor}"`);
    }
    return { errors, warnings };
  }
}
