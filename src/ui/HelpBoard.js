import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { CanvasPanel } from './CanvasPanel.js';

const LINES = [
  ['STEROWANIE VR', true],
  ['Chwyt (boczny przycisk) lub ŚCISK (kciuk + wskazujący): chwyć', false],
  ['Dłonie: kciuk + środkowy = spust, kciuk + serdeczny = chód,', false],
  ['kciuk + mały = obrót (lewa / prawa dłoń)', false],
  ['Przechyl butelkę nad zlewką, aby nalać', false],
  ['Chwyć pokrętło i zakreśl dłonią okrąg, aby nim kręcić', false],
  ['Lewa gałka: chód   Prawa gałka: obrót', false],
  ['Chwyć powietrze i pociągnij, by się przesunąć; obiema', false],
  ['dłońmi naraz: obróć je wokół siebie, by się obrócić', false],
  ['', false],
  ['WSKAZÓWKI', true],
  ['Postaw zlewkę na wadze: sama się wytaruje,', false],
  ['potem odmierz proszek, wsypując go.', false],
  ['Zanurz bagietkę i mieszaj; niektóre reakcje', false],
  ['zachodzą tylko przy mieszaniu lub grzaniu.', false],
  ['Odpady wylewaj do zielonego kosza.', false],
  ['Wrzuć przedmioty do niebieskiej skrzyni, by wróciły na miejsce.', false],
  ['Pociągnij żółty uchwyt płukanki, aby poleciała woda.', false],
  ['Tablica za Tobą: dotknij końcówką markera, by pisać;', false],
  ['gąbką wycierasz. Gąbka przywiera do tablicy.', false],
  ['Gaśnica: chwyć i trzymaj spust, by pryskać pianą.', false],
  ['Butle z gazem: chwyć kółko zaworu i przekręć w lewo,', false],
  ['by odkręcić (w prawo zakręca). Szkło pęka przy upadku!', false],
  ['Piłka: rzucaj, odbija się; ściśnij spustem lub zaciśnij palce.', false],
  ['Mocno trafiona zlewka przewraca się i wylewa zawartość.', false],
  ['', false],
  ['TRYB TESTOWY NA PC', true],
  ['Prawy przycisk myszy: rozglądanie, WASD: ruch, lewy klik:', false],
  ['chwyć (na pokrętle: ruch okrężny), kółko = głębokość,', false],
  ['Q/E = przechył, Spacja = spust', false],
];

class HelpPanel extends CanvasPanel {
  constructor(w, h) { super(w, h, 520); this.redraw(); }
  draw(ctx, w, h) {
    ctx.fillStyle = '#16233a'; ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'top';
    let y = h * 0.04;
    const step = Math.min(h * 0.043, (h * 0.92) / LINES.length);
    for (const [text, head] of LINES) {
      ctx.fillStyle = head ? '#fbbf24' : '#e5e7eb';
      ctx.font = `${head ? 'bold ' : ''}${step * 0.82}px sans-serif`;
      ctx.fillText(text, w * 0.04, y);
      y += step;
    }
  }
}

/** Instruction board. */
export class HelpBoard extends Entity {
  constructor(world, def) {
    super(world);
    this.panel = new HelpPanel(def.size[0], def.size[1]);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(def.size[0] + 0.06, def.size[1] + 0.06, 0.03), new THREE.MeshStandardMaterial({ color: 0x252a32 }));
    frame.position.z = -0.018;
    this.object3D.add(frame, this.panel.mesh);
    this.object3D.position.set(...def.position);
    this.object3D.rotation.y = THREE.MathUtils.degToRad(def.rotationY ?? 0);
  }
}
