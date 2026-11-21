import * as THREE from 'three';
import { hexToRgb } from '../chemistry/Mixture.js';

/**
 * Base class for reaction effects. A reaction in config lists effects as
 * `{ "type": "bubbles", ... }`; the type is looked up in the EffectRegistry and `play()` is
 * called with a context object:
 *   { world, system, container, desc, intensity (0..1), dt, event }
 * Effects are stateless singletons, so any per-container state belongs in the container/system.
 */
export class Effect {
  play(_ctx) {}

  /** Parses desc.color (hex string) into [r,g,b,a]. */
  static color(hex, alpha = 1, fallback = '#ffffff') {
    const c = hexToRgb(hex ?? fallback);
    return [c.r, c.g, c.b, alpha];
  }

  /** World point on the contents' top surface and the horizontal spawn radius there. */
  static surface(container) {
    const h = container.profile.heightForVolume(container.mixture.totalVolume);
    const p = container.worldPointAt(Math.max(h, container.height * 0.15), new THREE.Vector3());
    const r = container.profile.radiusAt(Math.min(h, container.height)) * 0.8;
    return { point: p, radius: Math.max(0.006, r) };
  }

  static mouth(container) {
    return { point: container.worldPointAt(container.height, new THREE.Vector3()), radius: container.profile.openingRadius * 0.8 };
  }
}

const _p = new THREE.Vector3();
const _v = new THREE.Vector3();

/** Spawns `n` particles in a horizontal disc, shared by several effects. */
export function emitDisc(system, center, radius, n, makeParticle) {
  system.emitRate(n, () => {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * radius;
    _p.set(center.x + Math.cos(a) * d, center.y, center.z + Math.sin(a) * d);
    makeParticle(_p, _v);
  });
}
