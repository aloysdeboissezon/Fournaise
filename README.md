# Fournaise · Paris et petite couronne

Site statique qui donne un score de chaleur sur 10 à un logement de Paris, des Hauts-de-Seine, de la Seine-Saint-Denis
ou du Val-de-Marne avant de le louer ou de l'acheter :
nuits étouffantes par été, nuits au-dessus de 28 °C, projection 2050, niveau de confiance, conseils chiffrés,
questions à poser pendant la visite et carte de partage pour les réseaux.

Aucun serveur, aucune clé d'API, aucun coût : tout tourne dans le navigateur. Les données lourdes (carte de chaleur,
DPE et BDNB par adresse) sont précalculées une fois pour la zone et versionnées dans le dépôt, puis chargées à la demande
(une tuile de chaleur et un fichier par commune quand une adresse est choisie).

## Lancer le site

Ouvrir `index.html` dans un navigateur suffit.

Pour le mettre en ligne gratuitement :

- **GitHub Pages** : créer un dépôt, y pousser le contenu de ce dossier, puis *Settings → Pages → Deploy from a branch → main / root*.
- **Netlify ou Cloudflare Pages** : glisser-déposer le dossier dans l'interface, sans étape de build.

`dist/fournaise.html` est la même page en un seul fichier (CSS et JS en ligne), utile pour un partage rapide.

## Structure

```
index.html                 page (contenu entre les marqueurs BODY:START / BODY:END)
mentions-legales.html, confidentialite.html, donnees-licences.html, 404.html, robots.txt, sitemap.xml
                           générés par scripts/build_pages.py (brouillons : les passages « À COMPLÉTER » sont à remplir)
sw.js                      service worker : réseau d'abord, copie en cache hors ligne
fonts/, css/fonts.css      polices auto-hébergées (sous-ensemble latin, licence SIL OFL)
js/analytics.js            mesure d'audience sans cookie (GoatCounter), désactivée tant que le code du site est vide
tests/                     tests du modèle (node --test), budget de poids, accessibilité (axe + Playwright)
.github/workflows/ci.yml   lance ces tests à chaque envoi
css/style.css              styles, thème clair et sombre
js/model.js                modèle de calcul, tous les coefficients en clair
js/app.js                  interface : formulaire, carte, graphiques, partage
js/data-paris.js           relevés Montsouris et contours des 142 communes et arrondissements (générés, ne pas éditer)
js/data-heat.js            carte de chaleur d'ensemble (400 m) et tracé de l'eau, embarqués (générés par build_heat.py)
data/montsouris-raw/       relevés quotidiens Tn/Tx de Paris-Montsouris, juin-septembre 2017-2026
data/montsouris_ete_2017_2026.csv   les mêmes relevés en un CSV
data/zone-communes.geojson          contours IGN des 20 arrondissements et 122 communes de la petite couronne
data/heat/<l>_<c>.json              carte de chaleur fine (100 m), 69 tuiles de 4 km chargées à l'adresse
data/zone-chaleur-100m.json         la même grille d'un seul tenant, lisible par d'autres outils
data/zone-lst-100m.json             températures de surface Landsat d'été sur la même grille (contrôle de la carte)
data/stations-nuit.json             écarts de Tn des stations Météo-France de la zone à Montsouris (calage de la carte)
data/zone-pages.json                liste des pages par commune (pour le plan du site)
data/dpe/<code INSEE>.json          DPE ADEME regroupés par adresse, un fichier par arrondissement ou commune
data/bdnb/<code INSEE>.json         BDNB par adresse (année, murs, toit, hauteur, niveaux), un fichier par arrondissement ou commune
data/raw/                           téléchargements bruts, non versionnés (plusieurs Go)
paris-1er.html … paris-20e.html, <commune>-<dép>.html, petite-couronne.html
                           pages par arrondissement et par commune (SEO), générées par scripts/build_zone_pages.js
scripts/zone.py            rectangle, départements et grille de la zone, partagés par les scripts Python
scripts/fetch_sources.py   télécharge contours, BD TOPO (IGN), DPE (ADEME), BDNB, Landsat, Météo-France dans data/raw/
scripts/check_stations.py  écarts de Tn des stations de la zone à Montsouris → data/stations-nuit.json
scripts/build_lst.py       moyenne des scènes Landsat d'été sur la grille de 100 m
scripts/build_heat.py      calcule la carte de chaleur (BD TOPO, poids ajustés sur les stations Météo-France)
scripts/build_zone_pages.js  pages par arrondissement et par commune
scripts/build_bdnb.py      regroupe la BDNB par adresse
scripts/check_meteofrance.py  compare les relevés embarqués au fichier officiel Météo-France
scripts/build_dpe.py       regroupe les DPE par adresse
scripts/build_data.py      régénère js/data-paris.js à partir de data/
scripts/build_artifact.py  produit dist/fournaise.html
scripts/build_pages.py     génère les pages de texte, la 404, robots.txt et sitemap.xml
scripts/build_icons.py     dessine les icônes (favicon, écran d'accueil) dans img/
scripts/og.html, build_og.js   aperçu de partage img/og.png (1200 × 630) : node scripts/build_og.js
site.webmanifest           installation sur l'écran d'accueil (nom, couleurs, icônes)
```

Tests : `npm test` (modèle et poids), `npm install && npx playwright install chromium && npm run test:a11y` (accessibilité).
Si un coefficient change volontairement, `node tests/model.test.js --print` donne les nouvelles valeurs de référence.

Ajouter l'été 2027 : déposer `2027-06.txt` … `2027-09.txt` (format `jour;tn;tx`) dans `data/montsouris-raw/`,
puis `python3 scripts/build_data.py` et `python3 scripts/build_artifact.py`.

## Le modèle, en bref

Pour chaque jour du 1er juin au 30 septembre des dix derniers étés :

1. Tn et Tx réels de la station Météo-France Paris-Montsouris.
2. Écart de quartier (îlot de chaleur nocturne), lu dans une grille de 100 m précalculée sur Paris et la petite
   couronne : 0,29 °C par m³ de bâti par m² de sol et −4,2 °C pour un quartier entièrement végétalisé, dans un rayon
   de ~500 m (BD TOPO de l'IGN), nul à Montsouris. Ces poids sont ajustés sur les écarts de température minimale
   mesurés par 11 stations Météo-France (nuits où Montsouris reste au-dessus de 20 °C, étés 2017-2026) : erreur
   0,64 °C, 0,73 °C en validation croisée, contre 1,51 °C sans carte. Cœur de Paris ≈ +1,75 °C. Landsat (surface vers
   12 h 40) ne sert plus qu'au contrôle (corrélation 0,77) : les pelouses d'aéroport, brûlantes à midi, sont fraîches
   la nuit. L'effet est plus fort les nuits chaudes.
3. Inertie : moyenne glissante sur 4 jours, plus lente pour la pierre, plus rapide sous un toit en zinc,
   amortie autour de 20 °C.
4. Apports : internes (surface, époque, DPE) et solaires (toiture, orientation, vitrage, volets) proportionnels
   à l'ensoleillement estimé à partir de Tx.
5. Ventilation nocturne : la chambre se rapproche de l'air extérieur, plus vite si le logement est traversant
   et si on peut dormir fenêtre ouverte.
6. Nuit étouffante si la chambre dépasse 26 °C au coucher. Score = 1 + 9 × √(min(nuits pondérées, 120) / 120),
   une nuit au-dessus de 28 °C comptant 1,5.

Projection 2050 : mêmes étés décalés de +1,2 °C la nuit et +1,4 °C le jour (trajectoire de référence TRACC,
France +2,7 °C en 2050), avec une fourchette basse (+0,6 / +0,7) et haute (+2,0 / +2,4).

À l'adresse : les DPE de l'immeuble (ADEME, `data/dpe/`) donnent le confort d'été le plus fréquent, l'année de
construction, la part de logements traversants et protégés du soleil ; la BDNB (`data/bdnb/`) ajoute
année, murs, toiture, hauteur et niveaux. Le confort d'été et l'époque préremplissent le formulaire tant que
l'utilisateur ne les a pas changés.

Confiance : précision de la localisation, nombre de réponses connues, présence du confort d'été du DPE
(compté à moitié quand il vient des DPE de l'immeuble), un point de moins hors de Paris.

Station de référence : Paris-Montsouris pour toute la zone. Les stations de banlieue (Orly, Le Bourget, Saint-Maur,
Neuilly-sur-Marne…) sont souvent sur des aéroports ou des terrains dégagés et n'ont pas toutes dix étés complets ;
elles servent à caler l'écart de quartier, pas de série de base.

Moins fiable en petite couronne qu'à Paris : une seule série de référence, 8 stations de calage hors de Paris
(dont 3 juste au-delà de la zone), relief ignoré, modèle du logement pensé pour les appartements (pas de question
« maison »), DPE plus rares dans les quartiers pavillonnaires. Le niveau de confiance et les pages par commune le disent.
La fourchette de nuits s'élargit quand la confiance baisse.

## Mettre à jour les données

```
python3 scripts/fetch_sources.py        # contours, IGN, ADEME, BDNB, Landsat, Météo-France ; reprend où il s'est arrêté
                                        # (--dep 92,93,94 pour quelques départements, --box 00,01 pour paralléliser l'IGN)
python3 scripts/build_data.py           # contours → data/zone-communes.geojson et js/data-paris.js
python3 scripts/check_stations.py       # data/stations-nuit.json
python3 scripts/build_lst.py            # Landsat sur la grille
python3 scripts/build_heat.py           # js/data-heat.js, data/heat/
python3 scripts/build_dpe.py            # data/dpe/<code>.json (départements téléchargés seulement)
python3 scripts/build_bdnb.py           # data/bdnb/<code>.json (départements téléchargés seulement)
python3 scripts/check_meteofrance.py    # relevés embarqués contre le fichier officiel
node scripts/build_zone_pages.js        # pages par arrondissement et par commune
python3 scripts/build_pages.py          # pages de texte et plan du site
python3 scripts/build_artifact.py       # dist/fournaise.html
```

Les services publics coupent souvent les longues réponses : les scripts réessaient. Landsat demande `rasterio` et
`pyproj` (`pip install rasterio pyproj`).

## Ce qui reste à faire

- Affiner la carte avec les capteurs de la Ville de Paris (opendata.paris.fr) et le relief (plateaux, vallées) ; le jardin
  du Luxembourg est la plus grosse erreur (carte +0,9 °C, mesure −0,7 °C).
- Ajouter une question « maison ou appartement » pour la petite couronne.
- Remplacer les 100 derniers jours des relevés Montsouris (23 juin au 30 septembre 2026), pas encore dans le fichier
  officiel de Météo-France, quand il sera mis à jour.
- Les DPE par adresse et les tuiles fines ne sont pas dans `dist/fournaise.html` (version un seul fichier) : ils se
  chargent depuis `data/` ; sans eux, la page utilise la carte d'ensemble de 400 m.
- Caler le modèle sur des mesures réelles (quelques capteurs dans des chambres de bonne cet été).
- Lyon, Marseille, Toulouse : une station de référence, un contour, `fetch_sources.py` et `build_heat.py` sur leur rectangle.

## Niveau de preuve des données

La page contient un tableau « Sources et niveau de preuve » qui classe chaque donnée : mesurée, publiée, estimée ou choisie. En résumé : les températures sont mesurées (Météo-France, Paris-Montsouris) ; la TRACC (+2,7 °C en 2050) et l'ordre de grandeur de l'îlot de chaleur (jusqu'à 12 °C la nuit, parcs 1 à 2 °C plus frais, Ville de Paris) sont publiés ; la carte de chaleur, les coefficients du bâtiment, la conversion à l'été 2050 et le seuil de 26 °C (l'OMS recommande 24 °C) sont des estimations ou des choix de Fournaise. Le bâti et la végétation autour du logement sont mesurés (IGN) et leurs poids ajustés sur les températures de nuit de 11 stations Météo-France. Les DPE de
l'immeuble sont publiés (ADEME) mais déclaratifs.

## Sources

- Relevés quotidiens Paris-Montsouris (station 75114001), lus sur keraunos.org ; normales 1991-2020 de la fiche
  climatologique Météo-France.
- TRACC, ministère de la Transition écologique.
- Contours des arrondissements et des communes : IGN, ADMIN EXPRESS COG CARTO (data.geopf.fr).
- Températures minimales de 11 stations de la région, Météo-France (données quotidiennes, data.gouv.fr).
- BD TOPO V3, IGN, via le service WFS de la Géoplateforme (data.geopf.fr), lue le 17 octobre 2026.
- DPE logements existants depuis juillet 2021, ADEME (data.ademe.fr), lus le 17 octobre 2026.
- BDNB, CSTB, archive open data du département 75, millésime 2026-02.b (open-data.s3.fr-par.scw.cloud).
- Arbres de la Ville de Paris (opendata.paris.fr, jeu « les-arbres »).
- Landsat 8 et 9, collection 2 niveau 2 (USGS), via Microsoft Planetary Computer.
- Relevés quotidiens officiels de Météo-France (data.gouv.fr), utilisés pour contrôler les relevés embarqués.
- Base Adresse Nationale, via la Géoplateforme (géocodage), testée le 17 octobre 2026.
