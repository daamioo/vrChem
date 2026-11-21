import * as THREE from 'three';
import { Registry } from '../core/Registry.js';
import { Room } from './Room.js';
import { Table } from './Table.js';
import { Beaker } from './Beaker.js';
import { Flask } from './Flask.js';
import { TestTube } from './TestTube.js';
import { ReagentBottle } from './ReagentBottle.js';
import { StirRod } from './StirRod.js';
import { Thermometer } from './Thermometer.js';
import { Scale } from './Scale.js';
import { HeatPlate } from './HeatPlate.js';
import { WasteBin } from './WasteBin.js';
import { ResetCrate } from './ResetCrate.js';
import { NotebookBoard } from '../ui/NotebookBoard.js';
import { HelpBoard } from '../ui/HelpBoard.js';
import { ReactionEffectSystem } from '../effects/ReactionEffectSystem.js';
import { Whiteboard } from './Whiteboard.js';
import { Marker } from './Marker.js';
import { Eraser } from './Eraser.js';
import { EyewashStation } from './EyewashStation.js';
import { FireExtinguisher } from './FireExtinguisher.js';
import { BouncyBall } from './BouncyBall.js';
import { GasCylinderRack } from './GasCylinderRack.js';
import { Cat } from './Cat.js';
import { Lighter } from './Lighter.js';
import { FactoryVista } from './FactoryVista.js';
import { BunsenBurner } from './BunsenBurner.js';
import { FlameTestLoop } from './FlameTestLoop.js';
import { Splint } from './Splint.js';
import { PhStrip } from './PhStrip.js';
import { PhStripBox } from './PhStripBox.js';
import { Pipette } from './Pipette.js';
import { Burette } from './Burette.js';
import { PhChart } from '../ui/PhChart.js';
import { Radio } from './Radio.js';
import { ResetButton } from './ResetButton.js';
import { decorRegistry } from './Decor.js';

/** Maps the `"class"` strings in config files to implementations. Add new equipment types here. */
export const equipmentRegistry = new Registry('equipment class')
  .register('Beaker', Beaker).register('Flask', Flask).register('TestTube', TestTube)
  .register('ReagentBottle', ReagentBottle).register('StirRod', StirRod).register('Thermometer', Thermometer)
  .register('Scale', Scale).register('HeatPlate', HeatPlate).register('WasteBin', WasteBin).register('ResetCrate', ResetCrate).register('FireExtinguisher', FireExtinguisher)
  .register('Marker', Marker).register('Eraser', Eraser).register('BouncyBall', BouncyBall).register('Lighter', Lighter)
  .register('BunsenBurner', BunsenBurner).register('FlameTestLoop', FlameTestLoop).register('Splint', Splint)
  .register('PhStrip', PhStrip).register('PhStripBox', PhStripBox).register('Pipette', Pipette).register('Burette', Burette).register('Radio', Radio);

decorRegistry.register('EyewashStation', EyewashStation).register('GasCylinderRack', GasCylinderRack).register('Cat', Cat).register('FactoryVista', FactoryVista).register('ResetButton', ResetButton);
export const furnitureRegistry = new Registry('furniture class').register('Table', Table);
export const boardRegistry = new Registry('board class').register('NotebookBoard', NotebookBoard).register('HelpBoard', HelpBoard).register('Whiteboard', Whiteboard).register('PhChart', PhChart);

/** Builds the whole lab from config/lab.json + config/equipment.json. */
export class LabFactory {
  constructor(world) {
    this.world = world;
    this.lab = world.config.lab;
    this.equipment = world.config.equipment;
    world.factory = this;
  }

  buildAll() {
    const w = this.world;
    w.add(new Room(w));
    w.add(new ReactionEffectSystem(w));
    for (const f of this.lab.furniture ?? []) w.add(furnitureRegistry.create(f.class, w, f));
    for (const b of this.lab.boards ?? []) w.add(boardRegistry.create(b.class, w, b));
    this.decor = [];
    for (const d of this.lab.decor ?? []) this.decor.push({ def: d, entity: w.add(decorRegistry.create(d.class, w, d)) });
    this.buildItems();
  }

  /**
   * Puts the room back the way it started: every item back at its spot with its starting contents
   * (extra pH strips, broken glass and foam cleared), stations and the gas rack back to off with
   * valves shut and fires out, the cat back to its own colours. Kept as they are: the room, benches,
   * wall boards (notebook progress, whiteboard drawing), the view outside, and anything marked
   * `persistent` (the radio keeps playing, the reset button itself).
   */
  resetRoom() {
    const w = this.world;
    for (const h of w.input?.hands ?? []) {
      if (h.heldControl) { h.heldControl.endGrab?.(); h.heldControl = null; }
      if (h.held) w.input.release(h, false);
      h.airGrab = false;
    }
    w._timers = [];                                   // e.g. pending respawns of broken glass
    const keptItems = new Set();
    for (const e of [...w.entities]) {
      if (e.persistent) { if (e.spawnItem) keptItems.add(e.spawnItem); continue; }
      if (e.tags.has('labobject') || e.spawnItem !== undefined || e.isDebris) w.remove(e);
    }
    for (const d of this.decor) {
      if (d.entity.persistent || d.def.class === 'FactoryVista' || d.def.class === 'CeilingPipes') continue;
      w.remove(d.entity);
      d.entity = w.add(decorRegistry.create(d.def.class, w, d.def));
    }
    w.foamSplats?.clear();
    for (const item of this.lab.items ?? []) if (!keptItems.has(item)) this.spawn(item);
    w.bus.emit('lab:reset', {});
  }

  buildItems() {
    for (const item of this.lab.items ?? []) this.spawn(item);
  }

  /** Puts one item back where it started (items dropped in the ResetCrate). */
  respawn(entity) {
    const item = entity.spawnItem;
    this.world.remove(entity);
    if (item) this.spawn(item);
  }

  /** Resolves an item's position from `position` or `anchor`+`slot`+`offset`. */
  resolvePosition(item) {
    if (item.position) return new THREE.Vector3(...item.position);
    const a = this.lab.anchors[item.anchor];
    const p = new THREE.Vector3(...a.origin).addScaledVector(new THREE.Vector3(...a.step), item.slot ?? 0);
    if (item.offset) p.add(new THREE.Vector3(...item.offset));
    return p;
  }

  spawn(item) {
    const def = this.equipment[item.equipment];
    const entity = equipmentRegistry.create(def.class, this.world, def, item.equipment);
    const p = this.resolvePosition(item);
    entity.object3D.position.copy(p);
    if (item.rotationY != null) entity.object3D.rotation.y = THREE.MathUtils.degToRad(item.rotationY);
    entity.spawnItem = item;
    this.world.add(entity);

    if (item.chemical && entity.setChemical) entity.setChemical(item.chemical);
    if (item.contents && entity.setContents) entity.setContents(item.contents);
    if (entity.faceToward) {
      const s = this.world.settings.player.start;
      entity.faceToward(s[0], s[2]);
    }
    return entity;
  }
}
