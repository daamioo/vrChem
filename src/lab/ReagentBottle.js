import { Container } from './Container.js';
import { LabelPanel } from '../ui/CanvasPanel.js';

const HAZARDS = {'corrosive': 'żrące', 'toxic': 'trujące', 'flammable': 'łatwopalne', 'reactive': 'reaktywne', 'oxidizer': 'utleniające', 'mild': 'drażniące'};
const STRIPES = { corrosive: '#ef4444', toxic: '#8b5cf6', flammable: '#f97316', reactive: '#f97316', oxidizer: '#eab308', mild: '#3b82f6' };

/**
 * A stock bottle/jar of one chemical. It is sealed (nothing can be poured in), carries a label
 * and refills itself shortly after being poured so the player never runs out of reagents.
 */
export class ReagentBottle extends Container {
  build() {
    super.build();
    this.sealed = true;
    this.facePlayer = true;
    this.chemicalId = null;
    this._idle = 0;
    this._targetGrams = 0;
  }

  setChemical(id) {
    const c = this.world.chemicals.get(id);
    this.chemicalId = id;
    const ml = this.def.fillMl ?? 300;
    this._targetGrams = c.isLiquid ? ml * c.density : ml * c.density;
    this.setContents({ [id]: this._targetGrams });
    this._addLabel(c);
    return this;
  }

  get displayName() { return this.chemicalId ? this.world.chemicals.get(this.chemicalId).name : super.displayName; }

  _addLabel(c) {
    const p = this.profile;
    const panel = new LabelPanel(Math.min(0.075, p.maxRadius * 1.9), 0.045, {
      title: c.name.replace(/ \(.*\)/, ''), formula: c.formula,
      stripe: STRIPES[c.hazard] ?? '#22c55e', subtitle: c.hazard ? (HAZARDS[c.hazard] ?? c.hazard).toUpperCase() : '',
    });
    panel.mesh.position.set(0, Math.min(p.height * 0.42, 0.055), p.maxRadius + p.wall + 0.0015);
    panel.mesh.renderOrder = 5;
    this.object3D.add(panel.mesh);
    this.labelPanel = panel;
  }

  update(dt) {
    super.update(dt);
    if (!this.world.settings.autoRefillBottles || !this.chemicalId) return;
    this._idle = this.pouring || this.body.held || this.tipped ? 0 : this._idle + dt;
    const missing = this._targetGrams - this.mixture.amount(this.chemicalId);
    if (this._idle > 1.5 && missing > 0.01) {
      this.mixture.add(this.chemicalId, Math.min(missing, this._targetGrams * 0.5 * dt), this.world.settings.ambientTemperatureC);
    }
  }

  /** Turns to face the player's start position so labels are readable. */
  faceToward(x, z) {
    this.object3D.rotation.y = Math.atan2(x - this.object3D.position.x, z - this.object3D.position.z);
  }
}

