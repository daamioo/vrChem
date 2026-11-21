/**
 * A horizontal support area (table top, scale pad, hot plate...). Objects land and rest on
 * the highest surface under them. A surface may report a temperature (hot plate) so that
 * thermal behaviour needs no knowledge of what kind of object it is.
 */
export class Surface {
  /**
   * @param {object} o
   * @param {object} o.owner
   * @param {'rect'|'circle'} o.shape
   * @param {number} o.x  centre x
   * @param {number} o.z  centre z
   * @param {number} o.top height of the surface (m)
   * @param {number} [o.halfX] @param {number} [o.halfZ] @param {number} [o.radius]
   * @param {()=>number|null} [o.temperature]
   */
  constructor({ owner, shape = 'rect', x, z, top, halfX = 0, halfZ = 0, radius = 0, temperature = null }) {
    Object.assign(this, { owner, shape, x, z, top, halfX, halfZ, radius });
    this.temperature = temperature;
  }

  contains(px, pz) {
    if (this.shape === 'circle') return (px - this.x) ** 2 + (pz - this.z) ** 2 <= this.radius ** 2;
    return Math.abs(px - this.x) <= this.halfX && Math.abs(pz - this.z) <= this.halfZ;
  }
}
