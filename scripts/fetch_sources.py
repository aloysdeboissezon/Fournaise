"""Télécharge les données brutes de Paris et de la petite couronne dans data/raw/ (non versionné, plusieurs Go).

Usage : python3 scripts/fetch_sources.py [admin] [ign] [dpe] [trees] [bdnb] [landsat] [meteofrance] [--dep 92,93,94] [--box 00,01]
Sources (zone et départements : scripts/zone.py) :
  IGN ADMIN EXPRESS COG CARTO (WFS data.geopf.fr) : contours des communes et des arrondissements de Paris.
  IGN BD TOPO V3 (Géoplateforme, WFS data.geopf.fr) : bâtiments (emprise, hauteur), zones de végétation,
    surfaces en eau, dans le rectangle de la zone, découpé en 16 pavés pour que le service réponde.
  ADEME, DPE logements existants depuis juillet 2021 (data.ademe.fr, jeu meg-83tjwtg8dyz4vv7h1dqe),
    tous les DPE des départements demandés.
  Arbres de la Ville de Paris (opendata.paris.fr, jeu « les-arbres », 220 181 arbres) : Paris seulement.
  BDNB (CSTB), archive « open data » par département, millésime 2026-02.b (open-data.s3.fr-par.scw.cloud, ~275 Mo chacune).
  Landsat 8 et 9, collection 2 niveau 2, bande thermique ST_B10 (USGS), via le catalogue Microsoft Planetary Computer :
    scènes de juin à septembre 2019-2025 avec moins de 10 % de nuages, fenêtre sur la zone. Nécessite rasterio.
  Météo-France, données quotidiennes des départements 75, 78, 91, 92, 93, 94, 95 (object.files.data.gouv.fr) :
    contrôle de data/montsouris-raw/ et comparaison des stations de banlieue (scripts/check_stations.py).
Chaque page est enregistrée telle quelle ; relancer le script reprend là où il s'est arrêté.
"""
import json, os, subprocess, sys, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zone

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


def fetch_admin():
    out = os.path.join(RAW, "admin")
    os.makedirs(out, exist_ok=True)
    deps = ",".join("'%s'" % d for d in zone.DEPTS)
    for layer in ("commune", "arrondissement_municipal"):
        q = {"SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "OUTPUTFORMAT": "application/json",
             "TYPENAMES": "ADMINEXPRESS-COG-CARTO.LATEST:" + layer, "SRSNAME": "EPSG:4326",
             "CQL_FILTER": "code_insee_du_departement IN (%s)" % deps if layer == "commune" else "code_insee_de_la_commune_de_rattach='75056'"}
        d = get("https://data.geopf.fr/wfs/ows?" + urllib.parse.urlencode(q), os.path.join(out, layer + ".json"))
        print(layer, len(d["features"]))


def ign_boxes(k=4):
    """Rectangle de la zone découpé en k × k pavés (un objet à cheval sur deux pavés est lu deux fois, sans effet)."""
    dl, dt = (zone.LON1 - zone.LON0) / k, (zone.LAT1 - zone.LAT0) / k
    for i in range(k):
        for j in range(k):
            yield f"{i}{j}", (zone.LAT0 + j * dt, zone.LON0 + i * dl, zone.LAT0 + (j + 1) * dt, zone.LON0 + (i + 1) * dl)


def fetch_ign(only=None):
    out = os.path.join(RAW, "ign")
    os.makedirs(out, exist_ok=True)
    for layer, props in IGN_LAYERS.items():
        for box, (a, b, c, d_) in ign_boxes():
            if only and box not in only:
                continue
            start, n = 0, 5000
            while True:
                path = os.path.join(out, f"{layer}_{box}_{start:06d}.json")
                if os.path.exists(path):
                    d = json.load(open(path))
                else:
                    q = {"SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "OUTPUTFORMAT": "application/json",
                         "TYPENAMES": "BDTOPO_V3:" + layer, "BBOX": f"{a},{b},{c},{d_},urn:ogc:def:crs:EPSG::4326",
                         "COUNT": n, "STARTINDEX": start, "SORTBY": "cleabs", "SRSNAME": "EPSG:4326", "PROPERTYNAME": props}
                    d = get("https://data.geopf.fr/wfs/ows?" + urllib.parse.urlencode(q), path + ".tmp")
                    os.rename(path + ".tmp", path)
                print(layer, box, start, len(d["features"]), flush=True)
                if len(d["features"]) < n:
                    break
                start += n


def fetch_dpe(dep):
    out = os.path.join(RAW, "dpe", dep)
    os.makedirs(out, exist_ok=True)
    state = os.path.join(out, "next.txt")
    if os.path.exists(state):
        url = open(state).read().strip()
    else:
        url = DPE_URL + "?" + urllib.parse.urlencode({"qs": "code_departement_ban:" + dep, "size": 10000, "select": DPE_FIELDS, "sort": "_i"})
    page = len([f for f in os.listdir(out) if f.startswith("p")])
    while url:
        d = get(url, os.path.join(out, "tmp.json"))
        os.rename(os.path.join(out, "tmp.json"), os.path.join(out, f"p{page:04d}.json"))
        page += 1
        url = d.get("next") if d["results"] else None
        open(state, "w").write(url or "")
        print("DPE", dep, "page", page, len(d["results"]), flush=True)


def fetch_trees():
    out = os.path.join(RAW, "trees")
    os.makedirs(out, exist_ok=True)
    url = ("https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/les-arbres/exports/csv?"
           "select=idbase,geo_point_2d,hauteurenm,circonferenceencm,stadedeveloppement,domanialite&delimiter=%3B")
    for i in range(6):
        r = subprocess.run(["curl", "-s", "-m", "280", "-o", os.path.join(out, "arbres.csv"), "-w", "%{http_code}", url], capture_output=True, text=True)
        if r.stdout == "200":
            return print("arbres.csv téléchargé")
        time.sleep(3 + 3 * i)
    raise SystemExit("échec : arbres de Paris")


def fetch_bdnb(dep):
    out = os.path.join(RAW, "bdnb", dep)
    os.makedirs(out, exist_ok=True)
    url = (f"https://open-data.s3.fr-par.scw.cloud/bdnb_millesime_2026-02-b/millesime_2026-02-b_dep{dep}/"
           f"open_data_millesime_2026-02-b_dep{dep}_csv.zip")
    zpath = os.path.join(out, f"dep{dep}.zip")
    for i in range(6):
        r = subprocess.run(["curl", "-s", "-m", "500", "-C", "-", "-o", zpath, "-w", "%{http_code}", url], capture_output=True, text=True)
        if r.stdout in ("200", "206", "416"):
            break
        time.sleep(3 + 3 * i)
    else:
        raise SystemExit("échec : BDNB " + dep)
    wanted = ["csv/batiment_groupe_ffo_bat.csv", "csv/batiment_groupe_bdtopo_bat.csv", "csv/rel_batiment_groupe_adresse.csv"]
    subprocess.run(["unzip", "-o", "-q", zpath] + wanted + ["-d", out], check=True)
    os.remove(zpath)
    print("BDNB extraite dans", out)


def fetch_landsat():
    import numpy as np, rasterio, urllib.request
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds
    out = os.path.join(RAW, "landsat")
    os.makedirs(out, exist_ok=True)
    bbox = (zone.LON0, zone.LAT0, zone.LON1, zone.LAT1)
    body = json.dumps({"collections": ["landsat-c2-l2"], "bbox": list(bbox), "datetime": "2019-06-01/2025-09-30", "limit": 200,
                       "query": {"eo:cloud_cover": {"lt": 10}, "platform": {"in": ["landsat-8", "landsat-9"]}}}).encode()
    req = urllib.request.Request("https://planetarycomputer.microsoft.com/api/stac/v1/search", body, {"content-type": "application/json"})
    items = [f for f in json.load(urllib.request.urlopen(req, timeout=90))["features"] if f["properties"]["datetime"][5:7] in ("06", "07", "08", "09")]
    token = json.load(urllib.request.urlopen("https://planetarycomputer.microsoft.com/api/sas/v1/token/landsat-c2-l2", timeout=60))["token"]
    for f in items:
        path = os.path.join(out, f["id"] + ".npz")
        if os.path.exists(path):
            continue
        got = {}
        for key in ("lwir11", "qa_pixel"):
            with rasterio.open(f["assets"][key]["href"] + "?" + token) as ds:
                win = from_bounds(*transform_bounds("EPSG:4326", ds.crs, *bbox), transform=ds.transform)
                got[key] = ds.read(1, window=win)
                tr, crs = ds.window_transform(win), str(ds.crs)
        np.savez_compressed(path, lwir=got["lwir11"], qa=got["qa_pixel"], tr=np.array(tr)[:6], crs=crs)
        print(f["id"], flush=True)


def fetch_meteofrance():
    out = os.path.join(RAW, "meteofrance")
    os.makedirs(out, exist_ok=True)
    base = "https://object.files.data.gouv.fr/meteofrance/data/synchro_ftp/BASE/QUOT/"
    for name in (f"Q_{d}_{p}_RR-T-Vent.csv.gz" for d in ("75", "78", "91", "92", "93", "94", "95")
                 for p in ("previous-1950-2024", "latest-2025-2026")):
        for i in range(6):
            r = subprocess.run(["curl", "-s", "-m", "280", "-o", os.path.join(out, name), "-w", "%{http_code}", base + name], capture_output=True, text=True)
            if r.stdout == "200":
                break
            time.sleep(3 + 3 * i)
        else:
            raise SystemExit("échec : " + name)
        print(name)


if __name__ == "__main__":
    args = sys.argv[1:]
    deps = zone.DEPTS
    if "--dep" in args:
        i = args.index("--dep")
        deps = args[i + 1].split(",")
        del args[i:i + 2]
    boxes = None
    if "--box" in args:  # pour lancer plusieurs téléchargements IGN en parallèle, un par groupe de pavés
        i = args.index("--box")
        boxes = args[i + 1].split(",")
        del args[i:i + 2]
    what = args or ["admin", "ign", "dpe", "trees", "bdnb", "landsat", "meteofrance"]
    if "admin" in what:
        fetch_admin()
    if "ign" in what:
        fetch_ign(boxes)
    if "dpe" in what:
        for dep in deps:
            fetch_dpe(dep)
    if "trees" in what:
        fetch_trees()
    if "bdnb" in what:
        for dep in deps:
            fetch_bdnb(dep)
    if "landsat" in what:
        fetch_landsat()
    if "meteofrance" in what:
        fetch_meteofrance()
