"""Télécharge les données brutes de Paris dans data/raw/ (non versionné, plusieurs centaines de Mo).

Usage : python3 scripts/fetch_sources.py [ign] [dpe]
Sources :
  IGN BD TOPO V3 (Géoplateforme, WFS data.geopf.fr) : bâtiments (emprise, hauteur), zones de végétation,
    surfaces en eau, dans le rectangle de Paris.
  ADEME, DPE logements existants depuis juillet 2021 (data.ademe.fr, jeu meg-83tjwtg8dyz4vv7h1dqe),
    tous les DPE du département 75.
Chaque page est enregistrée telle quelle ; relancer le script reprend là où il s'est arrêté.
"""
import json, os, subprocess, sys, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")

IGN_BBOX = "48.815,2.224,48.903,2.47,urn:ogc:def:crs:EPSG::4326"
IGN_LAYERS = {"batiment": "geometrie,hauteur,nombre_d_etages,usage_1,nombre_de_logements",
              "zone_de_vegetation": "geometrie,nature",
              "surface_hydrographique": "geometrie,nature"}
DPE_URL = "https://data.ademe.fr/data-fair/api/v1/datasets/meg-83tjwtg8dyz4vv7h1dqe/lines"
DPE_FIELDS = ("identifiant_ban,_geopoint,indicateur_confort_ete,protection_solaire_exterieure,logement_traversant,"
              "numero_etage_appartement,etiquette_dpe,annee_construction,type_batiment,date_etablissement_dpe")


def get(url, path):
    """curl avec reprises : les API publiques coupent souvent les longues réponses."""
    for i in range(12):
        r = subprocess.run(["curl", "-s", "-m", "300", "-o", path, "-w", "%{http_code}", url], capture_output=True, text=True)
        if r.stdout == "200":
            try:
                return json.load(open(path))
            except ValueError:
                pass
        print("  nouvel essai", r.stdout, file=sys.stderr, flush=True)
        time.sleep(3 + 3 * i)
    raise SystemExit("échec : " + url)


def fetch_ign():
    out = os.path.join(RAW, "ign")
    os.makedirs(out, exist_ok=True)
    for layer, props in IGN_LAYERS.items():
        start, n = 0, 5000
        while True:
            path = os.path.join(out, f"{layer}_{start:06d}.json")
            if os.path.exists(path):
                d = json.load(open(path))
            else:
                q = {"SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "OUTPUTFORMAT": "application/json",
                     "TYPENAMES": "BDTOPO_V3:" + layer, "BBOX": IGN_BBOX, "COUNT": n, "STARTINDEX": start,
                     "SORTBY": "cleabs", "SRSNAME": "EPSG:4326", "PROPERTYNAME": props}
                d = get("https://data.geopf.fr/wfs/ows?" + urllib.parse.urlencode(q), path + ".tmp")
                os.rename(path + ".tmp", path)
            print(layer, start, len(d["features"]), flush=True)
            if len(d["features"]) < n:
                break
            start += n


def fetch_dpe():
    out = os.path.join(RAW, "dpe")
    os.makedirs(out, exist_ok=True)
    state = os.path.join(out, "next.txt")
    if os.path.exists(state):
        url = open(state).read().strip()
    else:
        url = DPE_URL + "?" + urllib.parse.urlencode({"qs": "code_departement_ban:75", "size": 10000, "select": DPE_FIELDS, "sort": "_i"})
    page = len([f for f in os.listdir(out) if f.startswith("p")])
    while url:
        d = get(url, os.path.join(out, "tmp.json"))
        os.rename(os.path.join(out, "tmp.json"), os.path.join(out, f"p{page:04d}.json"))
        page += 1
        url = d.get("next") if d["results"] else None
        open(state, "w").write(url or "")
        print("DPE page", page, len(d["results"]), flush=True)


if __name__ == "__main__":
    what = sys.argv[1:] or ["ign", "dpe"]
    if "ign" in what:
        fetch_ign()
    if "dpe" in what:
        fetch_dpe()
