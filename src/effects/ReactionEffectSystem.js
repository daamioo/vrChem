import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { effectRegistry } from './effects.js';
import { FloatingText } from '../ui/FloatingText.js';

/**
 * Listens to chemistry events and plays the effects listed in the reaction's config.
 * Also shows the reaction's message above the vessel the first time it starts there.
 */
export class ReactionEffectSystem extends Entity {
  constructor(world) {
    super(world);
    this._instances = new Map();
    this._state = new WeakMap();        // container -> Map(key -> accumulated extent)
    this._announced = new WeakMap();    // container -> Map(reactionId -> time)
    this.light = new THREE.PointLight(0xffffff, 0, 3, 1.5);
    this.object3D.add(this.light);
    this._off = world.bus.on('reaction:step', (e) => this.handle(e));
  }

  flash(point, color, power) {
    this.light.position.copy(point);
    this.light.color.copy(color);
    this.light.intensity = power;
  }

  update(dt) { this.light.intensity = Math.max(0, this.light.intensity - dt * 14); }
  onRemoved() { this._off(); }

  _effect(type) {
    if (!this._instances.has(type)) this._instances.set(type, effectRegistry.create(type));
    return this._instances.get(type);
  }

  handle({ container, event }) {
    const { reaction } = event;
    const mix = container.mixture;
    this._announce(container, reaction);

    reaction.effects.forEach((desc, index) => {
      if (desc.requires?.some((id) => mix.amount(id) < 0.05)) return;
      if (desc.requiresHot != null && mix.temperature < desc.requiresHot) return;

      let intensity, burst = false;
      if (desc.mode === 'burst') {
        let map = this._state.get(container);
        if (!map) this._state.set(container, (map = new Map()));
        const key = `${reaction.id}#${index}`;
        const acc = (map.get(key) ?? 0) + event.extent;
        const need = desc.minMoles ?? 0.01;
        if (acc < need) { map.set(key, acc); return; }
        map.set(key, 0);
        intensity = Math.min(1, acc / (desc.fullMoles ?? need * 4));
        burst = true;
      } else {
        intensity = Math.min(1, event.rate / (desc.refRate ?? 0.05));
      }
      this._effect(desc.type).play({ world: this.world, system: this, container, desc, intensity, dt: event.dt, event, burst });
    });
  }

  _announce(container, reaction) {
    if (!reaction.message) return;
    let map = this._announced.get(container);
    if (!map) this._announced.set(container, (map = new Map()));
    const last = map.get(reaction.id) ?? -Infinity;
    if (this.world.time - last < 8) return;
    map.set(reaction.id, this.world.time);
    this.world.add(new FloatingText(this.world, {
      title: reaction.name, body: reaction.message,
      anchor: () => container.worldPointAt(container.height, new THREE.Vector3()),
    }));
  }
}
