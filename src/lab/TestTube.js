import { Container } from './Container.js';

/** Small round-bottomed tube: easy to grab, small capacity. */
export class TestTube extends Container {
  build() {
    super.build();
    this.grabRadius = 0.035;      // generous: tubes are thin
  }
}
