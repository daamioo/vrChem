import { Probe } from './Probe.js';

/** Moving the tip around inside a container stirs its contents (some reactions need that). */
export class StirRod extends Probe {
  onImmersed(container, dt) {
    const speed = this.tipVelocity.length();
    if (speed < 0.05) return;
    const mix = container.mixture;
    mix.stir = Math.min(1, mix.stir + speed * dt * 1.2);
    this.world.audio?.play('stir', Math.min(1, speed));
    this.body.held?.pulse?.(0.05, 20);
  }
}
