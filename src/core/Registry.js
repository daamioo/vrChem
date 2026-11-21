/**
 * Name -> class registry. Lets config files refer to behaviour by string
 * (`"class": "Beaker"`, `"type": "bubbles"`) so new content needs no wiring code.
 */
export class Registry {
  constructor(kind = 'item') { this.kind = kind; this._classes = new Map(); }

  register(name, cls) { this._classes.set(name, cls); return this; }
  has(name) { return this._classes.has(name); }

  get(name) {
    const cls = this._classes.get(name);
    if (!cls) throw new Error(`Unknown ${this.kind} "${name}". Registered: ${[...this._classes.keys()].join(', ')}`);
    return cls;
  }

  create(name, ...args) { return new (this.get(name))(...args); }
}
