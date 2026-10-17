"""Précalcule la carte de chaleur nocturne de Paris (grille de 100 m) à partir de la BD TOPO de l'IGN.

Usage : python3 scripts/build_heat.py      (après scripts/fetch_sources.py ign, fetch_trees.py et build_lst.py)
Entrées : data/raw/ign/*.json (bâtiments, végétation, eau, BD TOPO IGN)
          data/raw/trees/arbres.csv (arbres de la Ville de Paris, 220 181 arbres)
          data/paris-lst-100m.json (températures de surface Landsat d'été, scripts/build_lst.py), facultatif
Sorties : js/data-heat.js (embarqué dans la page), data/paris-chaleur-100m.json (même grille, lisible)

Méthode, en trois temps :
  1. Rastérisation à 5 m : emprise et hauteur des bâtiments, zones de végétation, surfaces en eau (mesurées par l'IGN).
  2. Agrégation en mailles de 100 m, puis lissage à l'échelle du quartier : l'air nocturne se mélange
     sur quelques centaines de mètres, et un grand parc rafraîchit ses abords.
  3. Indice d'îlot de chaleur = combinaison linéaire de ces parts. Quand les températures de surface Landsat
     sont disponibles, les poids sont AJUSTÉS dessus (moindres carrés, mailles de 100 m, journées chaudes) ;
     sinon ce sont les poids de départ de Fournaise, ci-dessous. L'indice est converti en °C : 0 à la maille
     de la station Montsouris, +1,5 °C en moyenne dans le cœur de Paris (1,2 km autour de Châtelet).
     Ce calage de l'amplitude reste un choix : Landsat voit la surface en fin de matinée, pas l'air la nuit.
"""
import csv, glob, json, math, os
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
W_TREES = 1.0     # canopée des arbres de rue et de parc (hors zones de végétation IGN)
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


def tree_canopy():
    """Part de chaque maille couverte par la couronne des arbres de la Ville (rayon estimé : hauteur / 3, de 1,5 à 6 m)."""
    path = os.path.join(ROOT, "data", "raw", "trees", "arbres.csv")
    if not os.path.exists(path):
        return None
    area = np.zeros((ROWS, COLS))
    n = 0
    with open(path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f, delimiter=";"):
            try:
                lat, lon = (float(v) for v in row["geo_point_2d"].split(","))
                h = float(row["hauteurenm"] or 0)
            except ValueError:
                continue
            c, r = int((lon - LON0) * KM_LON * 1000 / CELL), int((LAT1 - lat) * KM_LAT * 1000 / CELL)
            if 0 <= c < COLS and 0 <= r < ROWS:
                rad = min(6.0, max(1.5, h / 3.0)) if h > 0 else 2.5
                area[r, c] += math.pi * rad * rad
                n += 1
    print("arbres", n)
    return np.minimum(area / (CELL * CELL), 1.0)


def fit_weights(feats, names, lst):
    """Moindres carrés de l'écart de température de surface sur les parts du quartier (mailles mesurées).
    Contrainte physique : bâti et hauteur réchauffent, végétation, arbres et eau rafraîchissent. Une variable dont
    le coefficient prendrait le mauvais signe (colinéarité entre parts) est retirée puis le reste est réajusté."""
    sign = {"built": 1, "height": 1, "veg": -1, "vegFar": -1, "water": -1, "trees": -1}
    y = np.array(lst["anomaly"], float).reshape(ROWS, COLS) / 10
    m = y > -99
    keep = list(range(len(names)))
    while True:
        X = np.stack([feats[i][m] * sign[names[i]] for i in keep] + [np.ones(m.sum())], axis=1)
        coef, *_ = np.linalg.lstsq(X, y[m], rcond=None)
        bad = [k for k, c in zip(keep, coef[:-1]) if c < 0]
        if not bad:
            break
        worst = min(bad, key=lambda k: coef[keep.index(k)])
        keep.remove(worst)
    pred = X @ coef
    r2 = 1 - ((y[m] - pred) ** 2).sum() / ((y[m] - y[m].mean()) ** 2).sum()
    out = {n: 0.0 for n in names}
    for k, c in zip(keep, coef[:-1]):
        out[names[k]] = round(float(c) * sign[names[k]], 3)
    return out, round(float(r2), 3), int(m.sum())


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
    T = tree_canopy()
    Tn = gauss(T * (1 - np.minimum(V * 3, 1)), 200) if T is not None else np.zeros_like(Bn)  # arbres hors parcs déjà comptés en végétation
    wts = {"built": W_BUILT, "height": W_HEIGHT, "veg": -W_VEG, "vegFar": -W_VEG_FAR, "water": -W_WATER, "trees": -W_TREES}
    fit = None
    lst_path = os.path.join(ROOT, "data", "paris-lst-100m.json")
    if os.path.exists(lst_path):
        names = ["built", "height", "veg", "vegFar", "water", "trees"]
        feats = [Bn, np.minimum(Hn, 30), Vn, Vfar, Wn, Tn]
        wts, r2, ncell = fit_weights(feats, names, json.load(open(lst_path)))
        fit = {"r2": r2, "cells": ncell}
        print("poids ajustés sur Landsat", wts, "R²", r2, "mailles", ncell)
    raw = wts["built"] * Bn + wts["height"] * np.minimum(Hn, 30) + wts["veg"] * Vn + wts["vegFar"] * Vfar + wts["water"] * Wn + wts["trees"] * Tn

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
        "source": "IGN BD TOPO V3 (bâtiments, végétation, eau), arbres de la Ville de Paris, poids ajustés sur Landsat 8/9 ; calcul Fournaise",
        "landsatFit": fit,
        "lon0": LON0, "lat1": LAT1, "cellM": CELL, "kmLon": round(KM_LON, 5), "kmLat": KM_LAT,
        "cols": COLS, "rows": ROWS, "scale": round(float(k), 4),
        "weights": wts,
        # Valeurs ligne par ligne, du nord au sud et d'ouest en est.
        "delta": [int(round(v * 10)) for v in delta.ravel()],      # dixièmes de °C
        "built": [int(round(v * 100)) for v in Bn.ravel()],         # % bâti autour (rayon ~200 m)
        "veg": [int(round(v * 100)) for v in Vn.ravel()],           # % végétation autour
        "trees": [int(round(v * 100)) for v in Tn.ravel()],         # % canopée d'arbres autour
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
