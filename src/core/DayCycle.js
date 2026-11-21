/**
 * Time-of-day model (pure functions, no THREE): given the hour (0..24) it says how high the sun
 * is, how much daylight there is, and what colours the sky, haze and outdoor light have.
 * Night / day / dusk palettes are blended smoothly, so the world changes gradually.
 */
const lerp = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** -1 (midnight) .. 1 (noon); 0 at 06:00 and 18:00. */
export function sunElevation(hours) { return Math.sin(((hours - 6) / 12) * Math.PI); }

/** 0 at night .. 1 in full day. */
export function daylight(hours) { return smooth(-0.12, 0.3, sunElevation(hours)); }

/** 1 around sunrise / sunset, 0 otherwise. */
export function duskness(hours) { const e = sunElevation(hours); return Math.exp(-(((e - 0.02) / 0.17) ** 2)); }

const SKY = {
  night: { zenith: [0.01, 0.015, 0.04], mid: [0.03, 0.04, 0.09], horizon: [0.08, 0.08, 0.13] },
  day: { zenith: [0.18, 0.42, 0.78], mid: [0.45, 0.65, 0.88], horizon: [0.78, 0.86, 0.93] },
  dusk: { zenith: [0.09, 0.12, 0.24], mid: [0.40, 0.33, 0.45], horizon: [0.93, 0.55, 0.33] },
};
const FOG = { night: [0.07, 0.075, 0.1], day: [0.66, 0.72, 0.78], dusk: [0.5, 0.44, 0.47] };

function blend(set, hours) {
  const dl = daylight(hours), dk = duskness(hours) * 0.85;
  return (key) => mix3(mix3(set.night[key] ?? set.night, set.day[key] ?? set.day, dl), set.dusk[key] ?? set.dusk, dk);
}

/** Sky gradient colours, each [r,g,b] 0..1. */
export function skyColors(hours) {
  const b = blend(SKY, hours);
  return { zenith: b('zenith'), mid: b('mid'), horizon: b('horizon') };
}

export function fogColor(hours) {
  const dl = daylight(hours), dk = duskness(hours) * 0.85;
  return mix3(mix3(FOG.night, FOG.day, dl), FOG.dusk, dk);
}

/** Brightness (0.1..1) and colour tint of the light outdoors. */
export function outdoorLight(hours) {
  const dl = daylight(hours), dk = duskness(hours);
  return { level: 0.1 + 0.9 * dl, tint: mix3(mix3([0.55, 0.62, 0.9], [1, 1, 1], dl), [1, 0.82, 0.7], dk * 0.7) };
}

/**
 * Sun direction in the view's local frame (+X out of the window, Y up): it rises to the left
 * (-Z), is straight out at noon and sets to the right (+Z). Returned as [x, y, z] (not normalised).
 */
export function sunDirection(hours) {
  const az = ((hours - 6) / 12) * Math.PI;
  return [0.75, sunElevation(hours) * 0.9, -Math.cos(az)];
}

/** "HH:MM" */
export function formatTime(hours) {
  const m = Math.floor((((hours % 24) + 24) % 24) * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
