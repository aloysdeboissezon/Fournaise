"""Compare les relevés embarqués (data/montsouris_ete_2017_2026.csv) au fichier officiel Météo-France.

Usage : python3 scripts/check_meteofrance.py      (après scripts/fetch_sources.py meteofrance)
Affiche le nombre de jours identiques, différents et absents du fichier officiel (publié avec du retard).
"""
import csv, gzip, glob, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
official = {}
for path in sorted(glob.glob(os.path.join(ROOT, "data", "raw", "meteofrance", "*.csv.gz"))):
    with gzip.open(path, "rt") as fh:
        for r in csv.DictReader(fh, delimiter=";"):
            if r["NUM_POSTE"] == "75114001" and r["TN"] and r["TX"]:
                official[r["AAAAMMJJ"]] = (float(r["TN"]), float(r["TX"]))
same = diff = absent = 0
for line in open(os.path.join(ROOT, "data", "montsouris_ete_2017_2026.csv")).read().split("\n")[1:]:
    if not line:
        continue
    day, tn, tx = line.split(";")
    o = official.get(day.replace("-", ""))
    if o is None:
        absent += 1
    elif abs(o[0] - float(tn)) > 0.05 or abs(o[1] - float(tx)) > 0.05:
        diff += 1
        print("écart", day, (tn, tx), o)
    else:
        same += 1
print("identiques", same, "· différents", diff, "· absents du fichier officiel", absent)
