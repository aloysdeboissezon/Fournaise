"""Caractéristiques des immeubles tirées de la BDNB (CSTB), un fichier par arrondissement de Paris ou commune.

Usage : python3 scripts/build_bdnb.py      (après scripts/fetch_sources.py bdnb)
Entrée  : data/raw/bdnb/<département>/csv/ (archives « open data » par département, millésime 2026-02.b) ;
          seuls les départements téléchargés sont recalculés.
Sorties : data/bdnb/<code INSEE>.json, chargés par la page quand une adresse est choisie.

Une ligne par adresse (identifiant de la Base Adresse Nationale sans le code commune, en minuscules, comme data/dpe/) :
  [numéro BAN, année de construction (0 si inconnue), indice des murs, indice du toit,
   hauteur moyenne en m (0 si inconnue), nombre de niveaux (0 si inconnu), nombre de logements]
Les indices renvoient aux listes « murs » et « toits » du fichier. Les valeurs « INDETERMINE » sont écartées.
Les caractéristiques sont celles du groupe de bâtiments auquel la BDNB rattache l'adresse.
"""
import csv, glob, json, os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw", "bdnb")
OUT = os.path.join(ROOT, "data", "bdnb")
CODES = {f["properties"]["code"] for f in json.load(open(os.path.join(ROOT, "data", "zone-communes.geojson")))["features"]}
# Communes fusionnées dont la BAN garde parfois l'ancien code : l'adresse va dans le fichier de la commune nouvelle.
MERGED = {"93059": "93066"}


def table(src, name):
    with open(os.path.join(src, name), encoding="utf-8", newline="") as f:
        yield from csv.DictReader(f, delimiter=";")


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def main():
    walls, roofs = {}, {}
    rows = defaultdict(dict)
    for src in sorted(glob.glob(os.path.join(RAW, "*", "csv"))):
        read_dep(src, walls, roofs, rows)
    write(walls, roofs, rows)


def read_dep(src, walls, roofs, rows):
    ffo = {r["batiment_groupe_id"]: r for r in table(src, "batiment_groupe_ffo_bat.csv")}
    height = {r["batiment_groupe_id"]: num(r["hauteur_mean"]) for r in table(src, "batiment_groupe_bdtopo_bat.csv")}
    for r in table(src, "rel_batiment_groupe_adresse.csv"):
        ban, g = r["cle_interop_adr"].lower(), r["batiment_groupe_id"]
        f = ffo.get(g)
        code = MERGED.get(ban[:5], ban[:5])
        if code not in CODES or "_" not in ban or g not in ffo and g not in height:
            continue
        f = f or {}
        mur = f.get("mat_mur_txt", "")
        toit = f.get("mat_toit_txt", "")
        mi = walls.setdefault(mur, len(walls)) if mur and mur != "INDETERMINE" else -1
        ti = roofs.setdefault(toit, len(roofs)) if toit and toit != "INDETERMINE" else -1
        year = int(num(f.get("annee_construction")))
        key = ban[6:] if code == ban[:5] else ban
        rows[code][key] = [key, year, mi, ti, round(height.get(g, 0)), int(num(f.get("nb_niveau"))), int(num(f.get("nb_log")))]


def write(walls, roofs, rows):
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for code in sorted(rows):
        out = {"commune": code, "source": "BDNB (CSTB), millésime 2026-02.b",
               "murs": list(walls), "toits": list(roofs), "rows": sorted(rows[code].values(), key=lambda x: x[0])}
        json.dump(out, open(os.path.join(OUT, code + ".json"), "w"), separators=(",", ":"), ensure_ascii=False)
        total += len(out["rows"])
        print(code, len(out["rows"]), "adresses")
    print(total, "adresses")


if __name__ == "__main__":
    main()
