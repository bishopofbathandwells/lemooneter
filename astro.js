// Astronomy for Lemooneter. Pure functions, no DOM. Importable from both the
// main app and the tests page.
//
// Adapted from SunCalc-style formulas (Meeus, "Astronomical Algorithms").
// Accuracy: ~1 min for rise/set; phase model is a fixed-synodic-period mean
// cycle (no perturbation terms) so it can drift up to ~13 hours over a 2-3
// year span. See tests.html for the cross-check against NASA event times.

export const DAY_MS = 86_400_000;
export const SYNODIC = 29.530588853;
export const REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14, 0); // 2000-01-06 18:14 UTC
export const RAD = Math.PI / 180;

// ───────────────────────────────────────────────────────── phase

export function moonPhaseFraction(date) {
  let p = ((date.getTime() - REF_NEW_MOON) / DAY_MS / SYNODIC) % 1;
  if (p < 0) p += 1;
  return p; // 0..1, 0=new, 0.5=full
}

export function illumination(phase) {
  return (1 - Math.cos(2 * Math.PI * phase)) / 2;
}

export function phaseName(phase) {
  const eps = 0.018;
  if (phase < eps || phase > 1 - eps) return "New moon";
  if (Math.abs(phase - 0.25) < eps) return "First quarter";
  if (Math.abs(phase - 0.5)  < eps) return "Full moon";
  if (Math.abs(phase - 0.75) < eps) return "Last quarter";
  if (phase < 0.25) return "Waxing crescent";
  if (phase < 0.5)  return "Waxing gibbous";
  if (phase < 0.75) return "Waning gibbous";
  return "Waning crescent";
}

export function daysUntilFractional(now, target) {
  const cycles = (now.getTime() - REF_NEW_MOON) / DAY_MS / SYNODIC;
  const frac = cycles - Math.floor(cycles);
  let delta = target - frac;
  if (delta <= 0) delta += 1;
  return delta * SYNODIC;
}

// Returns the phase target (0, 0.25, 0.5, 0.75) if a phase event falls within
// the given local day; otherwise null. Used to mark new/quarter/full days in
// the calendar grid.
export function phaseEventOnDay(date) {
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  const end   = new Date(start); end.setDate(end.getDate() + 1);
  const cStart = (start.getTime() - REF_NEW_MOON) / DAY_MS / SYNODIC;
  const cEnd   = (end.getTime()   - REF_NEW_MOON) / DAY_MS / SYNODIC;
  for (const target of [0, 0.25, 0.5, 0.75]) {
    const k = Math.ceil(cStart - target);
    const t = k + target;
    if (t >= cStart && t < cEnd) return target;
  }
  return null;
}

export function formatDuration(days) {
  const totalH = days * 24;
  const d = Math.floor(totalH / 24);
  const h = Math.round(totalH - d * 24);
  if (d === 0) return `${h} h`;
  if (h === 0) return `${d} d`;
  return `${d} d ${h} h`;
}

// ───────────────────────────────────────────────────────── position / rise-set

export function toJulian(date) { return date.getTime() / DAY_MS - 0.5 + 2440588; }
export function fromJulian(j)  { return new Date((j + 0.5 - 2440588) * DAY_MS); }
export function toDays(date)   { return toJulian(date) - 2451545; }

const e_obliquity = 23.4397 * RAD;

function rightAscension(l, b) {
  return Math.atan2(Math.sin(l) * Math.cos(e_obliquity) - Math.tan(b) * Math.sin(e_obliquity), Math.cos(l));
}
function declination(l, b) {
  return Math.asin(Math.sin(b) * Math.cos(e_obliquity) + Math.cos(b) * Math.sin(e_obliquity) * Math.sin(l));
}
function altitude(H, phi, dec) {
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
}
function siderealTime(d, lw) { return (280.16 + 360.9856235 * d) * RAD - lw; }

function moonCoords(d) {
  const L = (218.316 + 13.176396 * d) * RAD;
  const M = (134.963 + 13.064993 * d) * RAD;
  const F = (93.272  + 13.229350 * d) * RAD;
  const lon = L + 6.289 * RAD * Math.sin(M);
  const lat = 5.128 * RAD * Math.sin(F);
  const dt  = 385001 - 20905 * Math.cos(M);
  return { ra: rightAscension(lon, lat), dec: declination(lon, lat), dist: dt };
}

export function moonAltitude(date, lat, lon) {
  const lw = -lon * RAD;
  const phi = lat * RAD;
  const d  = toDays(date);
  const c  = moonCoords(d);
  const H  = siderealTime(d, lw) - c.ra;
  const h  = altitude(H, phi, c.dec);
  return h - Math.asin(6378.137 / c.dist) * Math.cos(h); // parallax correction
}

export function moonTimes(date, lat, lon) {
  const t = new Date(date);
  t.setHours(0, 0, 0, 0);
  const h0 = -0.583 * RAD; // standard horizon: refraction + moon size approx
  let rise = null, set = null;
  let prevAlt = moonAltitude(t, lat, lon) - h0;
  for (let i = 1; i <= 24; i++) {
    const next = new Date(t.getTime() + i * 3600_000);
    const a = moonAltitude(next, lat, lon) - h0;
    if (prevAlt < 0 && a >= 0 && rise == null) rise = bisect(t, i - 1, i, lat, lon, h0);
    if (prevAlt >= 0 && a < 0 && set == null)  set  = bisect(t, i - 1, i, lat, lon, h0);
    prevAlt = a;
    if (rise && set) break;
  }
  return {
    rise, set,
    alwaysUp:   rise == null && set == null && prevAlt > 0,
    alwaysDown: rise == null && set == null && prevAlt <= 0,
  };
}

function bisect(base, h1, h2, lat, lon, h0) {
  let lo = h1, hi = h2;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const a   = moonAltitude(new Date(base.getTime() + mid * 3600_000), lat, lon) - h0;
    const aLo = moonAltitude(new Date(base.getTime() + lo  * 3600_000), lat, lon) - h0;
    if ((aLo < 0 && a >= 0) || (aLo >= 0 && a < 0)) hi = mid; else lo = mid;
  }
  return new Date(base.getTime() + ((lo + hi) / 2) * 3600_000);
}
