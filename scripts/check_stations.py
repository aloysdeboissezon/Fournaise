"""Écarts de température minimale entre les stations Météo-France de la zone et Paris-Montsouris, l'été.

Usage : python3 scripts/check_stations.py      (après scripts/fetch_sources.py meteofrance)
Entrée  : data/raw/meteofrance/Q_*.csv.gz (données quotidiennes officielles)
Sortie  : data/stations-nuit.json, lu par scripts/build_heat.py pour caler l'échelle de la carte de chaleur.

Pour chaque station dans le rectangle de la zone (scripts/zone.py) avec au moins 600 jours d'été (juin-septembre
2017-2026) en commun avec Montsouris : écart moyen de Tn, écart les nuits où Montsouris reste au-dessus de 20 °C
(celles qui comptent pour le sommeil), écart moyen de Tx. Sont écartées du calage : Montsouris et son doublon,
la tour Eiffel (capteur à 330 m de haut) et les stations à moins de 100 nuits chaudes en commun.
"""
import csv, glob, gzip, json, os, sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = "75114001"
SKIP = {REF: "station de référence", "75114007": "doublon de Montsouris", "75107005": "capteur à 330 m de haut"}


def main():
    meta, data = {}, defaultdict(dict)
    for path in sorted(glob.glob(os.path.join(ROOT, "data", "raw", "meteofrance", "Q_*.csv.gz"))):
        with gzip.open(path, "rt") as fh:
            for r in csv.DictReader(fh, delimiter=";"):
                d = r["AAAAMMJJ"]
                if d < "20170601" or d[4:6] not in ("06", "07", "08", "09") or not r["TN"] or not r["TX"]:
                    continue
                lat, lon = float(r["LAT"]), float(r["LON"])
                if not (zone.LON0 <= lon <= zone.LON1 and zone.LAT0 <= lat <= zone.LAT1):
                    continue
                meta[r["NUM_POSTE"]] = {"id": r["NUM_POSTE"], "nom": r["NOM_USUEL"].strip(), "lat": lat, "lon": lon, "alt": int(float(r["ALTI"] or 0))}
                data[r["NUM_POSTE"]][d] = (float(r["TN"]), float(r["TX"]))
    ref = data[REF]
    out = []
    for k, v in sorted(data.items()):
        common = [d for d in v if d in ref]
        if len(common) < 600:
            continue
        hot = [d for d in common if ref[d][0] >= 20]
        s = dict(meta[k], jours=len(common), nuitsChaudes=len(hot),
                 ecartTn=round(sum(v[d][0] - ref[d][0] for d in common) / len(common), 2),
                 ecartNuitsChaudes=round(sum(v[d][0] - ref[d][0] for d in hot) / max(1, len(hot)), 2),
                 ecartTx=round(sum(v[d][1] - ref[d][1] for d in common) / len(common), 2))
        s["calage"] = k not in SKIP and len(hot) >= 60
        s["note"] = SKIP.get(k, "" if s["calage"] else "trop peu de nuits chaudes")
        out.append(s)
        print(f"{k} {s['nom']:<22} {s['alt']:>4} m  {len(common):>5} j  {len(hot):>3} nuits ≥ 20 °C  "
              f"Tn {s['ecartTn']:+.2f}  nuits chaudes {s['ecartNuitsChaudes']:+.2f}  Tx {s['ecartTx']:+.2f}  {s['note']}")
    json.dump({"source": "Météo-France, données quotidiennes (data.gouv.fr), étés 2017-2026", "reference": REF, "stations": out},
              open(os.path.join(ROOT, "data", "stations-nuit.json"), "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
