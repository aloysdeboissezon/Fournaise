# Fournaise · version 1 (Paris)

Site statique qui donne un score de chaleur sur 10 à un logement parisien avant de le louer ou de l'acheter :
nuits étouffantes par été, nuits au-dessus de 28 °C, projection 2050, niveau de confiance, conseils chiffrés,
questions à poser pendant la visite et carte de partage pour les réseaux.

Aucun serveur, aucune clé d'API, aucun coût : tout tourne dans le navigateur.

## Lancer le site

Ouvrir `index.html` dans un navigateur suffit.

Pour le mettre en ligne gratuitement :

- **GitHub Pages** : créer un dépôt, y pousser le contenu de ce dossier, puis *Settings → Pages → Deploy from a branch → main / root*.
- **Netlify ou Cloudflare Pages** : glisser-déposer le dossier dans l'interface, sans étape de build.

`dist/fournaise.html` est la même page en un seul fichier (CSS et JS en ligne), utile pour un partage rapide.

## Structure

```
index.html                 page (contenu entre les marqueurs BODY:START / BODY:END)
css/style.css              styles, thème clair et sombre
js/model.js                modèle de calcul, tous les coefficients en clair
js/app.js                  interface : formulaire, carte, graphiques, partage
js/data-paris.js           données embarquées (générées, ne pas éditer)
data/montsouris-raw/       relevés quotidiens Tn/Tx de Paris-Montsouris, juin-septembre 2017-2026
data/montsouris_ete_2017_2026.csv   les mêmes relevés en un CSV
data/paris-arrondissements.geojson  contours des 20 arrondissements
scripts/build_data.py      régénère js/data-paris.js à partir de data/
scripts/build_artifact.py  produit dist/fournaise.html
```

Ajouter l'été 2027 : déposer `2027-06.txt` … `2027-09.txt` (format `jour;tn;tx`) dans `data/montsouris-raw/`,
puis `python3 scripts/build_data.py` et `python3 scripts/build_artifact.py`.

## Le modèle, en bref

Pour chaque jour du 1er juin au 30 septembre des dix derniers étés :

1. Tn et Tx réels de la station Météo-France Paris-Montsouris.
2. Écart de quartier (îlot de chaleur nocturne) : distance au centre minéral, densité de l'arrondissement,
   rafraîchissement des bois, parcs et de la Seine. Plus fort les nuits chaudes. Calé pour que le centre de Paris
   soit environ 1,5 °C plus chaud la nuit que Montsouris.
3. Inertie : moyenne glissante sur 4 jours, plus lente pour la pierre, plus rapide sous un toit en zinc,
   amortie autour de 20 °C.
4. Apports : internes (surface, époque, DPE) et solaires (toiture, orientation, vitrage, volets) proportionnels
   à l'ensoleillement estimé à partir de Tx.
5. Ventilation nocturne : la chambre se rapproche de l'air extérieur, plus vite si le logement est traversant
   et si on peut dormir fenêtre ouverte.
6. Nuit étouffante si la chambre dépasse 26 °C au coucher. Score = 1 + 9 × √(min(nuits pondérées, 60) / 60),
   une nuit au-dessus de 28 °C comptant 1,5.

Projection 2050 : mêmes étés décalés de +1,2 °C la nuit et +1,4 °C le jour (trajectoire de référence TRACC,
France +2,7 °C en 2050), avec une fourchette basse (+0,6 / +0,7) et haute (+2,0 / +2,4).

Confiance : précision de la localisation, nombre de réponses connues, présence du confort d'été du DPE.
La fourchette de nuits s'élargit quand la confiance baisse.

## Ce qui reste à faire

- La recherche d'adresse appelle la Base Adresse Nationale (Géoplateforme `data.geopf.fr/geocodage`, puis
  l'ancienne `api-adresse.data.gouv.fr` en secours). Elle n'a pas pu être testée depuis l'environnement de
  développement, qui n'avait pas accès à ces domaines. Si elle ne répond pas, le site bascule sur la carte et
  sur le code postal.
- La carte des îlots de chaleur est une estimation par quartier. Étape suivante : la remplacer par une grille
  précalculée à partir des températures de surface Landsat et des arbres et bâtiments d'OpenStreetMap,
  calculée une fois par ville et stockée en JSON.
- Brancher les données bâtiment (BDNB) et le DPE de l'ADEME à l'adresse pour préremplir époque et confort d'été.
- Caler le modèle sur des mesures réelles (quelques capteurs dans des chambres de bonne cet été).
- Lyon, Marseille, Toulouse : il suffit d'une station de référence, d'un contour et d'une carte de chaleur.

## Niveau de preuve des données

La page contient un tableau « Sources et niveau de preuve » qui classe chaque donnée : mesurée, publiée, estimée ou choisie. En résumé : les températures sont mesurées (Météo-France, Paris-Montsouris) ; la TRACC (+2,7 °C en 2050) et l'ordre de grandeur de l'îlot de chaleur (jusqu'à 12 °C la nuit, parcs 1 à 2 °C plus frais, Ville de Paris) sont publiés ; la carte de chaleur, les coefficients du bâtiment, la conversion à l'été 2050 et le seuil de 26 °C (l'OMS recommande 24 °C) sont des estimations ou des choix de Fournaise.

## Sources

- Relevés quotidiens Paris-Montsouris (station 75114001), lus sur keraunos.org ; normales 1991-2020 de la fiche
  climatologique Météo-France.
- TRACC, ministère de la Transition écologique.
- Contours des arrondissements : Ville de Paris (open data), via le projet click_that_hood.
