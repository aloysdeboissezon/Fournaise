"""Précalcule la carte de chaleur nocturne de Paris (grille de 100 m) à partir de la BD TOPO de l'IGN.

Usage : python3 scripts/build_heat.py      (après scripts/fetch_sources.py ign)
Entrée  : data/raw/ign/*.json (bâtiments, végétation, eau)
Sorties : js/data-heat.js (embarqué dans la page), data/paris-chaleur-100m.json (même grille, lisible)

Méthode, en trois temps :
  1. Rastérisation à 5 m : emprise et hauteur des bâtiments, zones de végétation, surfaces en eau (mesurées par l'IGN).
  2. Agrégation en mailles de 100 m, puis lissage à l'échelle du quartier : l'air nocturne se mélange
     sur quelques centaines de mètres, et un grand parc rafraîchit ses abords.
  3. Indice d'îlot de chaleur = combinaison linéaire de ces parts (poids de Fournaise, ci-dessous),
     converti en °C : 0 à la maille de la station Montsouris, +1,5 °C en moyenne dans le cœur de Paris
     (1,2 km autour de Châtelet), même calage que la version 1.
"""
import glob, json, math, os
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw", "ign")

LON0, LON1, LAT0, LAT1 = 2.224, 2.47, 48.815, 48.903
KM_LON = 111.32 * math.cos(math.radians(48.86))
KM_LAT = 110.57
FINE = 5.0     # m par pixel de rastérisation
CELL = 100.0   # m par maille
W = int(round((LON1 - LON0) * KM_LON * 1000 / CELL)) * int(CELL / FINE)
H = int(round((LAT1 - LAT0) * KM_LAT * 1000 / CELL)) * int(CELL / FINE)
COLS, ROWS = W * int(FINE) // int(CELL), H * int(FINE) // int(CELL)

MONTSOURIS = (2.3378, 48.8222)
CORE = (2.347, 48.8605)

# Poids de l'indice (°C d'indice par unité) : choix de Fournaise, à caler sur des mesures.
W_BUILT = 2.0     # part bâtie du quartier (rayon ~200 m)
W_HEIGHT = 0.03   # par mètre de hauteur moyenne du bâti (canyons qui piègent la chaleur), plafonné à 30 m
W_VEG = 1.2       # végétation du quartier (rayon ~200 m)
W_VEG_FAR = 1.0   # végétation à plus grande échelle (rayon ~600 m) : bois et grands parcs
W_WATER = 0.6     # eau (Seine, canaux, lacs)
CORE_DELTA = 1.5  # °C : calage du cœur de Paris par rapport à Montsouris


def px(lon, lat):
    return ((lon - LON0) * KM_LON * 1000 / FINE, (LAT1 - lat) * KM_LAT * 1000 / FINE)


def polygons(geom):
    if geom is None:
        return []
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"]
    return []


def rasterize(layer, value=None):
    """Renvoie un raster float32 : 1 (ou la valeur de la propriété) sous les polygones, 0 ailleurs.
    Les trous (cours intérieures, clairières) sont remis à 0."""
    img = Image.new("F", (W, H), 0.0)
    draw = ImageDraw.Draw(img)
    n = 0
    for path in sorted(glob.glob(os.path.join(RAW, layer + "_*.json"))):
        for f in json.load(open(path))["features"]:
            v = 1.0
            if value:
                v = f["properties"].get(value)
                if v is None:
                    v = 3.0 * (f["properties"].get("nombre_d_etages") or 1)
            for poly in polygons(f["geometry"]):
                draw.polygon([px(c[0], c[1]) for c in poly[0]], fill=float(v))
                for hole in poly[1:]:
                    draw.polygon([px(c[0], c[1]) for c in hole], fill=0.0)
            n += 1
    print(layer, n, "objets")
    return np.asarray(img, dtype=np.float32)


def block_mean(a):
    k = int(CELL / FINE)
    return a.reshape(ROWS, k, COLS, k).mean(axis=(1, 3))


def gauss(a, sigma_m):
    s = sigma_m / CELL
    r = int(math.ceil(3 * s))
    x = np.arange(-r, r + 1)
    k = np.exp(-x * x / (2 * s * s)); k /= k.sum()
    pad = np.pad(a, r, mode="edge")
    tmp = np.apply_along_axis(lambda m: np.convolve(m, k, mode="valid"), 1, pad)
    return np.apply_along_axis(lambda m: np.convolve(m, k, mode="valid"), 0, tmp)


def cell_of(lon, lat):
    return int((LAT1 - lat) * KM_LAT * 1000 / CELL), int((lon - LON0) * KM_LON * 1000 / CELL)


def main():
    height = rasterize("batiment", "hauteur")
    built = (height > 0).astype(np.float32)
    veg = rasterize("zone_de_vegetation")
    water = rasterize("surface_hydrographique")
    veg = veg * (1 - built)  # un bâtiment dans un parc n'est pas de la végétation

    B, V, Wt = block_mean(built), block_mean(veg), block_mean(water)
    Hs = block_mean(height)  # hauteur × part bâtie
    Hm = np.where(B > 0.01, Hs / np.maximum(B, 1e-6), 0)

    Bn, Vn, Vfar, Wn = gauss(B, 200), gauss(V, 200), gauss(V, 600), gauss(Wt, 150)
    Hn = gauss(Hs, 200) / np.maximum(Bn, 1e-3)
    raw = W_BUILT * Bn + W_HEIGHT * np.minimum(Hn, 30) - W_VEG * Vn - W_VEG_FAR * Vfar - W_WATER * Wn

    r0, c0 = cell_of(*MONTSOURIS)
    ref = raw[r0, c0]
    rr, cc = np.mgrid[0:ROWS, 0:COLS]
    lon = LON0 + (cc + 0.5) * CELL / 1000 / KM_LON
    lat = LAT1 - (rr + 0.5) * CELL / 1000 / KM_LAT
    dist = np.hypot((lon - CORE[0]) * KM_LON, (lat - CORE[1]) * KM_LAT)
    core = raw[dist <= 1.2].mean()
    k = CORE_DELTA / (core - ref)
    delta = np.clip(k * (raw - ref), -3, 3)
    print("échelle", round(k, 3), "°C par unité d'indice ; cœur", round(core, 3), "Montsouris", round(ref, 3))
    print("delta min/max", round(float(delta.min()), 2), round(float(delta.max()), 2))

    grid = {
        "source": "IGN BD TOPO V3 (Géoplateforme), bâtiments, végétation et eau ; calcul Fournaise",
        "lon0": LON0, "lat1": LAT1, "cellM": CELL, "kmLon": round(KM_LON, 5), "kmLat": KM_LAT,
        "cols": COLS, "rows": ROWS, "scale": round(float(k), 4),
        "weights": {"built": W_BUILT, "height": W_HEIGHT, "veg": W_VEG, "vegFar": W_VEG_FAR, "water": W_WATER},
        # Valeurs ligne par ligne, du nord au sud et d'ouest en est.
        "delta": [int(round(v * 10)) for v in delta.ravel()],      # dixièmes de °C
        "built": [int(round(v * 100)) for v in Bn.ravel()],         # % bâti autour (rayon ~200 m)
        "veg": [int(round(v * 100)) for v in Vn.ravel()],           # % végétation autour
        "height": [int(round(v)) for v in np.minimum(Hn, 99).ravel()]  # hauteur moyenne du bâti (m)
    }
    with open(os.path.join(ROOT, "js", "data-heat.js"), "w") as out:
        out.write("// Généré par scripts/build_heat.py — ne pas modifier à la main.\n")
        out.write("window.FOURNAISE_DATA = window.FOURNAISE_DATA || {};\n")
        out.write("window.FOURNAISE_DATA.heat = " + json.dumps(grid, separators=(",", ":"), ensure_ascii=False) + ";\n")
    json.dump(grid, open(os.path.join(ROOT, "data", "paris-chaleur-100m.json"), "w"), separators=(",", ":"), ensure_ascii=False)
    print("grille", COLS, "x", ROWS)


if __name__ == "__main__":
    main()
