import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { Surface } from '../physics/Surface.js';
import { Wall } from './Wall.js';
import { WindowCasement } from './WindowCasement.js';
import { daylight } from '../core/DayCycle.js';

/** Procedural canvas textures for the clean white-panel lab look. */
class PanelTextures {
  /** White wall/ceiling panels with seams, screws and subtle shade variation (one tile = 2x2 panels). */
  static wall(repeatX, repeatY) {
    const size = 512, c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const n = 2, cell = size / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const shade = 236 + Math.floor(Math.random() * 14);
      g.fillStyle = `rgb(${shade},${shade + 1},${shade + 3})`;
      g.fillRect(x * cell, y * cell, cell, cell);
      g.fillStyle = 'rgba(80,90,105,0.55)';
      for (const [dx, dy] of [[14, 14], [cell - 14, 14], [14, cell - 14], [cell - 14, cell - 14]]) {
        g.beginPath(); g.arc(x * cell + dx, y * cell + dy, 3, 0, 7); g.fill();
      }
    }
    g.strokeStyle = 'rgba(70,80,95,0.8)'; g.lineWidth = 4;
    for (let i = 0; i <= n; i++) {
      g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, size); g.stroke();
      g.beginPath(); g.moveTo(0, i * cell); g.lineTo(size, i * cell); g.stroke();
    }
    return PanelTextures._finish(c, repeatX, repeatY);
  }

  /** Glossy white ceramic subway tile in a half-brick pattern. One texture tile covers 0.6 m x 0.6 m. */
  static tiles() {
    const size = 512, c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#aab3bd'; g.fillRect(0, 0, size, size);              // grout
    const cols = 2, rows = 4, tw = size / cols, th = size / rows, gap = 5;
    for (let r = 0; r < rows; r++) for (let col = -1; col < cols; col++) {
      const x = col * tw + (r % 2 ? tw / 2 : 0), y = r * th;
      const shade = 244 + Math.floor(Math.random() * 11);
      const grad = g.createLinearGradient(x, y, x + tw, y + th);
      grad.addColorStop(0, `rgb(${shade},${shade + 1},${shade + 2})`);
      grad.addColorStop(1, `rgb(${shade - 12},${shade - 10},${shade - 6})`);
      g.fillStyle = grad;
      g.fillRect(x + gap / 2, y + gap / 2, tw - gap, th - gap);
      g.fillStyle = 'rgba(255,255,255,0.9)';                             // bevel highlight (top / left)
      g.fillRect(x + gap / 2, y + gap / 2, tw - gap, 2); g.fillRect(x + gap / 2, y + gap / 2, 2, th - gap);
      g.fillStyle = 'rgba(120,135,150,0.35)';                            // bevel shadow (bottom / right)
      g.fillRect(x + gap / 2, y + th - gap / 2 - 2, tw - gap, 2); g.fillRect(x + tw - gap / 2 - 2, y + gap / 2, 2, th - gap);
    }
    return PanelTextures._finish(c, 1, 1);
  }

  /** Dark graphite floor tiles with light seams. */
  static floor(repeatX, repeatY) {
    const size = 512, c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#2b3038'; g.fillRect(0, 0, size, size);
    g.fillStyle = '#323842'; g.fillRect(0, 0, size / 2, size / 2); g.fillRect(size / 2, size / 2, size / 2, size / 2);
    g.strokeStyle = '#5b6573'; g.lineWidth = 5;
    g.strokeRect(2, 2, size - 4, size - 4);
    g.beginPath(); g.moveTo(size / 2, 0); g.lineTo(size / 2, size); g.moveTo(0, size / 2); g.lineTo(size, size / 2); g.stroke();
    return PanelTextures._finish(c, repeatX, repeatY);
  }

  static _finish(canvas, rx, ry) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
}

/**
 * The lab room: glossy floor (a Surface), four panelled walls with windows (from lab.json
 * `windows`, optional), ceiling lights and lighting.
 */
export class Room extends Entity {
  constructor(world) {
    super(world);
    const { width: w, depth: d, height: h } = world.settings.room;
    this.dims = { w, d, h };
    const windows = world.config.lab.windows ?? {};
    this.casements = [];
    const panel = 1.2;

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: PanelTextures.floor(w, d), roughness: 0.3, metalness: 0.25 }),
    );
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: PanelTextures.wall(w / panel, d / panel), roughness: 0.6 }),
    );
    ceiling.position.y = h;
    this.object3D.add(floor, ceiling);

    // Wall UVs are in metres, so repeat = 1 / tile size.
    const tileSize = 0.6;
    const wallMat = new THREE.MeshStandardMaterial({ map: PanelTextures.tiles(), roughness: 0.22, metalness: 0.05 });
    wallMat.map.repeat.set(1 / tileSize, 1 / tileSize);
    // [name, length, position, rotationY, flipU]: window u is given in world axis and flipped where the local axis runs backwards.
    const walls = [
      ['back',  w, [0, 0, -d / 2], 0, false],
      ['front', w, [0, 0, d / 2], Math.PI, true],
      ['left',  d, [-w / 2, 0, 0], Math.PI / 2, true],
      ['right', d, [w / 2, 0, 0], -Math.PI / 2, false],
    ];
    for (const [name, length, pos, rot, flip] of walls) {
      const local = (windows[name] ?? []).map(({ u: [a, b], v, openable }) => ({ u: flip ? [-b, -a] : [a, b], v, openable }));
      const wall = new Wall({ length, height: h, material: wallMat, windows: local });
      wall.group.position.set(...pos);
      wall.group.rotation.y = rot;
      this.object3D.add(wall.group);
      // openable windows: two sashes hinged at the outer edges, meeting in the middle
      for (const { u: [u0, u1], v: [v0, v1], openable } of local) {
        if (!openable) continue;
        const half = (u1 - u0) / 2;
        this.casements.push(new WindowCasement(world, wall.group, { hingeU: u0, side: 1, width: half, v0, v1 }));
        this.casements.push(new WindowCasement(world, wall.group, { hingeU: u1, side: -1, width: half, v0, v1 }));
      }
    }

    this._addCeilingLights(h);
    this._addLights(h);
  }

  _addCeilingLights(h) {
    const mat = this.panelMat = new THREE.MeshBasicMaterial({ color: 0xf4fbff });
    const frame = new THREE.MeshStandardMaterial({ color: 0x252a32, metalness: 0.5, roughness: 0.4 });
    for (const x of [-1.4, 0, 1.4]) for (const z of [-1.4, 0.2]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.03, 0.5), frame);
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.02, 0.42), mat);
      f.position.set(x, h - 0.015, z);
      p.position.set(x, h - 0.032, z);
      this.object3D.add(f, p);
    }
  }

  _addLights(h) {
    this.hemi = new THREE.HemisphereLight(0xf2f8ff, 0x7d8794, 1.7);       // ceiling panels (diffuse)
    this.object3D.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.4);                  // daylight through the window + fill
    this.sun.position.set(2.5, 3, 0.5);
    this.object3D.add(this.sun);
    this.key = new THREE.PointLight(0xf4fbff, 1.3, 5, 1.4);
    this.key.position.set(0, h - 0.5, -1.0);
    this.object3D.add(this.key);
  }

  /**
   * Lights from the light switch (world.env.lightsOn, faded over ~0.2 s — no flicker) and the
   * time of day (daylight through the window); reports the indoor light level for the view outside.
   */
  _updateLights(dt) {
    const env = this.world.env, dl = daylight(env.hours ?? 18);
    this._lit = this._lit ?? (env.lightsOn === false ? 0 : 1);
    this._lit += ((env.lightsOn === false ? 0 : 1) - this._lit) * (1 - Math.exp(-12 * dt));
    const on = this._lit;
    this.hemi.intensity = 0.04 + 0.45 * dl + (1.7 - 0.04 - 0.45 * dl) * on;     // off: just daylight
    this.key.intensity = 1.3 * on;
    this.sun.intensity = (0.15 + 1.3 * dl) * (1 - on) + (0.6 + 0.9 * dl) * on;
    this.panelMat.color.setRGB(0.19 + 0.77 * on, 0.21 + 0.77 * on, 0.24 + 0.76 * on);
    env.indoorLight = (this.hemi.intensity + 0.5 * this.sun.intensity) / (1.7 + 0.7);
  }

  onAdded() {
    const { w, d } = this.dims;
    this.floor = this.world.physics.addSurface(new Surface({ owner: this, shape: 'rect', x: 0, z: 0, top: 0, halfX: w / 2, halfZ: d / 2 }));
  }
  onRemoved() { this.world.physics.removeSurface(this.floor); for (const c of this.casements) c.dispose(); }

  update(dt) {
    let open = 0;
    for (const c of this.casements) { c.update(dt); open = Math.max(open, c.open); }
    this.world.env.outsideOpen = open;      // how much outside sound gets in (FactoryVista ambience)
    this._updateLights(dt);
  }
}
