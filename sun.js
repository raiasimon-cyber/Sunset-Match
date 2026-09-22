// Position du soleil et heure locale.
// Algorithme astronomique classique (précision de l'ordre de 0,1°), sans dépendance.

export const PARIS = { lat: 48.8566, lon: 2.3522 };
const RAD = Math.PI / 180;

export function sunPosition(date, lat = PARIS.lat, lon = PARIS.lon) {
  const d = date.getTime() / 86400000 - 10957.5;
  const M = (357.5291 + 0.98560028 * d) * RAD;
  const C = (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * RAD;
  const L = M + C + 102.9372 * RAD + Math.PI;
  const e = 23.4397 * RAD;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const H = (280.16 + 360.9856235 * d) * RAD + lon * RAD - ra;
  const phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  // alt en degrés au-dessus de l'horizon, az en degrés depuis le nord, sens horaire
  return { alt: alt / RAD, az: (az / RAD + 180 + 360) % 360 };
}

/** Direction de l'ombre (x = est, y = sud) et longueur d'ombre par mètre de hauteur. */
export function shadowVector(sun) {
  const a = sun.az * RAD;
  return { dx: -Math.sin(a), dy: Math.cos(a), k: sun.alt > 0.5 ? Math.min(1 / Math.tan(sun.alt * RAD), 25) : 0 };
}

// ---------- Heure locale (fuseau de l'appareil) ----------
export const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris';
const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
export function localParts(date = new Date()) {
  const o = {};
  partsFmt.formatToParts(date).forEach(p => { if (p.type !== 'literal') o[p.type] = +p.value; });
  return o;
}
export function today() {
  const p = localParts();
  return { y: p.year, m: p.month - 1, d: p.day };
}
export function nowMinutes() {
  const p = localParts();
  return p.hour * 60 + p.minute;
}
const offsetCache = new Map();
function offsetMinutes(day) {
  const key = `${day.y}-${day.m}-${day.d}`;
  if (offsetCache.has(key)) return offsetCache.get(key);
  let off = 60;
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' })
      .formatToParts(new Date(Date.UTC(day.y, day.m, day.d, 12)))
      .find(p => p.type === 'timeZoneName').value;
    const r = s.match(/GMT([+-]\d+)(?::(\d+))?/);
    if (r) off = +r[1] * 60 + Math.sign(+r[1] || 1) * (+r[2] || 0);
    else if (s === 'GMT') off = 0;
  } catch (e) { /* on garde +1 h */ }
  offsetCache.set(key, off);
  return off;
}
/** Date réelle correspondant à `min` minutes après minuit (heure locale), le jour `day`. */
export function dateAt(day, min) {
  return new Date(Date.UTC(day.y, day.m, day.d, 0, min) - offsetMinutes(day) * 60000);
}
export function isoDay(day) {
  return `${day.y}-${String(day.m + 1).padStart(2, '0')}-${String(day.d).padStart(2, '0')}`;
}
export function fmt(min) {
  min = Math.round(min);
  return `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
export function riseSet(day, lat = PARIS.lat, lon = PARIS.lon) {
  let rise = null, set = null, prev = sunPosition(dateAt(day, 0), lat, lon).alt;
  for (let m = 2; m < 1440; m += 2) {
    const a = sunPosition(dateAt(day, m), lat, lon).alt;
    if (prev < -0.833 && a >= -0.833) rise = m;
    if (prev >= -0.833 && a < -0.833) set = m;
    prev = a;
  }
  return { rise, set };
}
export const DIRECTIONS = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];
export const direction = az => DIRECTIONS[Math.round(az / 45) % 8];
