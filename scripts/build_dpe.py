"""Regroupe par adresse les DPE de Paris (ADEME) et écrit un fichier JSON par arrondissement.

Usage : python3 scripts/build_dpe.py      (après scripts/fetch_sources.py dpe)
Entrée  : data/raw/dpe/p*.json (DPE logements existants depuis juillet 2021, département 75)
Sorties : data/dpe/75101.json … 75120.json, chargés par la page quand une adresse est choisie.

Chaque adresse (identifiant de la Base Adresse Nationale) devient une ligne :
  [numéro BAN sans le code commune, lon, lat, nombre de DPE,
   confort d'été [bon, moyen, insuffisant], protection solaire extérieure [oui, non],
   traversant [oui, non], année de construction médiane (0 si inconnue),
   étiquettes [A, B, C, D, E, F, G], étage le plus haut renseigné (-1 si inconnu)]
Plusieurs DPE peuvent concerner le même logement (diagnostic refait) : ce sont des DPE, pas des logements.
"""
import glob, json, os, re, statistics
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw", "dpe")
OUT = os.path.join(ROOT, "data", "dpe")
ETE = {"bon": 0, "moyen": 1, "insuffisant": 2}
ETQ = "ABCDEFG"
# Seuls les identifiants au numéro (commune_voie_numéro[_suffixe]) sont gardés : les autres ne sont localisés qu'à la rue.
HOUSENUMBER = re.compile(r"^751\d\d_[0-9a-z]{4}_\d{5}(_[a-z0-9]+)?$")


def main():
    acc = {}
    seen = 0
    for path in sorted(glob.glob(os.path.join(RAW, "p*.json"))):
        for r in json.load(open(path))["results"]:
            seen += 1
            ban, geo = r.get("identifiant_ban"), r.get("_geopoint")
            if not ban or not geo or not HOUSENUMBER.match(ban):
                continue
            a = acc.get(ban)
            if a is None:
                lat, lon = (float(v) for v in geo.split(","))
                a = acc[ban] = {"lon": lon, "lat": lat, "n": 0, "ete": [0, 0, 0], "prot": [0, 0], "trav": [0, 0],
                                "years": [], "etq": [0] * 7, "floor": -1}
            a["n"] += 1
            if r.get("indicateur_confort_ete") in ETE:
                a["ete"][ETE[r["indicateur_confort_ete"]]] += 1
            if r.get("protection_solaire_exterieure") in (0, 1):
                a["prot"][1 - r["protection_solaire_exterieure"]] += 1
            if r.get("logement_traversant") in (0, 1):
                a["trav"][1 - r["logement_traversant"]] += 1
            y = r.get("annee_construction")
            if isinstance(y, (int, float)) and 1500 < y <= 2027:
                a["years"].append(int(y))
            if r.get("etiquette_dpe") in ETQ:
                a["etq"][ETQ.index(r["etiquette_dpe"])] += 1
            f = r.get("numero_etage_appartement")
            if isinstance(f, (int, float)) and 0 <= f < 60:
                a["floor"] = max(a["floor"], int(f))
    by_arr = defaultdict(list)
    for ban, a in acc.items():
        year = int(statistics.median(a["years"])) if a["years"] else 0
        by_arr[ban[:5]].append([ban[6:], round(a["lon"], 5), round(a["lat"], 5), a["n"], a["ete"], a["prot"], a["trav"],
                                year, a["etq"], a["floor"]])
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for code in sorted(by_arr):
        rows = sorted(by_arr[code], key=lambda r: r[0])
        json.dump({"commune": code, "source": "ADEME, DPE logements existants depuis juillet 2021", "rows": rows},
                  open(os.path.join(OUT, code + ".json"), "w"), separators=(",", ":"))
        total += len(rows)
        print(code, len(rows), "adresses")
    print(seen, "DPE lus,", total, "adresses")


if __name__ == "__main__":
    main()
