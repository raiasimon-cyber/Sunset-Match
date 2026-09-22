# Sunset&Match

Application web (installable sur mobile) qui montre les terrasses au soleil autour de l'utilisateur, heure par heure, en tenant compte de l'ombre réelle des immeubles et de la météo.

L'app s'ouvre sur la ville où se trouve l'utilisateur (géolocalisation). S'il refuse, elle affiche la dernière ville consultée, ou Paris la première fois.

Quatre onglets en bas de l'écran :
- **Carte** : terrasses au soleil ou à l'ombre, ombres des immeubles, météo, curseur de l'heure.
- **Pour toi** : un programme de journée selon l'humeur, avec de vrais lieux autour de soi (parcs, musées, marchés, points de vue) et des terrasses ensoleillées.
- **Événements** : tes événements autour du soleil et tes pique-niques déco, avec un formulaire de réservation.
- **Favoris** : les terrasses gardées par l'utilisateur.

## Ce qui est réel

| Élément | Source | Coût |
|---|---|---|
| Carte et bâtiments avec leur hauteur | OpenFreeMap (données OpenStreetMap) | Gratuit, sans clé |
| Ombres des immeubles | Calculées dans l'app (`src/shadows.js`) | – |
| Position du soleil | Calculée dans l'app (`src/sun.js`) | – |
| Terrasses | À Paris : Paris Data (« terrasses-autorisations »). Ailleurs : OpenStreetMap | Gratuit (licence ODbL) |
| Lieux de « Pour toi » | OpenStreetMap (Overpass) | Gratuit |
| Météo et couverture nuageuse heure par heure | Open-Meteo | Gratuit en usage non commercial |
| Recherche d'adresse | Géoplateforme (IGN), France uniquement | Gratuit |
| Réservations (pique-niques et événements) | Netlify Forms | Gratuit jusqu'à 100 demandes par mois |

## Lancer l'app sur ton ordinateur

1. Installe Node.js (version 20 ou plus) depuis https://nodejs.org
2. Ouvre un terminal dans ce dossier, puis :

```bash
npm install
npm run dev
```

3. Ouvre l'adresse affichée (en général http://localhost:5173).

Pour tester sur ton téléphone sur le même Wi-Fi : `npm run dev -- --host`, puis ouvre l'adresse « Network » sur le téléphone.

## Publier sur Netlify

Méthode conseillée, avec mises à jour automatiques :

1. Crée un dépôt GitHub et pousses-y ce dossier.
2. Sur Netlify : « Add new site », « Import an existing project », puis choisis le dépôt.
3. Netlify lit `netlify.toml` tout seul (commande `npm run build`, dossier `dist`).
4. Dans les réglages du site, active les formulaires (« Forms ») : les réservations y arriveront (formulaire « reservation »).

Chaque modification poussée sur GitHub republie le site.

## Organisation du code

```
index.html            structure des écrans
src/main.js           carte, onglets, interactions
src/sun.js            position du soleil, heure de Paris
src/shadows.js        calcul des ombres à partir des bâtiments
src/weather.js        prévisions Open-Meteo
src/terraces.js       chargement des terrasses (Paris Data à Paris, OpenStreetMap ailleurs)
src/places.js         lieux autour de l'utilisateur pour « Pour toi »
src/content.js        humeurs, textes, formules de pique-nique, événements
src/style.css         design
public/               icône et manifeste (installation sur l'écran d'accueil)
```

## À faire avant de publier

- **Remplace les événements d'exemple** dans `src/content.js` (tableau `EVENTS`) par tes vrais événements. L'heure de début se cale toute seule sur le coucher du soleil du jour.
- La géolocalisation ne fonctionne qu'en HTTPS : c'est le cas sur Netlify et sur `localhost`, pas sur l'adresse « Network » du téléphone en local.

## À vérifier au premier lancement

- **Noms des terrasses** : ouvre la console du navigateur (F12). La ligne `champs Paris Data` liste les champs du jeu de données. Si les noms s'affichent comme « Terrasse », ajoute le bon nom de champ dans `normalizeParis` (`src/terraces.js`).
- **Zoom** : ombres et terrasses n'apparaissent qu'à partir du zoom 15, pour garder l'app fluide.

## Limites connues

- Les arbres ne projettent pas d'ombre : les données de la carte ne les contiennent pas. Le jeu « Les arbres » de Paris Data pourrait être ajouté.
- L'ombre d'un bâtiment est calculée sur son enveloppe : légèrement surestimée pour les formes en L ou en U.
- La météo est une prévision pour tout Paris, heure par heure : elle ne sait pas quel nuage passe au-dessus de quelle rue.

## Avant d'en faire une activité commerciale

- **Open-Meteo** est gratuit seulement en usage non commercial. Dès que l'app rapporte de l'argent (pub, abonnements, pique-niques payants), prends leur offre payante ou une autre API météo.
- **Attributions** : garde les mentions OpenStreetMap, OpenFreeMap, Ville de Paris et Open-Meteo visibles (elles sont dans le coin de la carte).
- **Pique-niques payants** : il faudra un vrai back-end (Supabase par exemple) et le paiement en ligne (Stripe).
- **App Store et Google Play** : cette app web peut être emballée avec Capacitor, sans tout réécrire.
