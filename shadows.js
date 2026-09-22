// Moteur d'ombres : à partir des bâtiments réels (tuiles vectorielles OpenStreetMap
// avec leur hauteur), calcule l'ombre portée de chaque bâtiment pour une position du soleil.
import polygonClipping from 'polygon-clipping';

const M_PER_DEG_LAT = 110540;
const MAX_SHADOW = 400; // mètres

export function makeProjector(origin) {
  const mx = 111320 * Math.cos(origin.lat * Math.PI / 180);
  return {
    toXY: (lng, lat) => [(lng - origin.lng) * mx, (origin.lat - lat) * M_PER_DEG_LAT],
    toLngLat: (x, y) => [origin.lng + x / mx, origin.lat - y / M_PER_DEG_LAT],
  };
}

/** Récupère les bâtiments chargés sur la carte, en coordonnées locales (mètres, x = est, y = sud). */
export function collectBuildings(map, sourceId, proj) {
  const feats = map.querySourceFeatures(sourceId, { sourceLayer: 'building' });
  const seen = new Set();
  const out = [];
  for (const f of feats) {
    const p = f.properties || {};
    if ((p.render_min_height || 0) > 0) continue; // parties hautes déjà couvertes par le volume principal
    const h = +(p.render_height ?? p.height ?? 10);
    if (!(h > 2)) continue;
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      const outer = poly[0];
      if (!outer || outer.length < 4) continue;
      const key = outer[0][0].toFixed(6) + outer[0][1].toFixed(6) + h;
      if (seen.has(key)) continue; // les tuiles se recouvrent : on évite les doublons
      seen.add(key);
      const ring = outer.slice(0, -1).map(([lng, lat]) => proj.toXY(lng, lat));
      let cx = 0, cy = 0;
      ring.forEach(([x, y]) => { cx += x; cy += y; });
      cx /= ring.length; cy /= ring.length;
      const rad = Math.max(...ring.map(([x, y]) => Math.hypot(x - cx, y - cy)));
      out.push({ ring, h, cx, cy, rad });
    }
  }
  return out;
}

function hull(P) {
  P = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  up.pop(); lo.pop();
  return lo.concat(up);
}
function inConvex(poly, x, y) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (c !== 0) { const sg = Math.sign(c); if (!s) s = sg; else if (sg !== s) return false; }
  }
  return true;
}
function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ombre d'un bâtiment : enveloppe de son emprise et de l'emprise projetée au sol. */
export function buildingShadow(b, sv) {
  const L = Math.min(b.h * sv.k, MAX_SHADOW);
  return hull(b.ring.concat(b.ring.map(([x, y]) => [x + sv.dx * L, y + sv.dy * L])));
}

/** Le point (x, y) est-il à l'ombre d'un bâtiment ? */
export function isShaded(buildings, x, y, sv) {
  if (!sv.k) return true;
  for (const b of buildings) {
    const reach = Math.min(b.h * sv.k, MAX_SHADOW) + b.rad + 2;
    if (Math.abs(b.cx - x) > reach || Math.abs(b.cy - y) > reach) continue;
    if (inRing(b.ring, x, y)) continue; // point posé sur la façade de son propre immeuble
    if (inConvex(buildingShadow(b, sv), x, y)) return true;
  }
  return false;
}

/** Couche GeoJSON des ombres (fusionnées pour éviter les zones sur-assombries). */
export function shadowGeoJSON(buildings, sv, proj, view) {
  if (!sv.k) return { type: 'FeatureCollection', features: [] };
  const polys = [];
  for (const b of buildings) {
    const L = Math.min(b.h * sv.k, MAX_SHADOW);
    if (b.cx + b.rad + L < view.x0 || b.cx - b.rad - L > view.x1 || b.cy + b.rad + L < view.y0 || b.cy - b.rad - L > view.y1) continue;
    const h = buildingShadow(b, sv);
    polys.push([h.concat([h[0]])]);
  }
  let geom;
  try {
    const merged = polys.length ? polygonClipping.union(...polys) : [];
    geom = merged.map(poly => poly.map(ring => ring.map(([x, y]) => proj.toLngLat(x, y))));
  } catch (e) {
    geom = polys.map(poly => poly.map(ring => ring.map(([x, y]) => proj.toLngLat(x, y))));
  }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: geom } }] };
}
