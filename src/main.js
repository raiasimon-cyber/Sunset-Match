import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { sunPosition, shadowVector, today, nowMinutes, dateAt, isoDay, fmt, riseSet, direction, PARIS } from './sun.js';
import { loadForecast, hourAt, sky, icon, label } from './weather.js';
import { loadTerraces } from './terraces.js';
import { makeProjector, collectBuildings, isShaded, shadowGeoJSON } from './shadows.js';
import { loadPlaces } from './places.js';
import { MOODS, MOOD_PLACES, PLACE_LABEL, PLACE_TEXT, PICNIC_OFFERS, EVENTS } from './content.js';

/* ============ Réglages ============ */
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
// Au démarrage : dernière position connue, sinon Paris, puis on se recentre sur l'utilisateur.
const LAST = (() => { try { return JSON.parse(localStorage.getItem('sm-last-pos')); } catch (e) { return null; } })();
const START = { center: LAST ? [LAST.lng, LAST.lat] : [PARIS.lon, PARIS.lat], zoom: 16.3, pitch: 52, bearing: -17 };
const MIN_ZOOM_DATA = 15; // en dessous, on n'affiche ni ombres ni terrasses (trop de données)
const EMPTY = { type: 'FeatureCollection', features: [] };
const COLORS = { soleil: '#F6C343', mitige: '#F3D08A', ombre: '#56627C', couvert: '#B7BFCB', nuit: '#2B3560' };

/* ============ Outils ============ */
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage plein ou bloqué */ } };
const kmBetween = (a, b) => Math.hypot((a.lng - b.lng) * 111 * Math.cos(a.lat * Math.PI / 180), (a.lat - b.lat) * 111);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* ============ État ============ */
const state = {
  day: today(),
  min: clamp(nowMinutes(), 300, 1380),
  forecastAt: null,
  places: [],
  forecast: null,
  terraces: [],
  source: '',
  sel: null,
  play: false,
  favs: load('sm-favs', []),
  moods: new Set(load('sm-moods', ['chill'])),
  offer: 'duo',
};
let SUN = riseSet(state.day, START.center[1], START.center[0]), sun, sv;
let proj = null, buildings = [], buildingSource = null;

/* ============ Carte ============ */
const map = new maplibregl.Map({
  container: 'map',
  style: STYLE_URL,
  ...START,
  maxPitch: 70,
  attributionControl: { compact: true, customAttribution: 'Terrasses © Ville de Paris (ODbL) et contributeurs OpenStreetMap, météo Open-Meteo' },
  canvasContextAttributes: { antialias: true },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'bottom-right');

map.on('load', () => {
  const layers = map.getStyle().layers;
  const bLayer = layers.find(l => l['source-layer'] === 'building');
  buildingSource = bLayer ? bLayer.source : 'openmaptiles';
  const firstLabel = layers.find(l => l.type === 'symbol')?.id;
  layers.filter(l => l.type === 'fill-extrusion').forEach(l => map.setLayoutProperty(l.id, 'visibility', 'none'));

  map.addSource('sm-shadows', { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'sm-shadows', type: 'fill', source: 'sm-shadows', paint: { 'fill-color': '#1B2557', 'fill-opacity': 0.3 } }, firstLabel);
  map.addLayer({
    id: 'sm-buildings', type: 'fill-extrusion', source: buildingSource, 'source-layer': 'building', minzoom: 14,
    paint: {
      'fill-extrusion-color': '#EFE3CB',
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.2, ['coalesce', ['get', 'render_height'], 10]],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.93,
      'fill-extrusion-vertical-gradient': true,
    },
  }, firstLabel);

  map.addSource('sm-terraces', { type: 'geojson', data: EMPTY });
  const r = (a, b) => ['interpolate', ['linear'], ['zoom'], 14, a, 18, b];
  map.addLayer({ id: 'sm-t-glow', type: 'circle', source: 'sm-terraces', filter: ['==', ['get', 'st'], 'soleil'],
    paint: { 'circle-radius': r(8, 20), 'circle-color': '#F6C343', 'circle-blur': 0.9, 'circle-opacity': 0.75 } });
  map.addLayer({ id: 'sm-t-dot', type: 'circle', source: 'sm-terraces',
    paint: {
      'circle-radius': ['case', ['==', ['get', 'st'], 'soleil'], r(4.5, 10), r(3.5, 7)],
      'circle-color': ['match', ['get', 'st'], 'soleil', COLORS.soleil, 'mitige', COLORS.mitige, 'ombre', COLORS.ombre, 'couvert', '#97A3B6', COLORS.nuit],
      'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
    } });
  map.addLayer({ id: 'sm-t-core', type: 'circle', source: 'sm-terraces', filter: ['==', ['get', 'st'], 'soleil'],
    paint: { 'circle-radius': r(1.5, 3.5), 'circle-color': '#fff' } });
  map.addLayer({ id: 'sm-t-sel', type: 'circle', source: 'sm-terraces', filter: ['==', ['get', 'id'], ''],
    paint: { 'circle-radius': r(9, 17), 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#1B2440', 'circle-stroke-width': 2.5 } });

  map.on('click', 'sm-t-dot', e => { const f = e.features[0]; if (f) openTerrace(f.properties.id); });
  map.on('mouseenter', 'sm-t-dot', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'sm-t-dot', () => { map.getCanvas().style.cursor = ''; });

  map.on('moveend', refreshArea);
  map.on('moveend', onPlaceChanged);
  map.once('idle', refreshArea);
  locateUser();
});

/* ============ Données de la zone affichée ============ */
const refreshArea = debounce(async () => {
  if (map.getZoom() < MIN_ZOOM_DATA) {
    showHint('Zoome sur un quartier pour voir les terrasses et les ombres');
    map.getSource('sm-shadows')?.setData(EMPTY);
    return;
  }
  hideHint();
  rebuildBuildings();
  const b = map.getBounds();
  const pad = 0.002;
  showHint('Chargement des terrasses…');
  try {
    const { list, source } = await loadTerraces({ w: b.getWest() - pad, s: b.getSouth() - pad, e: b.getEast() + pad, n: b.getNorth() + pad });
    state.terraces = list; state.source = source;
    list.forEach(t => { [t.x, t.y] = proj.toXY(t.lng, t.lat); });
    hideHint();
    if (!list.length) showHint('Aucune terrasse référencée ici');
  } catch (e) {
    console.error(e);
    showHint('Les terrasses n’ont pas pu être chargées. Vérifie ta connexion.');
  }
  updateSunLayers();
}, 350);

function rebuildBuildings() {
  const c = map.getCenter();
  proj = makeProjector({ lng: c.lng, lat: c.lat });
  buildings = collectBuildings(map, buildingSource, proj);
  state.terraces.forEach(t => { [t.x, t.y] = proj.toXY(t.lng, t.lat); });
}
// Les tuiles de bâtiments arrivent parfois après le déplacement : on recalcule une fois chargées.
map.on('sourcedata', debounce(e => {
  if (e.sourceId === buildingSource && e.isSourceLoaded && map.getZoom() >= MIN_ZOOM_DATA) { rebuildBuildings(); updateSunLayers(); }
}, 400));

/* ============ Soleil, météo, statut des terrasses ============ */
const here = () => { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; };
const sunAt = min => { const c = here(); return sunPosition(dateAt(state.day, min), c.lat, c.lng); };

// Quand l'utilisateur change de ville : nouvelle météo, nouveaux horaires de lever et de coucher.
function onPlaceChanged() {
  const c = here();
  if (state.forecastAt && kmBetween(c, state.forecastAt) < 10) return;
  state.forecastAt = c;
  save('sm-last-pos', c);
  SUN = riseSet(state.day, c.lat, c.lng); trackGradient();
  state.places = [];
  loadForecast(c.lat, c.lng)
    .then(f => { state.forecast = f; onTime(); if (!$('page-events').hidden) renderEvents(); })
    .catch(e => { console.warn('Météo indisponible', e); state.forecast = null; renderWxButton(); });
  onTime();
}

function locateUser() {
  if (!navigator.geolocation) { onPlaceChanged(); return; }
  showHint('Recherche de ta position…');
  navigator.geolocation.getCurrentPosition(
    p => { hideHint(); map.jumpTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 16.3 }); onPlaceChanged(); },
    () => { showHint(LAST ? 'Position indisponible : dernière ville consultée' : 'Position indisponible : voici Paris'); setTimeout(hideHint, 3500); onPlaceChanged(); },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 },
  );
}
const wxNow = () => hourAt(state.forecast, isoDay(state.day), state.min);

function statusAt(t, s, v, h) {
  if (s.alt <= 0.5) return 'nuit';
  const k = sky(h);
  if (k === 'couvert') return 'couvert';
  if (isShaded(buildings, t.x, t.y, v)) return 'ombre';
  return k === 'mitige' ? 'mitige' : 'soleil';
}

function updateSunLayers() {
  if (!map.isStyleLoaded() || !proj) return;
  const h = wxNow();
  // Ombres des bâtiments, estompées quand le ciel se couvre
  const cover = h ? h.cover / 100 : 0;
  const bounds = map.getBounds();
  const [x0, y0] = proj.toXY(bounds.getWest(), bounds.getNorth());
  const [x1, y1] = proj.toXY(bounds.getEast(), bounds.getSouth());
  const shadowOpacity = 0.34 * smooth(-0.5, 5, sun.alt) * (1 - clamp((cover - 0.3) / 0.6, 0, 1) * 0.9);
  if (map.getZoom() >= MIN_ZOOM_DATA && shadowOpacity > 0.01) {
    map.getSource('sm-shadows').setData(shadowGeoJSON(buildings, sv, proj, { x0: x0 - 100, x1: x1 + 100, y0: y0 - 100, y1: y1 + 100 }));
  } else {
    map.getSource('sm-shadows').setData(EMPTY);
  }
  map.setPaintProperty('sm-shadows', 'fill-opacity', shadowOpacity);

  // Terrasses
  let n = 0;
  const feats = state.terraces.map(t => {
    t.st = statusAt(t, sun, sv, h);
    if (t.st === 'soleil') n++;
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [t.lng, t.lat] }, properties: { id: t.id, st: t.st, name: t.name } };
  });
  map.getSource('sm-terraces').setData({ type: 'FeatureCollection', features: feats });
  map.setFilter('sm-t-sel', ['==', ['get', 'id'], state.sel || '']);
  $('count').innerHTML = state.terraces.length ? `<b>${n}</b> terrasse${n > 1 ? 's' : ''} au soleil sur ${state.terraces.length}` : '';
  if (state.sel) renderSheet();
}

function updateAmbience() {
  const h = wxNow();
  const cover = h ? h.cover / 100 : 0;
  const golden = sun.alt > -3 ? Math.max(0, 1 - Math.abs(sun.alt - 3) / 9) : 0;
  const night = smooth(1, -7, sun.alt);
  // Teinte globale : doré au coucher, gris sous les nuages, bleu la nuit
  let r = 255, g = 255, b = 255;
  const mix = (cr, cg, cb, a) => { r += (cr - r) * a; g += (cg - g) * a; b += (cb - b) * a; };
  mix(255, 190, 130, 0.45 * golden * (1 - cover * 0.8));
  mix(200, 206, 216, 0.5 * cover);
  mix(52, 64, 120, 0.8 * night);
  $('tint').style.backgroundColor = `rgb(${r | 0},${g | 0},${b | 0})`;
  $('rain').hidden = !(h && h.precip >= 0.2);
  // Éclairage des façades selon la position du soleil
  if (map.isStyleLoaded()) {
    map.setLight({
      anchor: 'map',
      position: [1.5, sun.az, clamp(90 - sun.alt, 15, 88)],
      color: golden > 0.3 ? '#FFD6A5' : '#FFFFFF',
      intensity: sun.alt > 0 ? 0.55 * (1 - cover * 0.5) : 0.2,
    });
  }
}

function onTime() {
  sun = sunAt(state.min);
  sv = shadowVector(sun);
  $('clock').textContent = fmt(state.min);
  $('time').value = state.min;
  $('sundir').textContent = sun.alt > 0.5 ? `Soleil au ${direction(sun.az)}, à ${Math.round(sun.alt)}° au-dessus de l'horizon` : 'Le soleil est couché';
  renderWxButton();
  if (!$('wxPanel').hidden) renderWxPanel();
  updateAmbience();
  updateSunLayersThrottled();
}
let pending = false;
function updateSunLayersThrottled() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; updateSunLayers(); });
}

function trackGradient() {
  const pct = m => clamp((m - 300) / 1080 * 100, 0, 100).toFixed(1) + '%';
  const r = SUN.rise || 360, s = SUN.set || 1200;
  $('time').style.setProperty('--track', `linear-gradient(90deg,#2B3560 0%,#2B3560 ${pct(r - 40)},#F29E6D ${pct(r)},#9CC6EA ${pct(r + 70)},#9CC6EA ${pct(s - 90)},#F6C343 ${pct(s - 40)},#F29E6D ${pct(s)},#2B3560 ${pct(s + 40)},#2B3560 100%)`);
  $('rise').textContent = SUN.rise ? fmt(SUN.rise) : '--';
  $('set').textContent = SUN.set ? fmt(SUN.set) : '--';
}

/* ============ Fiche terrasse ============ */
function dayProfile(t) {
  const out = [];
  for (let m = 360; m < 1380; m += 10) {
    const s = sunAt(m);
    out.push({ m, k: statusAt(t, s, shadowVector(s), hourAt(state.forecast, isoDay(state.day), m)) });
  }
  return out;
}
function statusText(t, prof) {
  const after = prof.filter(p => p.m >= state.min - 9);
  switch (t.st) {
    case 'soleil':
    case 'mitige': {
      const end = after.find(p => p.k === 'ombre' || p.k === 'nuit' || p.k === 'couvert');
      return (t.st === 'mitige' ? '⛅ Soleil entre les nuages. ' : '☀️ Au soleil. ') + (end ? `Jusqu'à ${fmt(end.m)} environ.` : 'Jusqu’au coucher.');
    }
    case 'ombre': {
      const nx = after.find(p => p.k === 'soleil' || p.k === 'mitige');
      return '🏢 À l’ombre des immeubles. ' + (nx ? `Soleil de retour vers ${fmt(nx.m)}.` : 'Plus de soleil direct aujourd’hui.');
    }
    case 'couvert': return '☁️ Ciel couvert, pas de soleil direct pour l’instant.';
    default: return '🌙 Le soleil est couché.';
  }
}
function renderSheet() {
  const t = state.terraces.find(x => x.id === state.sel);
  if (!t) return;
  const prof = dayProfile(t);
  const mins = prof.filter(p => p.k === 'soleil' || p.k === 'mitige').length * 10;
  $('shName').textContent = t.name;
  $('shMeta').textContent = [t.kind, t.address, `environ ${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} de soleil aujourd'hui`].filter(Boolean).join(', ');
  $('shStatus').textContent = statusText(t, prof);
  const pos = clamp((state.min - 360) / 1020 * 100, 0, 100);
  $('shStrip').innerHTML = prof.map(p => `<span style="width:${100 / prof.length}%;background:${COLORS[p.k]}"></span>`).join('') + `<i style="left:calc(${pos}% - 1px)"></i>`;
  const fav = state.favs.some(f => f.id === t.id);
  $('shFav').setAttribute('aria-pressed', fav);
  $('shFav').textContent = fav ? '♥ Dans tes favoris' : '♡ Ajouter aux favoris';
  $('shGo').href = `https://www.google.com/maps/dir/?api=1&destination=${t.lat},${t.lng}`;
}
function openTerrace(id) {
  state.sel = id;
  $('sheet').hidden = false;
  map.setFilter('sm-t-sel', ['==', ['get', 'id'], id]);
  renderSheet();
}
$('shClose').onclick = () => { state.sel = null; $('sheet').hidden = true; map.setFilter('sm-t-sel', ['==', ['get', 'id'], '']); };
$('shFav').onclick = () => {
  const t = state.terraces.find(x => x.id === state.sel); if (!t) return;
  const i = state.favs.findIndex(f => f.id === t.id);
  if (i >= 0) { state.favs.splice(i, 1); toast('Retirée des favoris'); }
  else { state.favs.push({ id: t.id, name: t.name, address: t.address, lng: t.lng, lat: t.lat }); toast('Ajoutée aux favoris'); }
  save('sm-favs', state.favs); renderSheet(); renderFavs();
};

/* ============ Météo ============ */
function renderWxButton() {
  const h = wxNow();
  $('wxIcon').textContent = icon(h, sun && sun.alt < -1);
  $('wxTemp').textContent = h ? `${h.temp}°` : '--°';
  $('wxLabel').textContent = state.forecast ? label(h) : 'Météo indisponible';
}
function renderWxPanel() {
  const cur = Math.floor(state.min / 60);
  const h = wxNow();
  $('wxTitle').textContent = `Météo à ${cur} h`;
  $('wxDetail').textContent = h ? `${label(h)}, ${h.cover} % de nuages${h.precip > 0 ? `, ${h.precip} mm de pluie` : ''}.` : 'Pas de prévision pour cette date (7 jours maximum).';
  let html = '';
  for (let i = 6; i <= 23; i++) {
    const hh = hourAt(state.forecast, isoDay(state.day), i * 60);
    html += `<button data-h="${i}" aria-current="${i === cur}"><span>${icon(hh, i < 7 || i > 20)}</span>${hh ? hh.temp + '°' : '–'}<small>${i}h</small></button>`;
  }
  $('wxHours').innerHTML = html;
  $('wxHours').querySelectorAll('button').forEach(b => { b.onclick = () => { state.min = +b.dataset.h * 60; onTime(); }; });
}
$('wxBtn').onclick = () => {
  const p = $('wxPanel'); p.hidden = !p.hidden;
  $('wxBtn').setAttribute('aria-expanded', String(!p.hidden));
  if (!p.hidden) renderWxPanel();
};

/* ============ Temps ============ */
$('time').addEventListener('input', () => { state.min = +$('time').value; onTime(); });
$('now').onclick = () => { setDay(today()); state.min = clamp(nowMinutes(), 300, 1380); onTime(); };
$('date').addEventListener('change', () => {
  const v = $('date').value; if (!v) return;
  const [y, m, d] = v.split('-').map(Number); setDay({ y, m: m - 1, d }); onTime();
});
function setDay(day) { state.day = day; $('date').value = isoDay(day); const c = map.getCenter(); SUN = riseSet(day, c.lat, c.lng); trackGradient(); }
let playTimer = null;
function setPlay(on) {
  state.play = on;
  $('play').textContent = on ? '❚❚' : '▶';
  $('play').setAttribute('aria-label', on ? 'Mettre en pause' : 'Faire défiler la journée');
  clearInterval(playTimer);
  if (on) {
    if (state.min >= 1380) state.min = SUN.rise || 420;
    playTimer = setInterval(() => { state.min = Math.min(1380, state.min + 4); onTime(); if (state.min >= 1380) setPlay(false); }, 120);
  }
}
$('play').onclick = () => setPlay(!state.play);

/* ============ Recherche ============ */
const runSearch = debounce(async q => {
  const box = $('results');
  if (!q) { box.hidden = true; return; }
  const local = state.terraces.filter(t => t.name.toLowerCase().includes(q.toLowerCase())).slice(0, 4)
    .map(t => ({ label: t.name, hint: t.st === 'soleil' ? '☀️ au soleil' : 'terrasse', lng: t.lng, lat: t.lat, id: t.id }));
  let places = [];
  try {
    const res = await fetch(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&limit=4&lat=${here().lat.toFixed(4)}&lon=${here().lng.toFixed(4)}`);
    if (res.ok) places = (await res.json()).features.map(f => ({ label: f.properties.label, hint: 'adresse', lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
  } catch (e) { /* recherche d'adresse indisponible */ }
  const all = [...local, ...places];
  box.innerHTML = all.length ? all.map((r, i) => `<button data-i="${i}"><span>${esc(r.label)}</span><small>${esc(r.hint)}</small></button>`).join('')
    : '<p class="note" style="padding:8px 12px;margin:0">Aucun résultat. Essaie une rue ou un nom de café.</p>';
  box.hidden = false;
  box.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      const r = all[+b.dataset.i]; box.hidden = true; $('q').value = r.label;
      switchTab('map');
      map.flyTo({ center: [r.lng, r.lat], zoom: Math.max(map.getZoom(), 17), essential: true });
      if (r.id) map.once('moveend', () => setTimeout(() => openTerrace(r.id), 500));
    };
  });
}, 300);
$('q').addEventListener('input', () => runSearch($('q').value.trim()));

/* ============ Hint ============ */
function showHint(t) { $('hint').textContent = t; $('hint').hidden = false; }
function hideHint() { $('hint').hidden = true; }

/* ============ Onglets ============ */
function switchTab(tab) {
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $('mapUi').hidden = tab !== 'map';
  ['reco', 'events', 'favs'].forEach(p => { $('page-' + p).hidden = p !== tab; });
  if (tab === 'reco') renderReco();
  if (tab === 'events') renderEvents();
  if (tab === 'favs') renderFavs();
}
document.querySelectorAll('.tabs button').forEach(b => { b.onclick = () => switchTab(b.dataset.tab); });

/* ============ Pour toi ============ */
function renderMoods() {
  $('moods').innerHTML = MOODS.map(m => `<button class="chip" data-m="${m.id}" aria-pressed="${state.moods.has(m.id)}">${m.label}</button>`).join('');
  $('moods').querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      const m = b.dataset.m;
      if (state.moods.has(m) && state.moods.size > 1) state.moods.delete(m); else state.moods.add(m);
      save('sm-moods', [...state.moods]); renderMoods(); renderReco();
    };
  });
}
function sunnyTerraceAt(min, used) {
  const s = sunAt(min), v = shadowVector(s), h = hourAt(state.forecast, isoDay(state.day), min);
  const c = map.getCenter();
  const ranked = state.terraces.filter(t => !used.has(t.id))
    .map(t => ({ t, st: statusAt(t, s, v, h), d: Math.hypot(t.lng - c.lng, t.lat - c.lat) }))
    .sort((a, b) => (a.st === 'soleil' ? 0 : a.st === 'mitige' ? 1 : 2) - (b.st === 'soleil' ? 0 : b.st === 'mitige' ? 1 : 2) || a.d - b.d);
  const best = ranked[0];
  if (best) used.add(best.t.id);
  return best ? { ...best, h } : null;
}
async function renderReco() {
  const c = here();
  if (!state.places.length) {
    $('timeline').innerHTML = '<li><p>Recherche des lieux autour de toi…</p></li>';
    try { state.places = await loadPlaces(c.lat, c.lng); } catch (e) { console.warn('Lieux indisponibles', e); state.places = []; }
  }
  const usedP = new Set(), usedT = new Set();
  const golden = SUN.set ? SUN.set - 60 : 1200;
  const wx = m => { const h = hourAt(state.forecast, isoDay(state.day), m); return h ? `${icon(h, false)} ${h.temp}°` : ''; };
  const dist = p => { const km = kmBetween(c, p); return km < 1 ? `${Math.max(50, Math.round(km * 20) * 50)} m` : `${km.toFixed(1).replace('.', ',')} km`; };

  // Le lieu le plus proche parmi les types qui collent à l'humeur choisie
  const pickPlace = slot => {
    const cats = [];
    state.moods.forEach(m => (MOOD_PLACES[m] || []).forEach(x => { if (!cats.includes(x)) cats.push(x); }));
    ['park', 'garden', 'museum', 'gallery', 'market', 'viewpoint'].forEach(x => { if (!cats.includes(x)) cats.push(x); });
    for (const cat of cats) {
      const p = state.places.filter(x => x.cat === cat && !usedP.has(x.id)).sort((a, b) => kmBetween(c, a) - kmBetween(c, b))[0];
      if (p) { usedP.add(p.id); return p; }
    }
    return null;
  };
  const placeItem = (p, when, m, slot, cls = '') => p
    ? `<li class="${cls}"><span class="when">${when} ${wx(m)}</span><h3><button class="link" data-lng="${p.lng}" data-lat="${p.lat}">${esc(p.name)}</button> <span class="dist">${PLACE_LABEL[p.cat]}, à ${dist(p)}</span></h3><p>${esc(PLACE_TEXT[p.cat][slot] || PLACE_TEXT[p.cat].aprem)}</p></li>`
    : `<li class="${cls}"><span class="when">${when}</span><h3>Temps libre</h3><p>Aucun lieu trouvé autour de toi pour cette humeur.</p></li>`;
  const terrItem = (x, when, m, title, cls = '') => {
    if (!x) return `<li class="${cls}"><span class="when">${when}, ${title}</span><h3>Aucune terrasse chargée</h3><p>Rapproche la carte d'un quartier pour que l'on te propose des terrasses.</p></li>`;
    const txt = x.st === 'soleil' ? 'Au soleil à cette heure.' : x.st === 'mitige' ? 'Soleil entre les nuages.' : x.st === 'couvert' ? 'Ciel couvert prévu, la terrasse reste agréable.' : x.st === 'nuit' ? 'Pour prolonger la soirée.' : 'Pas de terrasse ensoleillée à cette heure dans ce quartier.';
    return `<li class="${cls}"><span class="when">${when}, ${title} ${wx(m)}</span><h3><button class="link" data-id="${esc(x.t.id)}">${esc(x.t.name)}</button> <span class="dist">à ${dist(x.t)}</span></h3><p>${txt}</p></li>`;
  };

  const morning = pickPlace('matin');
  const lunch = sunnyTerraceAt(750, usedT);
  const afternoon = pickPlace('aprem');
  const viewpoint = state.moods.has('date') ? state.places.find(p => p.cat === 'viewpoint' && !usedP.has(p.id)) : null;
  const apero = viewpoint ? null : sunnyTerraceAt(golden, usedT);
  const evening = SUN.set ? sunnyTerraceAt(SUN.set + 45, usedT) : null;

  $('timeline').innerHTML =
    placeItem(morning, '09:30', 570, 'matin') +
    terrItem(lunch, '12:30', 750, 'déjeuner en terrasse') +
    placeItem(afternoon, '15:00', 900, 'aprem') +
    (viewpoint ? placeItem(viewpoint, `${fmt(golden)}, golden hour`, golden, 'golden', 'golden') : terrItem(apero, fmt(golden), golden, 'golden hour', 'golden')) +
    (SUN.set ? `<li><span class="when">${fmt(SUN.set)}</span><h3>Coucher du soleil</h3><p>Le moment à ne pas manquer.</p></li>` : '') +
    (SUN.set ? terrItem(evening, fmt(SUN.set + 45), SUN.set + 45, 'dernier verre') : '');

  $('timeline').querySelectorAll('button.link').forEach(b => {
    b.onclick = () => {
      switchTab('map');
      if (b.dataset.id) {
        const t = state.terraces.find(x => x.id === b.dataset.id);
        if (t) { map.flyTo({ center: [t.lng, t.lat], zoom: 17.5 }); openTerrace(t.id); }
      } else {
        map.flyTo({ center: [+b.dataset.lng, +b.dataset.lat], zoom: 17 });
      }
    };
  });
}

/* ============ Événements ============ */
function nextOccurrence(weekday) {
  const t = today();
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.UTC(t.y, t.m, t.d + i));
    if (d.getUTCDay() === weekday) return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
  }
  return t;
}
const dayLabel = day => new Date(Date.UTC(day.y, day.m, day.d, 12)).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

function renderEvents() {
  const items = EVENTS.map(ev => {
    const day = nextOccurrence(ev.weekday);
    const rs = riseSet(day, ev.lat, ev.lng);
    const start = rs.set ? Math.round((rs.set + ev.sunsetOffset) / 5) * 5 : 1140;
    const near = state.forecastAt && kmBetween(state.forecastAt, { lat: ev.lat, lng: ev.lng }) < 15;
    const h = near ? hourAt(state.forecast, isoDay(day), start) : null;
    const wxTxt = h ? `${icon(h, false)} ${h.temp}°, ${label(h).toLowerCase()}, coucher à ${fmt(rs.set)}` : `🌅 Coucher du soleil à ${fmt(rs.set || 1200)}`;
    return { ev, day, start, html: `
      <article class="event">
        <h3>${esc(ev.title)}</h3>
        <div class="when">${dayLabel(day)}, ${fmt(start)}</div>
        <div class="sub">${esc(ev.place)}</div>
        <span class="wx">${wxTxt}</span>
        <p>${esc(ev.desc)}</p>
        <div class="row"><span class="price">${ev.price} € <small class="sub">par personne</small></span>
          <button class="btn" data-ev="${esc(ev.id)}">Je participe</button></div>
      </article>` };
  });
  $('events').innerHTML = items.length ? items.map(i => i.html).join('') : '<p class="empty">Les prochains événements arrivent bientôt.</p>';
  $('events').querySelectorAll('[data-ev]').forEach(b => {
    b.onclick = () => {
      const it = items.find(i => i.ev.id === b.dataset.ev);
      $('bChoice').value = it.ev.title;
      $('bPlace').value = it.ev.place;
      $('bDate').value = isoDay(it.day);
      const t = fmt(it.start);
      if (![...$('bHour').options].some(o => o.value === t)) $('bHour').insertAdjacentHTML('afterbegin', `<option>${t}</option>`);
      $('bHour').value = t;
      renderOffers();
      $('bookForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
}

/* ============ Réservations (Netlify Forms) ============ */
function renderOffers() {
  const chosen = $('bChoice').value;
  $('offers').innerHTML = PICNIC_OFFERS.map(o => `<button type="button" class="offer" data-o="${esc(o.name)}" aria-pressed="${chosen === o.name}"><strong>${esc(o.name)}</strong><div class="price">${o.price} €</div><small>${esc(o.desc)}</small></button>`).join('');
  $('offers').querySelectorAll('button').forEach(b => { b.onclick = () => { $('bChoice').value = b.dataset.o; renderOffers(); }; });
}
function initBooking() {
  $('bChoice').innerHTML =
    PICNIC_OFFERS.map(o => `<option value="${esc(o.name)}">${esc(o.name)} (${o.price} €)</option>`).join('') +
    EVENTS.map(e => `<option value="${esc(e.title)}">${esc(e.title)} (${e.price} € par personne)</option>`).join('');
  $('bChoice').addEventListener('change', renderOffers);
  const hours = []; for (let m = 660; m <= 1260; m += 30) hours.push(`<option>${fmt(m)}</option>`);
  $('bHour').innerHTML = hours.join('');
  $('bHour').value = SUN.set ? fmt(Math.round((SUN.set - 120) / 30) * 30) : '18:00';
  $('bDate').min = isoDay(today()); $('bDate').value = $('bDate').min;
  renderOffers();
  $('bookForm').addEventListener('submit', async e => {
    e.preventDefault();
    const body = new URLSearchParams(new FormData(e.target)).toString();
    $('bNote').textContent = 'Envoi…';
    try {
      const res = await fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      if (!res.ok) throw new Error(res.status);
      e.target.reset(); $('bDate').value = isoDay(today()); renderOffers();
      $('bNote').textContent = 'Demande envoyée. Tu recevras une confirmation par e-mail.';
      toast('Demande envoyée');
    } catch (err) {
      $('bNote').textContent = 'La demande n’a pas pu être envoyée. En local c’est normal : l’envoi fonctionne une fois le site publié sur Netlify.';
    }
  });
}

/* ============ Favoris ============ */
function renderFavs() {
  $('favList').innerHTML = state.favs.length ? state.favs.map(f => `
    <div class="fav-row"><button class="name" data-id="${esc(f.id)}">${esc(f.name)}<small>${esc(f.address || '')}</small></button>
    <button class="btn" data-rm="${esc(f.id)}" aria-label="Retirer ${esc(f.name)}">Retirer</button></div>`).join('')
    : '<p class="empty">Touche une terrasse sur la carte, puis « Ajouter aux favoris ».</p>';
  $('favList').querySelectorAll('[data-id]').forEach(b => {
    b.onclick = () => {
      const f = state.favs.find(x => x.id === b.dataset.id); switchTab('map');
      map.flyTo({ center: [f.lng, f.lat], zoom: 17.5 });
      map.once('moveend', () => setTimeout(() => { if (state.terraces.some(t => t.id === f.id)) openTerrace(f.id); }, 900));
    };
  });
  $('favList').querySelectorAll('[data-rm]').forEach(b => {
    b.onclick = () => { state.favs = state.favs.filter(x => x.id !== b.dataset.rm); save('sm-favs', state.favs); renderFavs(); };
  });
}

/* ============ Démarrage ============ */
$('date').value = isoDay(state.day);
$('date').min = isoDay(today());
trackGradient();
renderMoods();
initBooking();
onTime();
