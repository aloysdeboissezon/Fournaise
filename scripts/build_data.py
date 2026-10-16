"""Construit js/data-paris.js à partir des données brutes de data/.

Usage : python3 scripts/build_data.py
Entrées :
  data/montsouris-raw/AAAA-MM.txt  relevés quotidiens Paris-Montsouris (jour;Tn;Tx)
  data/paris-arrondissements.geojson
Sortie :
  js/data-paris.js  (données embarquées, aucune requête réseau nécessaire)
  data/montsouris_ete_2017_2026.csv
"""
import json, glob, os, calendar

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "montsouris-raw")

ARR_NUM = {"Louvre": 1, "Bourse": 2, "Temple": 3, "Hôtel-de-Ville": 4, "Panthéon": 5,
           "Luxembourg": 6, "Palais-Bourbon": 7, "Élysée": 8, "Opéra": 9,
           "Enclos-St-Laurent": 10, "Popincourt": 11, "Reuilly": 12, "Gobelins": 13,
           "Observatoire": 14, "Vaugirard": 15, "Passy": 16, "Batignolles-Monceau": 17,
           "Butte-Montmartre": 18, "Buttes-Chaumont": 19, "Ménilmontant": 20}

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

g = json.load(open(os.path.join(ROOT, "data", "paris-arrondissements.geojson")))
arr = []
for f in g["features"]:
    name = f["properties"]["name"]
    rings = [[[round(x, 4), round(y, 4)] for x, y in ring] for poly in f["geometry"]["coordinates"] for ring in poly]
    arr.append({"n": ARR_NUM[name], "name": name, "rings": rings})
arr.sort(key=lambda a: a["n"])

climate = {"station": "Paris-Montsouris (75114001)", "years": years, "firstDay": "06-01", "tn": tn, "tx": tx}
with open(os.path.join(ROOT, "js", "data-paris.js"), "w") as out:
    out.write("// Généré par scripts/build_data.py — ne pas modifier à la main.\n")
    out.write("window.FOURNAISE_DATA = window.FOURNAISE_DATA || {};\n")
    out.write("window.FOURNAISE_DATA.climate = " + json.dumps(climate, separators=(",", ":")) + ";\n")
    out.write("window.FOURNAISE_DATA.arrondissements = " + json.dumps(arr, separators=(",", ":"), ensure_ascii=False) + ";\n")
with open(os.path.join(ROOT, "data", "montsouris_ete_2017_2026.csv"), "w") as out:
    out.write("\n".join(csv) + "\n")
print("années", years, "arrondissements", len(arr))
