#!/usr/bin/env python3
"""Génère les pages de texte (mentions légales, confidentialité, données et licences, 404), robots.txt et sitemap.xml.

Usage : python3 scripts/build_pages.py
Les passages à compléter par l'éditeur sont marqués <span class="a-completer">.
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://aloysdeboissezon.github.io/Fournaise/"
ISSUES = "https://github.com/aloysdeboissezon/Fournaise/issues/new"

HEAD = """<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>@TITLE@ · Fournaise</title>
<meta name="description" content="@DESC@">
<meta name="robots" content="@ROBOTS@">
<meta name="theme-color" content="#edf0f2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0d1116" media="(prefers-color-scheme: dark)">
<link rel="canonical" href="@BASE@@FILE@">
<link rel="icon" type="image/svg+xml" href="@P@img/favicon.svg">
<link rel="apple-touch-icon" href="@P@img/apple-touch-icon.png">
<link rel="manifest" href="@P@site.webmanifest">
<link rel="preload" href="@P@fonts/instrument-sans-046090.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="@P@css/fonts.css">
<link rel="stylesheet" href="@P@css/style.css">
<script>try{var t=localStorage.getItem("fournaise-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>
</head>
<body>
<a class="skip" href="#contenu">Aller au contenu</a>
<header class="topbar"><div class="wrap topbar-in"><a class="brand" href="@P@"><span class="brand-mark" aria-hidden="true"></span>Fournaise</a><span class="grow"></span><a class="btn ghost" href="@P@">Retour au score</a></div></header>
<main id="contenu" class="wrap prose">
@BODY@
</main>
<footer><div class="wrap foot"><nav class="foot-nav foot-legal" aria-label="Informations légales"><a href="@P@mentions-legales.html">Mentions légales</a><a href="@P@confidentialite.html">Confidentialité</a><a href="@P@donnees-licences.html">Données et licences</a><a href="@ISSUES@" target="_blank" rel="noopener">Signaler une erreur</a></nav></div></footer>
</body>
</html>
"""

BANNER = '<p class="draft-banner">Brouillon à faire relire : les passages surlignés sont à compléter par l\'éditeur. Cette page n\'a pas été relue par un juriste.</p>'
MAIL = '<span class="a-completer">À COMPLÉTER : adresse e-mail dédiée</span>'

MENTIONS = BANNER + """
<h1>Mentions légales</h1>
<h2>Éditeur du site</h2>
<p>Fournaise est un site gratuit, non commercial, édité à titre personnel par <span class="a-completer">À COMPLÉTER : nom, ou pseudonyme si l'éditeur choisit de rester anonyme auprès du public</span>.</p>
<p>Directeur de la publication : <span class="a-completer">À COMPLÉTER : même personne</span>.</p>
<p>Contact : """ + MAIL + """, ou <a href="@ISSUES@" target="_blank" rel="noopener">un signalement public sur GitHub</a>.</p>
<h2>Hébergeur</h2>
<p>GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis (service GitHub Pages).</p>
<h2>Nature du service</h2>
<p>Fournaise donne une <strong>estimation indicative</strong> du confort d'été d'un logement à Paris ou en petite couronne. Le résultat est calculé dans le navigateur à partir de relevés météorologiques, de données publiques et d'hypothèses décrites dans la section « Sources et niveau de preuve » de la page d'accueil. Il est non contractuel, il ne remplace ni un diagnostic de performance énergétique, ni une étude thermique réglementaire, ni une visite du logement, et il ne doit pas être présenté comme tel dans une annonce, un bail ou une négociation.</p>
<h2>Responsabilité</h2>
<p>L'éditeur s'efforce de fournir des informations exactes mais ne garantit ni l'exactitude ni l'exhaustivité du score et décline toute responsabilité quant aux décisions prises sur sa seule base. Pour signaler une erreur, utiliser le lien « Signaler une erreur » en bas de chaque page.</p>
<h2>Propriété intellectuelle</h2>
<p>Le code source est publié sur <a href="https://github.com/aloysdeboissezon/Fournaise" target="_blank" rel="noopener">GitHub</a>. Licence du code : <span class="a-completer">À COMPLÉTER : choisir une licence (par exemple MIT ou AGPL) et ajouter un fichier LICENSE au dépôt</span>. Les données tierces restent soumises à leurs propres licences, listées sur la page <a href="donnees-licences.html">Données et licences</a>.</p>
<h2>Droit applicable</h2>
<p>Le site est soumis au droit français.</p>
"""

CONFIDENTIALITE = BANNER + """
<h1>Confidentialité</h1>
<p>Fournaise ne demande ni compte ni e-mail, ne pose aucun cookie et ne contient aucun outil de mesure d'audience ni de publicité.</p>
<h2>Ce qui reste dans ton navigateur</h2>
<p>Les réponses sur le logement et le calcul du score ne quittent pas ton navigateur. Le navigateur garde seulement, dans son stockage local, ton choix de thème clair ou sombre (clé <code>fournaise-theme</code>) les logements que tu choisis de garder pour comparer (clé <code>fournaise-compare</code>), ton choix entre le mode rapide et le mode complet (clé <code>fournaise-mode</code>) et, si tu actives l'alerte canicule, la position arrondie à environ 1 km de ton logement (clé <code>fournaise-alert</code>, avec une copie dans le cache du navigateur pour les notifications en arrière-plan). Ces données ne servent qu'à faire fonctionner le site, ne sont lues que par lui et s'effacent avec les données du site dans les réglages du navigateur.</p>
<h2>Ce qui sort de ton navigateur</h2>
<ul>
<li><strong>Recherche d'adresse.</strong> Le texte que tu tapes est envoyé au service de géocodage de la Géoplateforme (IGN, <code>data.geopf.fr</code>) et, s'il ne répond pas, à la Base Adresse Nationale (<code>api-adresse.data.gouv.fr</code>), services publics français. Ils reçoivent aussi ton adresse IP, comme tout serveur web. Fournaise ne les voit pas et ne les conserve pas.</li>
<li><strong>Prévision de chaleur.</strong> Seulement si tu cliques sur « Voir la prévision » ou si tu actives les notifications : la position de ton logement arrondie à environ 1 km est envoyée à Open-Meteo (<code>api.open-meteo.com</code>), avec ton adresse IP comme pour tout serveur web. Fournaise ne les voit pas et ne les conserve pas. La position de géolocalisation du bouton « Autour de moi » reste dans ton navigateur.</li>
<li><strong>Hébergement.</strong> Les fichiers du site sont servis par GitHub Pages, qui peut journaliser ton adresse IP selon <a href="https://docs.github.com/fr/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener">sa propre politique de confidentialité</a>.</li>
<li><strong>Polices et carte.</strong> Les polices sont hébergées avec le site : aucune requête vers Google. La carte est dessinée par le site lui-même, sans fond de carte externe.</li>
</ul>
<h2>Partage d'un résultat</h2>
<p>Le lien de partage contient la position (arrondie à environ 100 m) et les réponses dans l'adresse de la page ; rien n'est envoyé à un serveur tant que tu ne le colles pas quelque part. Le texte et l'image de partage ne mentionnent par défaut que la commune ou l'arrondissement.</p>
<h2>Tes droits</h2>
<p>Fournaise ne détient aucune donnée personnelle te concernant. Pour toute question, écris à """ + MAIL + """ ou ouvre un <a href="@ISSUES@" target="_blank" rel="noopener">signalement</a>. Tu peux aussi saisir la CNIL (<a href="https://www.cnil.fr" target="_blank" rel="noopener">cnil.fr</a>).</p>
<h2>Si cela change</h2>
<p>Si une mesure d'audience sans cookie était ajoutée un jour, elle serait décrite ici avant d'être activée.</p>
"""

TODO = lambda t: '<span class="a-completer">%s</span>' % t
ROWS = [
    ("Relevés quotidiens de température Paris-Montsouris (2017 à juin 2026)", "Météo-France, via data.gouv.fr (données climatologiques de base quotidiennes)", "Licence Ouverte 2.0 (Etalab)", "Citer « Météo-France »."),
    ("Relevés Paris-Montsouris, 23 juin au 30 septembre 2026", "Keraunos, qui relaie des données Météo-France", TODO("Droits de réutilisation à confirmer"), "À remplacer par le fichier officiel dès sa publication."),
    ("Bâtiments, végétation, eau", "BD TOPO, IGN (Géoplateforme)", "Licence Ouverte 2.0 (Etalab)", "Citer « IGN, BD TOPO »."),
    ("Températures de surface", "Landsat 8 et 9, USGS (via Microsoft Planetary Computer)", "Domaine public (USGS)", "Citer « Landsat, courtesy of the U.S. Geological Survey »."),
    ("DPE des logements existants depuis 2021", "ADEME (data.ademe.fr)", "Licence Ouverte 2.0 (Etalab)", "Citer « ADEME ». Données déclaratives."),
    ("Caractéristiques des bâtiments", "BDNB, CSTB (millésime 2026-02.b)", "Licence Ouverte 2.0 " + TODO("à confirmer"), "Citer « CSTB, BDNB »."),
    ("Géocodage des adresses", "Base Adresse Nationale, via la Géoplateforme (IGN)", "Licence Ouverte 2.0 (Etalab)", "Service interrogé en direct depuis le navigateur."),
    ("Contours des arrondissements et des communes", "ADMIN EXPRESS COG CARTO, IGN (Géoplateforme)", "Licence Ouverte 2.0 (Etalab)", "Citer « IGN, ADMIN EXPRESS »."),
    ("Températures minimales des stations de la région (calage de la carte)", "Météo-France, via data.gouv.fr (données climatologiques de base quotidiennes)", "Licence Ouverte 2.0 (Etalab)", "Citer « Météo-France »."),
    ("Arbres de la Ville de Paris", "Ville de Paris (opendata.paris.fr, jeu « les-arbres »)", "ODbL 1.0", "Testés lors de la conception de la carte de Paris ; ils n'amélioraient pas le calage et ne servent pas au calcul."),
    ("Prévision à 7 jours (alerte canicule)", "Open-Meteo (api.open-meteo.com), appelée à la demande avec une position arrondie à 1 km", "CC BY 4.0, gratuit pour un usage non commercial", "Citer « Open-Meteo.com ». Les seuils d'une vague de chaleur affichés par Fournaise sont un ordre de grandeur, pas la vigilance officielle de Météo-France."),
    ("Trajectoire de réchauffement (TRACC)", "Ministère de la Transition écologique, dossier de presse du 27 janvier 2026", "Information publique, citée", "Le passage à un écart d'été est une estimation de Fournaise."),
    ("Polices Unbounded, Instrument Sans, IBM Plex Mono", "Google Fonts, hébergées avec le site", "SIL Open Font License 1.1", "Fichiers dans le dossier fonts/."),
]
DONNEES = BANNER + """
<h1>Données et licences</h1>
<p>Fournaise ne repose que sur des données ouvertes. Cette page indique, pour chacune, la source, la licence et la mention à afficher. Le niveau de preuve de chaque donnée (mesuré, publié, estimé, choisi) est détaillé dans la section « Sources et niveau de preuve » de la <a href="./#sources">page d'accueil</a>.</p>
<table><thead><tr><th>Donnée</th><th>Source</th><th>Licence</th><th>Mention et remarques</th></tr></thead><tbody>""" + "".join("<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>" % r for r in ROWS) + """</tbody></table>
<p>Les données ont été lues le 17 octobre 2026. Les fichiers calculés à partir d'elles (grille de chaleur, DPE et BDNB regroupés par adresse) sont fournis avec le code source ; leur reproduction est décrite dans le fichier README du dépôt.</p>
"""

PAGES = {
    "mentions-legales.html": ("Mentions légales", "Éditeur, hébergeur et conditions d'utilisation de Fournaise.", "noindex", MENTIONS),
    "confidentialite.html": ("Confidentialité", "Ce que Fournaise collecte (rien) et ce qui sort du navigateur.", "noindex", CONFIDENTIALITE),
    "donnees-licences.html": ("Données et licences", "Origine, licence et conditions de réutilisation de chaque donnée utilisée par Fournaise.", "index,follow", DONNEES),
}


def render(file, title, desc, robots, body, prefix=""):
    out = HEAD.replace("@BODY@", body)
    for k, v in (("@TITLE@", title), ("@DESC@", desc), ("@ROBOTS@", robots), ("@FILE@", file), ("@BASE@", BASE), ("@P@", prefix), ("@ISSUES@", ISSUES)):
        out = out.replace(k, v)
    return out


def write(name, text):
    with open(os.path.join(ROOT, name), "w", encoding="utf-8") as f:
        f.write(text)


for name, (t, d, r, b) in PAGES.items():
    write(name, render(name, t, d, r, b))

# La page 404 est servie à n'importe quelle profondeur : liens absolus depuis la racine du site.
write("404.html", render("404.html", "Page introuvable", "Page introuvable.", "noindex",
      '<h1>Page introuvable</h1><p>Cette page n\'existe pas ou a changé d\'adresse.</p><p><a class="btn hot" href="/Fournaise/">Calculer mon score</a></p>', prefix="/Fournaise/"))
write("robots.txt", "User-agent: *\nAllow: /\n\nSitemap: %ssitemap.xml\n" % BASE)
# Plan du site : accueil, données et licences, pages par arrondissement et par commune (scripts/build_zone_pages.js).
zone_pages = [p["file"] for p in json.load(open(os.path.join(ROOT, "data", "zone-pages.json")))]
urls = [BASE, BASE + "donnees-licences.html", BASE + "petite-couronne.html"] + [BASE + f for f in zone_pages]
write("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "".join("  <url><loc>%s</loc></url>\n" % u for u in urls) + "</urlset>\n")
