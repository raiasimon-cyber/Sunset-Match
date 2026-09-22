// Prévisions météo réelles via Open-Meteo (gratuit, sans clé, usage non commercial).
// Pour un usage commercial, prendre l'offre payante Open-Meteo ou une autre API.
import { TZ } from './sun.js';

const CACHE_MS = 30 * 60 * 1000;

/** Prévisions horaires sur 7 jours pour un lieu (heures exprimées dans le fuseau de l'appareil). */
export async function loadForecast(lat, lon) {
  const URL = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
    `&hourly=temperature_2m,cloud_cover,precipitation,weather_code&timezone=${encodeURIComponent(TZ)}&forecast_days=7`;
  const CACHE_KEY = `sm-forecast-${lat.toFixed(2)},${lon.toFixed(2)}`;
  try {
    const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
    if (c && Date.now() - c.t < CACHE_MS) return c.data;
  } catch (e) { /* cache illisible */ }
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Open-Meteo a répondu ${res.status}`);
  const j = await res.json();
  const data = {};
  j.hourly.time.forEach((t, i) => {
    data[t] = {
      temp: Math.round(j.hourly.temperature_2m[i]),
      cover: j.hourly.cloud_cover[i],
      precip: j.hourly.precipitation[i],
      code: j.hourly.weather_code[i],
    };
  });
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), data })); } catch (e) { /* plein */ }
  return data;
}

/** Entrée horaire pour un jour ({y,m,d}) et une minute de la journée. */
export function hourAt(forecast, isoDate, min) {
  if (!forecast) return null;
  const h = String(Math.min(23, Math.floor(min / 60))).padStart(2, '0');
  return forecast[`${isoDate}T${h}:00`] || null;
}

/** Ce que le ciel fait au soleil : 'clair', 'mitige' (soleil par intermittence) ou 'couvert'. */
export function sky(h) {
  if (!h) return 'clair';
  if (h.precip >= 0.2 || h.cover >= 85) return 'couvert';
  if (h.cover >= 50) return 'mitige';
  return 'clair';
}

export function icon(h, night) {
  if (!h) return night ? '🌙' : '☀️';
  const c = h.code;
  if (c >= 95) return '⛈️';
  if (c >= 71 && c <= 77) return '🌨️';
  if (c >= 51) return '🌧️';
  if (c === 45 || c === 48) return '🌫️';
  if (night) return h.cover >= 60 ? '☁️' : '🌙';
  if (h.cover >= 85) return '☁️';
  if (h.cover >= 50) return '⛅';
  if (h.cover >= 20) return '🌤️';
  return '☀️';
}

export function label(h) {
  if (!h) return 'Météo indisponible';
  if (h.code >= 95) return 'Orages';
  if (h.code >= 51 && h.precip > 0) return 'Pluie';
  if (h.cover >= 85) return 'Couvert';
  if (h.cover >= 50) return 'Nuageux';
  if (h.cover >= 20) return 'Quelques nuages';
  return 'Ensoleillé';
}
