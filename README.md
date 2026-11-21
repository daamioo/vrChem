# VR Chemistry Lab (Meta Quest, WebXR)

An interactive chemistry lab: grab beakers, flasks and test tubes, pour powders and liquids,
weigh on a scale, heat on a hot plate, stir, and discover reactions. Runs in the Quest Browser
(Three.js + WebXR, no build step).

## Run
```
npm start                      # http://localhost:8000
adb reverse tcp:8000 tcp:8000  # Quest connected by USB; then open http://localhost:8000 in the Quest Browser
```
Or `npm run cert && npm run start:https` and open `https://<your-LAN-ip>:8000` on the Quest.
Press **Enter VR**. On a PC the page works as a desktop test mode (right-drag look, WASD,
left-click grab/press, wheel depth, Q/E tilt).

## Controls (Quest)
Grip = grab · tilt to pour · grip a dial and circle your hand to turn it · left stick walk · right stick snap-turn.
**Grab-the-world movement:** grip (or pinch, with bare hands) empty air and pull to drag yourself through the lab; with both hands, rotate them around each other to turn. The hand turns blue while you're moving (`player.grabMove` in `settings.json` switches it off).
**Glass breaks:** glassware dropped from table height, thrown against a wall or slammed hard onto a table shatters into fragments and spills its contents; it reappears at its starting spot after `breakage.respawnS` seconds (`breakage.impactSpeed` sets the threshold; `"breakable": false` on an equipment entry opts out).
**Rubber balls** (main bench, right end): throw them — they bounce off floor, tables and walls and roll off edges. Squeeze one while holding it: trigger on a controller, curl your fingers into a fist with bare hands, Space on desktop. It squashes and squeaks. A ball that hits glassware hard enough knocks it over (easier when it hits high up or the vessel is light/empty) and the contents pour out; a gentle hit makes it wobble and slide. You can also swat things with a held ball. Pick a tipped vessel up to stand it upright again (`knock.tipSpeed` in `settings.json` sets how hard a hit has to be).
**Gas cylinders:** each has a handwheel valve. Grip it and twist (or circle your hand) counter-clockwise to open: gas hisses out of the outlet as a jet of mist, stronger the further it's open. Clockwise closes. Cylinders are set in `lab.json` → `decor` → `GasCylinderRack.cylinders`.
No buttons: the scale auto-zeroes the vessel you set on it, the hot plate has a physical dial (OFF, then 25 °C steps), and dropping any item in the blue crate respawns it where it started. The eyewash has a latching pull ring (water jets fill containers held above them) and the fire extinguisher is a grabbable you aim and fire with the trigger (Space on desktop).

## Everything is config (`config/`)
| file | defines |
|---|---|
| `chemicals.json` | substances: molar mass, state, density, colour, solubility, boiling point |
| `reactions.json` | reactants/products (stoichiometry), catalysts, conditions (temp, stirred, liquid), speed, enthalpy, effects |
| `equipment.json` | glassware profiles (radius vs height), tools, stations -> `class` |
| `lab.json` | furniture, anchors, where each item/bottle sits, wall boards |
| `settings.json` | pour rates, thermal constants, room, locomotion |

Add a reaction by editing `reactions.json` only; `npm run validate` checks cross-references and mass balance.
Effects: `bubbles`, `foam`, `smoke`, `sparkle`, `flash`, `explosion`, `sound`; each accepts
`mode: "burst"` (with `minMoles`) or continuous (`refRate`), plus `requires` and `requiresHot`.

## Architecture (`src/`)
- `chemistry/` pure logic, no 3D: `Chemical`, `Mixture`, `Reaction`, `ReactionEngine`, `ConfigValidator` (unit-tested: `npm test`).
- `core/` `World` (services + entities), `Entity`, `EventBus`, `Registry`, `ConfigLoader`.
- `lab/` `LabObject` → `Container` → `Beaker` / `Flask` / `TestTube` / `ReagentBottle`; `Probe` → `StirRod` / `Thermometer`; stations `Scale`, `HeatPlate` (with a `Dial`), `WasteBin`, `ResetCrate`; `LabFactory` builds the lab from config through class registries.
- `physics/` gravity and `Surface`s (tables, scale pad, hot plate with a temperature).
- `input/` abstract `Hand` with `XRHand` and `DesktopHand`; `InteractionSystem`, locomotion.
- `effects/` `Effect` subclasses + registry, GPU particles; `audio/` procedural sounds; `ui/` canvas panels, notebook, help board.

New equipment type: subclass `LabObject`/`Entity`, register it in `LabFactory.js`, reference it from `equipment.json`.
New effect: subclass `Effect`, register it in `effects/effects.js`.
