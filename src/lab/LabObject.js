import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { PhysicsBody } from '../physics/PhysicsSystem.js';

const _lp = new THREE.Vector3();

/**
 * Base class for every grabbable object. Origin = bottom centre (or the tip for tools);
 * local +Y runs along the object's axis. Subclasses build their meshes in `build()`.
 */
export class LabObject extends Entity {
  /**
   * @param {World} world
   * @param {object} def    entry from config/equipment.json
   * @param {string} equipmentId
   */
  constructor(world, def, equipmentId) {
    super(world);
    this.def = def;
    this.equipmentId = equipmentId;
    this.body = new PhysicsBody();
    this.tags.add('labobject');
    this.height = 0.1;        // axis length for grab queries; set by subclasses
    this.grabRadius = 0.04;
    this._rest = new THREE.Quaternion();
    this._yaw = new THREE.Quaternion();
    this._lay = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    this.build();
  }

  /** Create meshes and add them to this.object3D. Must set this.height / this.grabRadius. */
  build() {}

  onAdded() {
    this.world.grabbables.add(this);
    this.world.physics.addBody(this);
  }
  onRemoved() {
    this.world.grabbables.delete(this);
    this.world.physics.removeBody(this);
    if (this.body.held) this.body.held.drop();
  }

  /** Mass in grams (container + contents for glassware); read by the scale. */
  get totalMassG() { return this.def.massG ?? 50; }
  get displayName() { return this.def.displayName ?? this.equipmentId; }

  /** Orientation the object settles into, keeping its heading. Default: upright. */
  restQuaternion(yaw) {
    return this._rest.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
  }

  /** Distance from a world point to the object's axis capsule (0 when inside). */
  distanceToPoint(p) {
    const local = this.object3D.worldToLocal(p.clone());
    const y = THREE.MathUtils.clamp(local.y, 0, this.height);
    const d = Math.hypot(local.x, local.y - y, local.z);
    return Math.max(0, d - this.grabRadius);
  }

  get axisUp() { return new THREE.Vector3(0, 1, 0).applyQuaternion(this.object3D.quaternion); }
  worldPointAt(localY, target = new THREE.Vector3()) {
    return target.set(0, localY, 0).applyMatrix4(this.object3D.matrixWorld);
  }

  /** Lowest world point of the object (its axis capsule), e.g. to keep it out of benches. */
  lowestPoint(target = new THREE.Vector3()) {
    this.object3D.updateMatrixWorld(true);
    const a = this.worldPointAt(0, target), b = this.worldPointAt(this.height, _lp);
    const r = this.collisionRadius || this.def.radius || 0;
    if (b.y < a.y) a.copy(b);
    const up = this.axisUp.y;
    a.y -= this.height > 0 ? r * Math.sqrt(Math.max(0, 1 - up * up)) : r;
    return a;
  }

  /** Radius of the capsule balls collide with (0 = balls pass through). */
  get collisionRadius() { return 0; }
  /** The capsule's axis in world space: from the origin up `height` along local +Y. */
  collisionSegment(a, b) { this.worldPointAt(0, a); this.worldPointAt(this.height, b); }
  /** Hit by a ball: `dv` is the velocity change the impulse would give this object (m/s). */
  onKnock(dv) { if (!this.body.support) this.body.velocity.add(dv); }

  onGrab(_hand) {}
  onRelease(_hand) {}
  onImpact(_speed, _surface) {}

  /** Teleports the object, resting on whichever surface is below it. */
  placeAt(x, y, z) {
    this.object3D.position.set(x, y, z);
    this.object3D.updateMatrixWorld(true);
  }
}
