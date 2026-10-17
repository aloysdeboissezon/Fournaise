"""Construit js/data-paris.js à partir des données brutes de data/.

Usage : python3 scripts/build_data.py
Entrées :
  data/montsouris-raw/AAAA-MM.txt  relevés quotidiens Paris-Montsouris (jour;Tn;Tx)
  data/zone-communes.geojson       contours des 20 arrondissements et des 122 communes de la petite couronne
                                   (IGN ADMIN EXPRESS COG CARTO, régénéré depuis data/raw/admin/ s'il existe)
Sortie :
  js/data-paris.js  (données embarquées, aucune requête réseau nécessaire)
  data/montsouris_ete_2017_2026.csv
"""
import json, glob, os, sys, calendar, re, unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from zone import simplify

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "montsouris-raw")
ADMIN = os.path.join(ROOT, "data", "raw", "admin")
GEOJSON = os.path.join(ROOT, "data", "zone-communes.geojson")
DEPS = {"75": "Paris", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis", "94": "Val-de-Marne"}
TOL = 0.0004  # ° : tolérance de simplification des contours (~30 m), le dessin et le point-dans-polygone s'en contentent


def slug(name):
    s = unicodedata.normalize("NFD", name.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def build_geojson():
    """Fusionne arrondissements et communes IGN en un seul fichier versionné, propriétés réduites."""
    feats = []
    for layer in ("arrondissement_municipal", "commune"):
        for f in json.load(open(os.path.join(ADMIN, layer + ".json")))["features"]:
            p = f["properties"]
            if p["code_insee"] == "75056":
                continue
            name = p["nom_officiel"]
            if layer == "arrondissement_municipal":
                n = int(p["numero_de_l_arrondissement_municipal"])
                name = "Paris " + ("1er" if n == 1 else f"{n}e")
            feats.append({"type": "Feature", "geometry": f["geometry"], "properties": {
                "code": p["code_insee"], "nom": name, "cp": p.get("code_postal") or "", "population": p.get("population") or 0}})
    feats.sort(key=lambda f: f["properties"]["code"])
    json.dump({"type": "FeatureCollection", "source": "IGN, ADMIN EXPRESS COG CARTO (data.geopf.fr)", "features": feats},
              open(GEOJSON, "w"), ensure_ascii=False, separators=(",", ":"))

def read_month(y, m):
    rows = {}
    with open(os.path.join(RAW, f"{y}-{m:02d}.txt")) as f:
        for line in f:
            p = line.strip().split(";")
            if p[0].isdigit():
                rows[int(p[0])] = (float(p[1]), float(p[2]))
    n = calendar.monthrange(y, m)[1]
    assert sorted(rows) == list(range(1, n + 1)), (y, m)
    return [rows[d] for d in range(1, n + 1)]

years = sorted({int(os.path.basename(f)[:4]) for f in glob.glob(os.path.join(RAW, "*.txt"))})
tn, tx, csv = [], [], ["date;tn;tx"]
for y in years:
    yn, yx = [], []
    for m in (6, 7, 8, 9):
        for d, (a, b) in enumerate(read_month(y, m), 1):
            yn.append(a); yx.append(b)
            csv.append(f"{y}-{m:02d}-{d:02d};{a};{b}")
    assert len(yn) == 122
    tn.append(yn); tx.append(yx)

if os.path.exists(os.path.join(ADMIN, "commune.json")):
    build_geojson()
zones = []
for f in json.load(open(GEOJSON))["features"]:
    p = f["properties"]
    geom = f["geometry"]
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    # Contour extérieur seulement (aucune commune de la zone n'en enclave une autre), îlots minuscules écartés.
    # Anneaux codés en entiers (1e-4 degré, ~10 m) : premier point puis écarts, décodés par js/data-paris.js.
    rings = []
    for poly in polys:
        if len(poly[0]) > 12 or len(polys) == 1:
            q = [(round(x * 1e4), round(y * 1e4)) for x, y in simplify(poly[0], TOL)]
            rings.append([q[0][0], q[0][1]] + [v for a, b in zip(q, q[1:]) for v in (b[0] - a[0], b[1] - a[1])])
    z = {"code": p["code"], "dep": p["code"][:2], "name": p["nom"], "slug": slug(p["nom"]), "cp": p["cp"], "pop": p["population"], "r": rings}
    if z["dep"] == "75":
        z["n"] = int(p["code"][2:]) - 100
    zones.append(z)

climate = {"station": "Paris-Montsouris (75114001)", "years": years, "firstDay": "06-01", "tn": tn, "tx": tx}
with open(os.path.join(ROOT, "js", "data-paris.js"), "w") as out:
    out.write("// Généré par scripts/build_data.py — ne pas modifier à la main.\n")
    out.write("window.FOURNAISE_DATA = window.FOURNAISE_DATA || {};\n")
    out.write("window.FOURNAISE_DATA.climate = " + json.dumps(climate, separators=(",", ":")) + ";\n")
    out.write("window.FOURNAISE_DATA.departements = " + json.dumps(DEPS, ensure_ascii=False) + ";\n")
    out.write("window.FOURNAISE_DATA.zones = " + json.dumps(zones, separators=(",", ":"), ensure_ascii=False) + ";\n")
    out.write("window.FOURNAISE_DATA.zones.forEach(function (z) { z.rings = z.r.map(function (f) { var x = 0, y = 0, out = [];"
              " for (var i = 0; i < f.length; i += 2) { x += f[i]; y += f[i + 1]; out.push([x / 1e4, y / 1e4]); } return out; }); delete z.r; });\n")
with open(os.path.join(ROOT, "data", "montsouris_ete_2017_2026.csv"), "w") as out:
    out.write("\n".join(csv) + "\n")
print("années", years, "zones", len(zones), "points", sum(len(r) // 2 for z in zones for r in z["r"]))
