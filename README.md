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
**Radio** (left bench, front end): plays one song on a seamless loop, forever, as 3D sound coming from the radio. Turn the knob on top: fully left = off, then louder. Put your song at `audio/radio.mp3` (or set `file` on the `radio` entry in `equipment.json`; .mp3/.ogg/.m4a/.wav work). It starts after the first click / Enter VR (browser audio rule); the display shows "BRAK PLIKU" if the file is missing.
**Experiments bench:**
- **Bunsen burner** (main bench, right): turn the yellow tap handwheel for gas, light the barrel top with the lighter or a burning splint; twist the brass collar for air (closed = yellow luminous flame, open = hot blue roar). Vessels on the tripod gauze heat up, and so does anything held in the flame. Shut the gas to put it out.
- **Flame tests**: dip a wire loop (main bench, back left) into a powder jar or solution, hold it in the flame — copper burns green, sodium orange, potassium lilac, calcium brick red; magnesium and iron throw sparks (`flameColor` / `flameSparks` in `chemicals.json`).
- **Gas tests**: glassware collects gas — mouth-down over a cylinder jet, or from reactions inside it (Mg + HCl → hydrogen, H₂O₂ → oxygen, baking soda + acid → CO₂). Hydrogen escapes from an upright tube (keep it upside down); heavier gases stay. A flame at the mouth of a hydrogen tube pops. Wooden splints (main bench, back left): light one, it burns down to a glowing ember (or shake it out); an ember relights in oxygen, a burning splint goes out in CO₂.
- **pH**: grab the pH paper box (right bench) to pull out a strip, dip it — it takes the universal-indicator colour; compare with the pH chart on the back wall. The universal indicator bottle colours a whole solution by pH. pH comes from `ph` in `chemicals.json` (acid/base cancel mole for mole).
- **Pipette & burette** (right bench): squeeze the pipette bulb with the trigger (curl fingers / Space), dip, release to suck liquid up; squeeze gently over a vessel for single drops. Pour into the burette's funnel, put a flask under the tip and turn the blue stopcock — a little for drops, more for a stream; its scale reads 0 at the top.
**Window** (right wall, above the bench): the lab is on an upper floor overlooking an animated chemical plant at dusk — factory halls with lit windows and spinning roof vents, smoking chimneys with blinking aircraft lights, steaming cooling towers, a flare stack, a tank farm, a gantry crane working a container yard, a conveyor bridge, trucks on the road and a freight train. All procedural (`src/lab/FactoryVista.js`); windows are set in `lab.json` → `windows` (per wall, `u` along the wall and `v` height in metres) and the view in `decor` → `FactoryVista`.
**Lighter** (right bench, front end): grab it and press the trigger (Space on desktop) to strike a flame; it stays lit while the trigger is held and always burns upward. Hold it in a gas cylinder's jet: hydrogen catches fire and burns as a roaring jet until you shut the valve or hit it with extinguisher foam; oxygen makes the lighter flare; CO₂ blows it out. What each gas does comes from `combustion` in `chemicals.json` (`fuel` / `oxidizer` / `smothers`).
**Cat** (back-right corner, on a cat-tree perch): pet it by moving your open hand (or the desktop cursor) along its back or head — no grip needed. Stroking makes it purr (the controller rumbles with it), squint, relax its tail and lean into your hand; head scratches work best, stroking tail-to-head makes its ears flick. It watches nearby hands and meows when you come over. Rub a whiteboard marker on it to dye its fur that colour; rub it with the board eraser to clean it back. Placed in `lab.json` → `decor` → `Cat` (`furColor`, `stripeColor`, `eyeColor`, `perchHeight`, …).
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
