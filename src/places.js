// Lieux réels autour de l'utilisateur (OpenStreetMap) pour l'onglet « Pour toi » :
// parcs, jardins, musées, galeries, points de vue et marchés.

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const cache = new Map();

function category(t) {
  if (t.tourism === 'viewpoint') return 'viewpoint';
  if (t.tourism === 'museum') return 'museum';
  if (t.tourism === 'gallery') return 'gallery';
  if (t.amenity === 'marketplace') return 'market';
  if (t.leisure === 'garden') return 'garden';
  if (t.leisure === 'park') return 'park';
  return null;
}

export async function loadPlaces(lat, lng) {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  if (cache.has(key)) return cache.get(key);
  const d = 0.018; // environ 2 km autour
  const bb = `${lat - d},${lng - d * 1.5},${lat + d},${lng + d * 1.5}`;
  const q = `[out:json][timeout:20];
    (
      nwr["leisure"~"^(park|garden)$"]["name"]["access"!="private"](${bb});
      nwr["tourism"~"^(museum|gallery|viewpoint)$"]["name"](${bb});
      nwr["amenity"="marketplace"]["name"](${bb});
    );
    out center 300;`;
  const res = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!res.ok) throw new Error(`Overpass a répondu ${res.status}`);
  const j = await res.json();
  const list = j.elements.map(e => {
    const t = e.tags || {}, cat = category(t);
    const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon;
    return cat && la != null ? { id: 'pl-' + e.id, name: t.name, cat, lat: la, lng: lo } : null;
  }).filter(Boolean);
  cache.set(key, list);
  return list;
}
