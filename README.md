# Fournaise · version 1 (Paris)

Site statique qui donne un score de chaleur sur 10 à un logement parisien avant de le louer ou de l'acheter :
nuits étouffantes par été, nuits au-dessus de 28 °C, projection 2050, niveau de confiance, conseils chiffrés,
questions à poser pendant la visite et carte de partage pour les réseaux.

Aucun serveur, aucune clé d'API, aucun coût : tout tourne dans le navigateur. Les données lourdes (carte de chaleur,
DPE par adresse) sont précalculées une fois pour Paris et versionnées dans le dépôt.

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
js/data-paris.js           relevés Montsouris et arrondissements embarqués (générés, ne pas éditer)
js/data-heat.js            grille de chaleur de 100 m embarquée (générée par build_heat.py)
data/montsouris-raw/       relevés quotidiens Tn/Tx de Paris-Montsouris, juin-septembre 2017-2026
data/montsouris_ete_2017_2026.csv   les mêmes relevés en un CSV
data/paris-arrondissements.geojson  contours des 20 arrondissements
data/paris-chaleur-100m.json        même grille que js/data-heat.js, lisible par d'autres outils
data/paris-lst-100m.json            températures de surface Landsat d'été sur la même grille (calage de la carte)
data/dpe/751xx.json                 DPE ADEME regroupés par adresse, un fichier par arrondissement (chargé à la demande)
data/bdnb/751xx.json                BDNB par adresse (année, murs, toit, hauteur, niveaux), un fichier par arrondissement
data/raw/                           téléchargements bruts, non versionnés (plusieurs centaines de Mo)
scripts/fetch_sources.py   télécharge BD TOPO (IGN) et DPE (ADEME) dans data/raw/
scripts/build_lst.py       moyenne des scènes Landsat d'été sur la grille de 100 m
scripts/build_heat.py      calcule la grille de chaleur (BD TOPO, arbres, poids ajustés sur Landsat)
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
2. Écart de quartier (îlot de chaleur nocturne), lu dans une grille de 100 m précalculée : part de végétation et
   d'eau dans un rayon de ~200 m (BD TOPO de l'IGN). Les poids sont ajustés par moindres carrés sur les
   températures de surface Landsat d'été (12 journées chaudes, 17 460 mailles, R² 0,65) ; le bâti, la hauteur des
   immeubles et les arbres de la Ville n'améliorent pas l'ajustement une fois la végétation et l'eau connues.
   Landsat mesure la surface vers 12 h 40, pas l'air la nuit : l'amplitude en °C est un choix de Fournaise
   (Montsouris = 0, centre de Paris ≈ +1,5 °C), plus fort les nuits chaudes.
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
(compté à moitié quand il vient des DPE de l'immeuble).
La fourchette de nuits s'élargit quand la confiance baisse.

## Mettre à jour les données

```
python3 scripts/fetch_sources.py        # IGN, ADEME, arbres, BDNB, Landsat, Météo-France ; reprend où il s'est arrêté
python3 scripts/build_heat.py           # grille de base (poids de départ)
python3 scripts/build_lst.py            # Landsat sur la grille
python3 scripts/build_heat.py           # relancé : poids ajustés sur Landsat, js/data-heat.js
python3 scripts/build_dpe.py            # data/dpe/751xx.json
python3 scripts/build_bdnb.py           # data/bdnb/751xx.json
python3 scripts/check_meteofrance.py    # relevés embarqués contre le fichier officiel
python3 scripts/build_artifact.py       # dist/fournaise.html
```

Les services publics coupent souvent les longues réponses : les scripts réessaient. Landsat demande `rasterio` et
`pyproj` (`pip install rasterio pyproj`).

## Ce qui reste à faire

- Caler l'amplitude de la carte sur des mesures d'air la nuit (stations de la Ville de Paris, capteurs), plutôt que
  sur la surface de jour vue par Landsat.
- Remplacer les 100 derniers jours des relevés Montsouris (23 juin au 30 septembre 2026), pas encore dans le fichier
  officiel de Météo-France, quand il sera mis à jour.
- Les DPE par adresse ne sont pas dans `dist/fournaise.html` (version un seul fichier) : ils se chargent depuis `data/`.
- Un recalage des poids de la carte avec de l'air de nuit pourrait faire revenir le bâti (collinéaire avec la végétation).
- Caler le modèle sur des mesures réelles (quelques capteurs dans des chambres de bonne cet été).
- Lyon, Marseille, Toulouse : une station de référence, un contour, `fetch_sources.py` et `build_heat.py` sur leur rectangle.

## Niveau de preuve des données

La page contient un tableau « Sources et niveau de preuve » qui classe chaque donnée : mesurée, publiée, estimée ou choisie. En résumé : les températures sont mesurées (Météo-France, Paris-Montsouris) ; la TRACC (+2,7 °C en 2050) et l'ordre de grandeur de l'îlot de chaleur (jusqu'à 12 °C la nuit, parcs 1 à 2 °C plus frais, Ville de Paris) sont publiés ; la carte de chaleur, les coefficients du bâtiment, la conversion à l'été 2050 et le seuil de 26 °C (l'OMS recommande 24 °C) sont des estimations ou des choix de Fournaise. La végétation
et l'eau autour du logement sont mesurées (IGN), leurs poids ajustés sur Landsat ; leur conversion en degrés de nuit est un choix de Fournaise. Les DPE de
l'immeuble sont publiés (ADEME) mais déclaratifs.

## Sources

- Relevés quotidiens Paris-Montsouris (station 75114001), lus sur keraunos.org ; normales 1991-2020 de la fiche
  climatologique Météo-France.
- TRACC, ministère de la Transition écologique.
- Contours des arrondissements : Ville de Paris (open data), via le projet click_that_hood.
- BD TOPO V3, IGN, via le service WFS de la Géoplateforme (data.geopf.fr), lue le 17 octobre 2026.
- DPE logements existants depuis juillet 2021, ADEME (data.ademe.fr), lus le 17 octobre 2026.
- BDNB, CSTB, archive open data du département 75, millésime 2026-02.b (open-data.s3.fr-par.scw.cloud).
- Arbres de la Ville de Paris (opendata.paris.fr, jeu « les-arbres »).
- Landsat 8 et 9, collection 2 niveau 2 (USGS), via Microsoft Planetary Computer.
- Relevés quotidiens officiels de Météo-France (data.gouv.fr), utilisés pour contrôler les relevés embarqués.
- Base Adresse Nationale, via la Géoplateforme (géocodage), testée le 17 octobre 2026.
