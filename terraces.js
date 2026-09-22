// Terrasses réelles.
// À Paris : Paris Data, jeu « terrasses-autorisations » (Licence ODbL).
// Partout ailleurs, et en secours à Paris : OpenStreetMap via Overpass (cafés et bars avec outdoor_seating=yes).

const PARIS_API = 'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/terrasses-autorisations/records';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
let loggedKeys = false;

// Les noms de champs du jeu de données peuvent évoluer : on essaie plusieurs clés.
const pick = (r, keys) => { for (const k of keys) if (r[k] != null && String(r[k]).trim()) return String(r[k]).trim(); return null; };
const titleCase = s => s ? s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : s;

function normalizeParis(r) {
  if (!loggedKeys) { console.debug('[Sunset&Match] champs Paris Data :', Object.keys(r)); loggedKeys = true; }
  const g = r.geo_point_2d;
  if (!g || g.lat == null) return null;
  const typ = (pick(r, ['typologie', 'type', 'type_terrasse']) || '').toUpperCase();
  if (!typ.includes('TERRASSE') || typ.includes('FERM')) return null; // on garde les terrasses ouvertes
  const name = pick(r, ['nom_enseigne', 'enseigne', 'nom_de_l_enseigne', 'nom_commerce', 'nom_societe', 'raison_sociale']);
  const address = pick(r, ['adresse', 'adresse_complete', 'lieu', 'voie']);
  return {
    id: 'p-' + (name || '') + '-' + g.lat.toFixed(5) + g.lon.toFixed(5),
    name: titleCase(name) || 'Terrasse',
    address: titleCase(address),
    kind: typ.includes('ESTIVAL') ? 'Terrasse estivale' : 'Terrasse',
    lng: g.lon, lat: g.lat,
  };
}

async function fromParis(b) {
  const out = [];
  const where = `in_bbox(geo_point_2d, ${b.s}, ${b.w}, ${b.n}, ${b.e})`;
  for (let offset = 0; offset < 600; offset += 100) {
    const url = `${PARIS_API}?where=${encodeURIComponent(where)}&limit=100&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Paris Data a répondu ${res.status}`);
    const j = await res.json();
    (j.results || []).forEach(r => { const t = normalizeParis(r); if (t) out.push(t); });
    if (!j.results || j.results.length < 100) break;
  }
  return dedupe(out);
}

async function fromOSM(b) {
  const q = `[out:json][timeout:20];
    nwr["amenity"~"^(cafe|bar|pub|restaurant|biergarten)$"]["outdoor_seating"="yes"](${b.s},${b.w},${b.n},${b.e});
    out center 400;`;
  const res = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!res.ok) throw new Error(`Overpass a répondu ${res.status}`);
  const j = await res.json();
  const kinds = { cafe: 'Café', bar: 'Bar', pub: 'Bar', restaurant: 'Restaurant', biergarten: 'Bar' };
  return j.elements.map(e => {
    const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
    if (lat == null) return null;
    const t = e.tags || {};
    const addr = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
    return { id: 'o-' + e.id, name: t.name || kinds[t.amenity] || 'Terrasse', address: addr || null, kind: kinds[t.amenity] || 'Terrasse', lng, lat };
  }).filter(Boolean);
}

// Une même adresse a souvent plusieurs autorisations (terrasse + contre-terrasse) : on regroupe.
function dedupe(list) {
  const kept = [];
  for (const t of list) {
    const twin = kept.find(k => k.name === t.name && Math.abs(k.lat - t.lat) < 0.00015 && Math.abs(k.lng - t.lng) < 0.0002);
    if (!twin) kept.push(t);
  }
  return kept;
}

const cache = new Map();
/** Charge les terrasses d'une zone {w,s,e,n}. Renvoie { list, source }. */
export async function loadTerraces(bounds) {
  const r = v => v.toFixed(3);
  const key = [bounds.w, bounds.s, bounds.e, bounds.n].map(r).join(',');
  if (cache.has(key)) return cache.get(key);
  // Paris Data ne couvre que Paris : ailleurs, on passe directement par OpenStreetMap.
  const inParis = bounds.s > 48.80 && bounds.n < 48.91 && bounds.w > 2.22 && bounds.e < 2.48;
  if (!inParis) {
    const result = { list: await fromOSM(bounds), source: 'OpenStreetMap' };
    cache.set(key, result);
    return result;
  }
  let result;
  try {
    const list = await fromParis(bounds);
    result = list.length ? { list, source: 'Paris Data' } : { list: await fromOSM(bounds), source: 'OpenStreetMap' };
  } catch (e) {
    console.warn('[Sunset&Match] Paris Data indisponible, bascule sur OpenStreetMap', e);
    result = { list: await fromOSM(bounds), source: 'OpenStreetMap' };
  }
  cache.set(key, result);
  return result;
}
