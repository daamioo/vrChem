import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { ConfigLoader } from './core/ConfigLoader.js';
import { World } from './core/World.js';
import { ChemicalDatabase } from './chemistry/Chemical.js';
import { ReactionDatabase } from './chemistry/Reaction.js';
import { ReactionEngine } from './chemistry/ReactionEngine.js';
import { ConfigValidator } from './chemistry/ConfigValidator.js';
import { AudioService } from './audio/AudioService.js';
import { ParticleHub } from './effects/ParticleSystem.js';
import { FoamSplats } from './effects/FoamSplats.js';
import { HeadInsideFade } from './effects/HeadInsideFade.js';
import { InteractionSystem } from './input/InteractionSystem.js';
import { XRHand } from './input/XRHand.js';
import { DesktopHand } from './input/DesktopHand.js';
import { DesktopRig } from './input/DesktopRig.js';
import { XRLocomotion } from './input/XRLocomotion.js';
import { LabFactory } from './lab/LabFactory.js';

const status = document.getElementById('status');
const say = (msg, isError = false) => { status.textContent = msg; status.classList.toggle('error', isError); status.hidden = !msg; };

async function main() {
  say('Ładowanie konfiguracji laboratorium…');
  const config = await ConfigLoader.fromUrl('./config/').loadAll();
  const { errors, warnings } = ConfigValidator.validate(config);
  warnings.forEach((w) => console.warn('[config]', w));
  if (errors.length) { console.error(errors); say(`Błędy konfiguracji:\n${errors.join('\n')}`, true); return; }

  // --- renderer / scene / camera rig
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.localClippingEnabled = true;           // liquid levels use per-material clipping planes
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1016);
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.02, 600);   // far: the factory view outside the window
  const rig = new THREE.Group();
  const start = config.settings.player.start;
  rig.position.set(start[0], start[1], start[2]);
  camera.position.y = 1.6;                         // desktop eye height; XR overrides with the real head pose
  rig.add(camera);
  scene.add(rig);

  // --- chemistry + world
  const chemicals = new ChemicalDatabase(config.chemicals);
  const reactions = new ReactionDatabase(config.reactions);
  const engine = new ReactionEngine(chemicals, reactions, config.settings);
  const world = new World({ scene, camera, renderer, config, chemicals, reactions, engine });
  world.rig = rig;
  world.audio = new AudioService();
  world.particles = new ParticleHub(scene);
  world.foamSplats = new FoamSplats(scene);
  world.input = new InteractionSystem(world);

  // --- input: desktop mouse hand by default, Touch controllers while in VR
  const desktopHand = new DesktopHand(world, renderer.domElement);
  const desktopRig = new DesktopRig(world, rig, renderer.domElement);
  const xrHands = [0, 1].map((i) => {
    const ctrl = renderer.xr.getController(i);
    const handGroup = renderer.xr.getHand(i);       // joint poses when the headset tracks bare hands
    rig.add(ctrl, handGroup);
    return new XRHand(i === 0 ? 'left' : 'right', ctrl, handGroup, scene);
  });
  const locomotion = new XRLocomotion(world, rig, xrHands);
  const headFade = new HeadInsideFade(world, camera);   // head in a wall / bench: dark view, orange edge
  world.input.hands = [desktopHand];

  renderer.xr.addEventListener('sessionstart', () => {
    world.audio.unlock();
    desktopHand.marker.visible = false;
    world.input.hands = xrHands;
    camera.position.y = 0;
    camera.rotation.x = 0;
  });
  renderer.xr.addEventListener('sessionend', () => {
    desktopHand.marker.visible = true;
    for (const h of xrHands) h.hideVisuals();
    world.input.hands = [desktopHand];
    camera.position.y = 1.6;
  });
  window.addEventListener('pointerdown', () => world.audio.unlock(), { once: true });
  window.addEventListener('keydown', () => world.audio.unlock(), { once: true });

  // --- the lab
  const factory = new LabFactory(world);
  factory.buildAll();
  world.bus.on('lab:respawn', ({ object }) => factory.respawn(object));
  world.bus.on('lab:spawn', ({ item }) => factory.spawn(item));

  const vrButton = VRButton.createButton(renderer, { optionalFeatures: ['hand-tracking'] });
  vrButton.addEventListener('click', () => world.audio.unlock());
  document.body.appendChild(vrButton);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- main loop
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    desktopRig.update(dt);
    if (renderer.xr.isPresenting) locomotion.update(dt);
    else world.particles.setScale((renderer.domElement.height / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    if (renderer.xr.isPresenting) world.particles.setScale(900);
    rig.updateMatrixWorld(true);                   // hands read their pose through the rig this frame
    world.update(dt);
    headFade.update(dt);
    renderer.render(scene, camera);
  });

  say('');
  window.chemlab = { world, factory, headFade, THREE };   // handy for console debugging
}

main().catch((e) => { console.error(e); say(`Nie udało się uruchomić: ${e.message}`, true); });
