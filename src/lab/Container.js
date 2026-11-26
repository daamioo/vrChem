import * as THREE from 'three';
import { LabObject } from './LabObject.js';
import { GlassProfile } from './GlassProfile.js';
import { Mixture } from '../chemistry/Mixture.js';
import { GlassShards } from '../effects/GlassShards.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * Any vessel that holds a Mixture: beakers, flasks, tubes, reagent bottles.
 * Shape comes from the config profile; behaviour (pouring, reacting, heating, rendering the
 * liquid / sediment layers) lives here. Subclasses only specialise.
 */
export class Container extends LabObject {
  build() {
    const { def, world } = this;
    this.sealed = false;                 // sealed containers cannot be poured into
    this.pouring = null;                 // {kind, rate} while pouring this frame
    this.profile = new GlassProfile(def.profile, def.wall);
    this.height = this.profile.height;
    this.grabRadius = Math.max(0.025, this.profile.maxRadius);
    this.mixture = new Mixture(world.chemicals, world.settings.ambientTemperatureC);
    this._splashTimer = 0;
    this.breakable = def.breakable !== false;  // glassware shatters on hard impacts
    this.broken = false;
    this.tipped = null;                        // horizontal direction it fell toward, while lying on its side
    this._prevBottom = new THREE.Vector3();
    this._hasPrevBottom = false;
    this.gas = null;                           // { id, amount 0..1 }: gas filling the empty space (invisible)

    // Glass shell
    this.glass = new THREE.Mesh(
      this.profile.outerGeometry(),
      new THREE.MeshPhongMaterial({
        color: def.glassColor ?? '#cfe8ff', transparent: true, opacity: 0.22, shininess: 110,
        specular: 0xffffff, side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    this.glass.renderOrder = 3;

    // Liquid layer, clipped by a world-space horizontal plane so it stays level when tilted.
    this.liquidPlane = new THREE.Plane(DOWN.clone(), 0);
    this.liquidMesh = new THREE.Mesh(
      this.profile.innerGeometry(0.96),
      new THREE.MeshPhongMaterial({
        color: 0x88ccff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false,
        shininess: 60, clippingPlanes: [this.liquidPlane],
      }),
    );
    this.liquidMesh.renderOrder = 2;

    // Undissolved powder / precipitate.
    this.sedimentPlane = new THREE.Plane(DOWN.clone(), 0);
    this.sedimentMesh = new THREE.Mesh(
      this.profile.innerGeometry(0.93),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide, clippingPlanes: [this.sedimentPlane] }),
    );
    this.sedimentMesh.renderOrder = 1;
    this.liquidMesh.visible = this.sedimentMesh.visible = false;

    this.object3D.add(this.sedimentMesh, this.liquidMesh, this.glass);

    // Pour stream (lives in the scene root so it stays vertical).
    const g = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, -0.5, 0);
    this.stream = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
    this.stream.visible = false;
    this.stream.raycast = () => {};
    this.stream.frustumCulled = false;
  }

  onAdded() {
    super.onAdded();
    this.world.pourTargets.add(this);
    this.world.scene.add(this.stream);
    this.body.restHeight = 0;
  }

  onRemoved() {
    super.onRemoved();
    this.world.pourTargets.delete(this);
    this.world.scene.remove(this.stream);
    this.stream.geometry.dispose(); this.stream.material.dispose();
  }

  // ---------------------------------------------------------------- contents

  get capacityMl() { return this.profile.capacityMl; }
  get totalMassG() { return super.totalMassG + this.mixture.totalMass; }

  /** Replaces the contents. `contents` maps chemical id -> grams. */
  setContents(contents) {
    this.mixture.clear();
    for (const [id, g] of Object.entries(contents)) this.mixture.add(id, g);
  }

  /** Adds an amount in mL for liquids / grams for solids. */
  addChemical(id, amount) {
    const c = this.world.chemicals.get(id);
    this.mixture.add(id, c.isLiquid ? amount * c.density : amount);
  }

  // --------------------------------------------------------- PourTarget API

  canAccept(_source) { return !this.sealed; }

  getOpening() {
    return {
      center: this.worldPointAt(this.height, new THREE.Vector3()),
      radius: this.profile.openingRadius + 0.004,
    };
  }

  /** World Y a falling stream should end at. */
  streamEndY() {
    const top = this.worldPointAt(this.profile.heightForVolume(this.mixture.totalVolume), _a).y;
    return Math.max(top, this.worldPointAt(0, _b).y + 0.004);
  }

  acceptPour(map, temperatureC) {
    this.mixture.addAll(map, temperatureC);
    this.world.audio?.play('pourSplash', 0.4);
  }

  /** World Y of the liquid surface, or -Infinity when there's no liquid. */
  liquidTopY() {
    const L = this.mixture.layers;
    if (L.liquidVolume < 0.05) return -Infinity;
    return this.worldPointAt(this.profile.heightForVolume(L.totalVolume), _b).y;
  }

  // ------------------------------------------------------------------ gas

  /** Gas given off inside the vessel (grams) fills its empty space. */
  collectGas(id, grams) {
    const c = this.world.chemicals.get(id);
    const ml = (grams / c.molarMass) * 24000;
    this._addGas(id, ml / Math.max(1, this.capacityMl - this.mixture.totalVolume));
  }

  /** Adds `fraction` of a full vessel of gas, pushing out whatever gas was there. */
  _addGas(id, fraction) {
    if (this.sealed || fraction <= 0) return;
    if (this.gas && this.gas.id !== id) {
      this.gas.amount -= fraction;
      if (this.gas.amount <= 0) this.gas = { id, amount: Math.min(1, -this.gas.amount) };
      return;
    }
    this.gas ??= { id, amount: 0 };
    this.gas.amount = Math.min(1, this.gas.amount + fraction);
  }

  /**
   * Held mouth-down over a cylinder's jet, the vessel fills with that gas. Gas lighter than air
   * (hydrogen) escapes upward out of an open mouth, heavier gas (CO2, oxygen) pours out of a
   * mouth held downward, so a tube of hydrogen is kept upside down and one of oxygen upright.
   */
  _gasExchange(dt) {
    if (this.sealed) return;
    if (this.mixture.totalVolume > this.capacityMl * 0.9) { this.gas = null; return; }
    const up = this.axisUp;
    if (up.y < -0.3) {
      const mouth = this.getOpening().center;
      for (const src of this.world.gasSources) {
        const j = src.jetAt(mouth);
        if (j) { this._addGas(j.gas, j.flow * 0.9 * dt); this.body.held?.pulse?.(0.05, 20); }
      }
    }
    if (!this.gas) return;
    const c = this.world.chemicals.get(this.gas.id);
    const light = c.molarMass < 29;
    const leak = light ? Math.max(0, up.y) : Math.max(0, -up.y);
    const width = this.profile.openingRadius / 0.015;             // wide mouths lose gas faster
    this.gas.amount -= (this.gas.amount * leak * (light ? 1.2 : 0.3) * width + 0.006) * dt;
    if (this.gas.amount < 0.003) this.gas = null;
  }

  /** A flame at the mouth of a vessel holding a fuel gas: squeaky pop (and a drop of water). */
  _popCheck() {
    if (!this.gas || this.gas.amount < 0.12) return;
    const c = this.world.chemicals.get(this.gas.id);
    if (c.combustion !== 'fuel') return;
    const o = this.getOpening();
    if (!this.world.flameAt(o.center, o.radius + 0.015)) return;
    const k = this.gas.amount;
    this.gas = null;
    this.world.audio?.play('pop', 0.5 + k * 0.7);
    this.world.particles?.sparks.emitBurst(o.center, Math.round(6 + 10 * k), { color: [1, 0.8, 0.45, 1], speed: 0.6, size: 0.005, life: 0.18, up: 0.3, spread: o.radius });
    this.mixture.add('water', 0.03 * k);
    this.body.held?.pulse?.(0.9, 60);
    this.world.bus.emit('experiment', { type: 'hydrogen-pop', container: this, strength: k });
  }

  /** True if a world point lies inside the vessel's cavity (used by probes). */
  containsPoint(p) {
    const l = this.object3D.worldToLocal(_a.copy(p));
    return l.y > 0.002 && l.y < this.height + 0.03 && Math.hypot(l.x, l.z) < this.profile.radiusAt(Math.min(l.y, this.height)) + 0.004;
  }

  // ------------------------------------------------------------------ frame

  update(dt) {
    this.object3D.updateMatrixWorld(true);
    this._splashTimer -= dt;
    const mix = this.mixture;

    // Resting height follows the tilt, so a beaker lying on its side sits on its wall, not its base.
    if (!this.body.held) {
      const up = this.axisUp;
      this.body.restHeight = (this.profile.maxRadius + this.profile.wall) * Math.sqrt(Math.max(0, 1 - up.y * up.y));
    }

    this._thermal(dt);
    mix.stir = Math.max(0, mix.stir - dt * 0.6);

    for (const event of this.world.engine.step(mix, dt)) {
      this.world.bus.emit('reaction:step', { container: this, event });
      for (const [id, g] of event.gas) this.collectGas(id, g);
    }
    this._gasExchange(dt);
    this._popCheck();

    this._pour(dt);
    this._overflow();
    this._updateVisuals();
    this._checkSmash();
  }

  get collisionRadius() { return this.profile.maxRadius + this.profile.wall; }

  /** Lying on its side once knocked over; upright otherwise. */
  restQuaternion(yaw) {
    if (this.tipped) return this._rest.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, this.tipped);
    return super.restQuaternion(yaw);
  }

  onGrab(hand) { this.tipped = null; super.onGrab(hand); }

  /**
   * Hit by a ball. A hard enough push — easier the higher up it lands and the lighter the vessel —
   * tips it over (the contents then pour out by themselves); a softer one makes it wobble and slide.
   */
  onKnock(dv, point) {
    const push = _b.set(dv.x, 0, dv.z);
    const speed = push.length();
    if (speed < 0.02) return;
    this.world.audio?.play('clink', Math.min(1, speed * 1.5));
    const hitHeight = THREE.MathUtils.clamp(this.object3D.worldToLocal(point.clone()).y / this.height, 0, 1);
    const score = speed * (0.4 + hitHeight);
    push.divideScalar(speed);
    const tipAt = this.world.settings.knock?.tipSpeed ?? 0.35;
    if (!this.tipped && this.axisUp.y > 0.9 && score > tipAt) {
      this.tipped = push.clone();
    } else {
      // wobble: lean away from the hit; the self-righting springs it back
      const axis = _a.set(push.z, 0, -push.x);
      this.object3D.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, Math.min(0.35, score * 0.9)));
    }
    this.body.velocity.addScaledVector(push, speed * 0.5);    // and slide a little
    if (!this.body.support) this.body.velocity.y += dv.y;
  }

  /** Held glass slammed down onto a table / the floor faster than the breakage speed shatters. */
  _checkSmash() {
    const bottom = this.worldPointAt(0, _a);
    const hand = this.body.held;
    if (hand && this.breakable && this._hasPrevBottom) {
      const prevY = this._prevBottom.y;
      const s = this.world.physics.surfaceAt(bottom.x, bottom.z, prevY + 0.001);
      if (s && prevY >= s.top && bottom.y < s.top && hand.velocity.length() > this.world.settings.breakage.impactSpeed) {
        hand.pulse?.(1, 120);
        this.shatter(hand.velocity);
        return;
      }
    }
    this._prevBottom.copy(bottom);
    this._hasPrevBottom = !!hand;
  }

  _thermal(dt) {
    const mix = this.mixture;
    const t = this.world.settings.thermal;
    const ambient = this.world.settings.ambientTemperatureC;
    const surfaceT = this.body.support?.temperature?.() ?? null;
    // held in (or standing in) a flame: heats toward the flame's temperature
    let flameT = null;
    if (this.world.flames.size) {
      const bottom = this.worldPointAt(0.006, _a);
      for (const f of this.world.flames) if (f.flameDistance(bottom) < 0.004) flameT = Math.max(flameT ?? -Infinity, f.flameHeat);
    }
    const target = Math.max(surfaceT ?? ambient, flameT ?? -Infinity);
    const tau = target > mix.temperature
      ? Math.max(8, t.heatingTimeConstantPerG * Math.max(20, mix.totalMass))
      : t.coolingTimeConstantS;
    mix.temperature += (target - mix.temperature) * (1 - Math.exp(-dt / tau));

    // Boiling: clamp at the boiling point of the dominant liquid and evaporate slowly.
    let dominant = null, best = 0;
    for (const [id, g] of mix.grams) {
      const c = this.world.chemicals.get(id);
      if (c.isLiquid && g > best) { best = g; dominant = c; }
    }
    if (dominant && mix.temperature > dominant.boilingPoint) {
      mix.temperature = dominant.boilingPoint;
      mix.remove(dominant.id, 0.8 * dt);
      const o = this.getOpening();
      this.world.particles?.puffs.emitBurst(o.center, 1, { color: [1, 1, 1, 0.25], speed: 0.12, size: 0.03, life: 1.6, up: 0.15 });
    }
  }

  _lowestRimPoint(up, target = new THREE.Vector3()) {
    const c = this.worldPointAt(this.height, target);
    const k = up.y;
    const d = _b.set(up.x * k, -1 + up.y * up.y, up.z * k);
    if (d.lengthSq() < 1e-8) return c;
    return c.addScaledVector(d.normalize(), this.profile.openingRadius);
  }

  _pour(dt) {
    this.pouring = null;
    const mix = this.mixture;
    if (mix.isEmpty) return;
    const up = this.axisUp;
    if (up.y > 0.985) return;
    const cfg = this.world.settings.pouring;
    const L = mix.layers;
    const rim = this._lowestRimPoint(up);

    let kind = null, amount = 0, rate = 0, color;
    if (L.liquidVolume > 0.05) {
      const topY = this.worldPointAt(this.profile.heightForVolume(L.totalVolume), _a).y;
      const cm = (topY - rim.y) * 100;
      if (cm > 0.02) {
        rate = Math.min(cfg.maxLiquidMlPerSecond, cm * cfg.liquidMlPerSecondPerCm);
        amount = Math.min(L.liquidVolume, rate * dt);
        kind = 'liquid'; color = L.liquidColor;
      }
    } else if (L.sedimentVolume > 0.01) {
      const topY = this.worldPointAt(this.profile.heightForVolume(L.sedimentVolume), _a).y;
      const cm = (topY - rim.y) * 100;
      if (cm > 0.02) {
        rate = Math.min(cfg.maxPowderGramsPerSecond, cm * cfg.powderGramsPerSecondPerCm);
        amount = rate * dt;
        kind = 'powder'; color = L.sedimentColor;
      }
    }
    if (!kind || amount <= 0) return;

    const temp = mix.temperature;
    const taken = kind === 'liquid' ? mix.takeLiquid(amount) : mix.takeSediment(amount);
    if (taken.size === 0) return;

    // Where does the stream land?
    let target = null, bestY = -Infinity;
    for (const t of this.world.pourTargets) {
      if (t === this || !t.canAccept(this)) continue;
      const o = t.getOpening();
      if (o.center.y < rim.y - 0.003 && o.center.y > bestY &&
          Math.hypot(rim.x - o.center.x, rim.z - o.center.z) <= o.radius) { target = t; bestY = o.center.y; }
    }

    let endY;
    if (target) { target.acceptPour(taken, temp, this); endY = target.streamEndY(); }
    else {
      // a free-falling stream: things under it may care (e.g. the cat)
      this.world.bus.emit('pour:stream', { container: this, x: rim.x, y: rim.y, z: rim.z, map: taken, temperature: temp });
      const s = this.world.physics.surfaceAt(rim.x, rim.z, rim.y);
      endY = s ? s.top : 0;
      this._splash(rim.x, endY, rim.z, color, taken);
    }

    this.pouring = { kind, rate };
    this._showStream(rim, endY, kind, color);
    this.world.audio?.play(kind === 'liquid' ? 'pour' : 'powder', Math.min(1, rate / 40));
    this.body.held?.pulse?.(0.08, 30);
  }

  _showStream(rim, endY, kind, color) {
    const len = Math.max(0.005, rim.y - endY);
    const r = this.world.settings.pouring.streamRadius * (kind === 'liquid' ? 1 : 1.6);
    this.stream.position.copy(rim);
    this.stream.scale.set(r, len, r);
    this.stream.material.color.setRGB(color.r, color.g, color.b, THREE.SRGBColorSpace);
    this.stream.material.opacity = kind === 'liquid' ? Math.max(0.5, color.a) : 0.9;
    this.stream.visible = true;
  }

  _splash(x, y, z, color, map) {
    if (this._splashTimer > 0) return;
    this._splashTimer = 0.08;
    this.world.particles?.droplets.emitBurst(_a.set(x, y + 0.005, z), 5, { color: [color.r, color.g, color.b, 0.8], speed: 0.4, size: 0.006, life: 0.5, up: 0.5 });
    this.world.bus.emit('spill', { container: this, map });
  }

  _overflow() {
    const mix = this.mixture;
    const excess = mix.totalVolume - this.capacityMl;
    if (excess <= 0.5) return;
    const lost = mix.takeFraction(excess / mix.totalVolume);
    const o = this.getOpening();
    const c = mix.layers.liquidColor;
    this.world.particles?.droplets.emitBurst(o.center, 8, { color: [c.r, c.g, c.b, 0.8], speed: 0.5, size: 0.007, life: 0.6, up: 0.3 });
    this.world.bus.emit('spill', { container: this, map: lost });
  }

  _updateVisuals() {
    const mix = this.mixture;
    const L = mix.layers;
    const showLiquid = L.liquidVolume > 0.05;
    const showSed = L.sedimentVolume > 0.01;
    this.liquidMesh.visible = showLiquid;
    this.sedimentMesh.visible = showSed;
    if (showLiquid) {
      const c = L.liquidColor;
      this.liquidMesh.material.color.setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace);
      this.liquidMesh.material.opacity = Math.min(0.9, c.a + 0.15);
      this.liquidPlane.constant = this.worldPointAt(this.profile.heightForVolume(L.totalVolume), _a).y;
    }
    if (showSed) {
      const c = L.sedimentColor;
      this.sedimentMesh.material.color.setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace);
      this.sedimentPlane.constant = this.worldPointAt(this.profile.heightForVolume(L.sedimentVolume), _a).y;
    }
    if (!this.pouring) this.stream.visible = false;
  }

  // ----------------------------------------------------------------- events

  onImpact(speed) {
    if (speed > 0.5) this.world.audio?.play('clink', Math.min(1, speed / 2));
    if (speed > this.world.settings.breakage.impactSpeed) {
      if (this.breakable) this.shatter(this.body.velocity.clone());
      else if (!this.mixture.isEmpty) this._spillAll();
    }
  }

  _spillAll() {
    if (this.mixture.isEmpty) return;
    const c = this.mixture.layers.liquidColor;
    const lost = this.mixture.takeFraction(1);
    this.world.particles?.droplets.emitBurst(this.worldPointAt(0.02, _a), 24, { color: [c.r, c.g, c.b, 0.8], speed: 1, size: 0.008, life: 0.8, up: 0.8 });
    this.world.bus.emit('spill', { container: this, map: lost });
  }

  /**
   * Breaks the vessel: contents splash out, glass fragments scatter and the item is removed.
   * Items placed by the lab layout come back at their starting spot after a few seconds.
   */
  shatter(kick = null) {
    if (this.broken) return;
    this.broken = true;
    const w = this.world;
    this.object3D.updateMatrixWorld(true);
    const origin = this.worldPointAt(Math.min(0.03, this.height * 0.3), new THREE.Vector3());
    this._spillAll();
    w.audio?.play('shatter', 1);
    w.particles?.sparks.emitBurst(origin, 10, { color: [0.85, 0.95, 1, 0.9], speed: 1.4, size: 0.006, life: 0.35, up: 0.9, spread: 0.05 });
    const size = THREE.MathUtils.clamp(this.profile.maxRadius * 1.1, 0.02, 0.06);
    const count = Math.round(THREE.MathUtils.clamp(this.capacityMl / 12, 8, 24));
    w.add(new GlassShards(w, { origin, color: this.def.glassColor ?? '#cfe8ff', count, size, kick }));
    w.bus.emit('glass:broken', { object: this, position: origin });
    const item = this.spawnItem;
    w.remove(this);
    if (item) w.after(w.settings.breakage.respawnS ?? 4, () => w.bus.emit('lab:spawn', { item }));
  }

  /** Blows part of the contents out and kicks the vessel. Used by the explosion effect. */
  explode(power = 1) {
    const lost = this.mixture.takeFraction(Math.min(0.8, 0.3 + 0.4 * power));
    this.world.bus.emit('spill', { container: this, map: lost });
    const b = this.body;
    if (b.held) b.held.pulse?.(1, 250);
    else { b.support = null; b.velocity.set((Math.random() - 0.5) * 1.2, 1.2 + power, (Math.random() - 0.5) * 1.2); }
  }
}
