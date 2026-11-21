import * as THREE from 'three';
import { Effect, emitDisc } from './Effect.js';
import { Registry } from '../core/Registry.js';

/** Rising CO2 / gas bubbles from the liquid surface. */
export class BubbleEffect extends Effect {
  play({ world, container, desc, intensity, dt }) {
    const { point, radius } = Effect.surface(container);
    const col = Effect.color(desc.color, 0.7);
    emitDisc(world.particles.bubbles, point, radius, intensity * 90 * dt, (p, v) => {
      v.set((Math.random() - 0.5) * 0.04, 0.12 + Math.random() * 0.2 * intensity, (Math.random() - 0.5) * 0.04);
      world.particles.bubbles.emit(p, v, col, 0.004 + Math.random() * 0.006, 0.5 + Math.random() * 0.7);
    });
  }
}

/** Foam welling up out of the vessel mouth (burst or continuous). */
export class FoamEffect extends Effect {
  play({ world, container, desc, intensity, dt, burst }) {
    const { point, radius } = Effect.mouth(container);
    let base = Effect.color(desc.color, 0.9);
    if (desc.tintFromLiquid) {
      const c = container.mixture.layers.liquidColor;
      base = [(c.r + 1) / 2, (c.g + 1) / 2, (c.b + 1) / 2, 0.9];
    }
    const n = burst ? 14 + intensity * 50 : intensity * 70 * dt;
    emitDisc(world.particles.puffs, point, radius, n, (p, v) => {
      v.set((Math.random() - 0.5) * 0.15, 0.12 + Math.random() * 0.3 * (0.5 + intensity), (Math.random() - 0.5) * 0.15);
      world.particles.puffs.emit(p, v, base, 0.02 + Math.random() * 0.025, 1.6 + Math.random() * 1.4, 0.8);
    });
  }
}

/** Slow grey/white vapour from the vessel mouth. */
export class SmokeEffect extends Effect {
  play({ world, container, desc, intensity, dt }) {
    const { point, radius } = Effect.mouth(container);
    const col = Effect.color(desc.color, 0.35);
    emitDisc(world.particles.puffs, point, radius, intensity * 25 * dt, (p, v) => {
      v.set((Math.random() - 0.5) * 0.04, 0.1 + Math.random() * 0.1, (Math.random() - 0.5) * 0.04);
      world.particles.puffs.emit(p, v, col, 0.03 + Math.random() * 0.03, 2 + Math.random(), 1.5);
    });
  }
}

/** Glittering additive sparks (precipitates, burning metal). */
export class SparkleEffect extends Effect {
  play({ world, container, desc, intensity, dt }) {
    const { point, radius } = Effect.surface(container);
    const col = Effect.color(desc.color, 1);
    emitDisc(world.particles.sparks, point, radius, intensity * 70 * dt, (p, v) => {
      v.set((Math.random() - 0.5) * 0.3, 0.3 + Math.random() * 0.6, (Math.random() - 0.5) * 0.3);
      world.particles.sparks.emit(p, v, col, 0.005 + Math.random() * 0.006, 0.4 + Math.random() * 0.5);
    });
  }
}

/** Brief burst of light plus sparks. */
export class FlashEffect extends Effect {
  play({ world, system, container, desc, intensity }) {
    const { point } = Effect.mouth(container);
    const col = Effect.color(desc.color, 1, '#ffffff');
    system.flash(point, new THREE.Color().setRGB(col[0], col[1], col[2]), 1.5 + intensity * 4);
    world.particles.sparks.emitBurst(point, 25, { color: col, speed: 1.2, size: 0.008, life: 0.5, up: 1.5 });
    world.audio?.play('hiss', 1);
  }
}

/** Throws contents out of the vessel and kicks it. `power` scales the effect. */
export class ExplosionEffect extends Effect {
  play({ world, system, container, desc, intensity }) {
    const power = (desc.power ?? 1) * (0.5 + intensity);
    const { point } = Effect.mouth(container);
    container.explode(power);
    system.flash(point, new THREE.Color(1, 0.8, 0.5), 6 * power);
    world.particles.puffs.emitBurst(point, 60, { color: [0.3, 0.3, 0.3, 0.5], speed: 1.0, size: 0.05, life: 2.5, up: 1.0, growth: 2 });
    world.particles.sparks.emitBurst(point, 80, { color: [1, 0.7, 0.3, 1], speed: 3, size: 0.007, life: 0.8, up: 2 });
    world.audio?.play('boom', Math.min(1.2, power));
  }
}

/** Plays a named procedural sound (see AudioService.recipes). */
export class SoundEffect extends Effect {
  play({ world, desc, intensity }) { world.audio?.play(desc.sound ?? 'beep', 0.3 + intensity * 0.7); }
}

/** Registry used by reactions.json (`"type": "..."`). Register new effect classes here or from game code. */
export const effectRegistry = new Registry('effect')
  .register('bubbles', BubbleEffect)
  .register('foam', FoamEffect)
  .register('smoke', SmokeEffect)
  .register('sparkle', SparkleEffect)
  .register('flash', FlashEffect)
  .register('explosion', ExplosionEffect)
  .register('sound', SoundEffect);
