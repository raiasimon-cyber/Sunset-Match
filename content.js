// Contenus éditoriaux. À terme, à déplacer dans une base de données (Supabase par exemple)
// pour pouvoir les modifier sans republier l'app.

export const MOODS = [
  { id: 'chill', label: '😌 Chill' },
  { id: 'apero', label: '🍹 Apéro' },
  { id: 'brunch', label: '🥐 Brunch' },
  { id: 'culture', label: '🎨 Culture' },
  { id: 'sport', label: '🏃 Sport' },
  { id: 'date', label: '💛 Date' },
];

// Quels types de lieux proposer selon l'humeur, par ordre de préférence.
export const MOOD_PLACES = {
  chill: ['park', 'garden'],
  apero: ['viewpoint', 'park'],
  brunch: ['market', 'garden'],
  culture: ['museum', 'gallery'],
  sport: ['park'],
  date: ['viewpoint', 'garden', 'park'],
};

export const PLACE_LABEL = { park: 'Parc', garden: 'Jardin', museum: 'Musée', gallery: 'Galerie', viewpoint: 'Point de vue', market: 'Marché' };

export const PLACE_TEXT = {
  park: { matin: 'Balade ou footing au calme, avant la foule.', aprem: 'Une pelouse au soleil pour lire ou faire la sieste.' },
  garden: { matin: 'Un café à emporter et un banc au soleil.', aprem: 'Un coin de verdure pour ralentir.' },
  museum: { matin: 'Moins de monde à l’ouverture.', aprem: 'Une expo, puis retour au soleil.' },
  gallery: { matin: 'Un tour des expos du moment.', aprem: 'Une galerie, puis une terrasse à deux pas.' },
  market: { matin: 'Le plein de produits frais pour le brunch.', aprem: 'Flâner entre les étals.' },
  viewpoint: { matin: 'La ville qui s’éveille.', aprem: 'Une vue dégagée sur la ville.', golden: 'L’endroit idéal pour regarder le soleil se coucher.' },
};

// Formules de pique-nique déco (ton offre).
export const PICNIC_OFFERS = [
  { id: 'duo', name: 'Pique-nique Duo', price: 49, desc: '2 personnes : nappe, coussins, bougies et fleurs.' },
  { id: 'amis', name: 'Pique-nique Entre amis', price: 119, desc: 'Jusqu’à 6 personnes, déco complète et enceinte.' },
  { id: 'anniv', name: 'Pique-nique Anniversaire', price: 189, desc: 'Jusqu’à 10 personnes, arche de ballons et gâteau.' },
];

// ⚠️ EXEMPLES à remplacer par tes vrais événements avant la publication.
// weekday : 0 = dimanche … 6 = samedi. L'heure de début est calée sur le coucher du soleil du jour
// (sunsetOffset en minutes, négatif = avant le coucher).
export const EVENTS = [
  {
    id: 'pique-nique-couchant',
    title: 'Pique-nique face au couchant',
    place: 'Parc des Buttes-Chaumont, Paris',
    lat: 48.8809, lng: 2.3828,
    weekday: 6, sunsetOffset: -100, price: 25,
    desc: 'Nappes, coussins et planches à partager, installés côté soleil couchant. Places limitées.',
  },
  {
    id: 'golden-hour-quais',
    title: 'Golden hour sur les quais',
    place: 'Quai de la Tournelle, Paris',
    lat: 48.8510, lng: 2.3545,
    weekday: 5, sunsetOffset: -60, price: 15,
    desc: 'Un verre offert au moment où la lumière est la plus belle sur la Seine.',
  },
];
