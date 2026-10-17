"""Précalcule la carte de chaleur nocturne de Paris et de la petite couronne (grille de 100 m) à partir de la BD TOPO.

Usage : python3 scripts/build_heat.py      (après scripts/fetch_sources.py admin ign meteofrance et build_lst.py)
Entrées : data/raw/ign/*.json (bâtiments, végétation, eau, BD TOPO IGN), zone : scripts/zone.py
          data/zone-communes.geojson (contours, scripts/build_data.py)
          data/zone-lst-100m.json (températures de surface Landsat d'été, scripts/build_lst.py), facultatif
          data/stations-nuit.json (écarts de Tn mesurés aux stations Météo-France, scripts/check_stations.py), facultatif
Sorties : js/data-heat.js        carte d'ensemble embarquée dans la page (mailles de 400 m, écart de nuit, et tracé de l'eau)
          data/heat/<l>_<c>.json  tuiles fines de 4 km (mailles de 100 m : écart, bâti, végétation, hauteur),
                                  chargées par la page quand une adresse est choisie
          data/zone-chaleur-100m.json  grille fine complète, lisible par d'autres outils

Méthode :
  1. Rastérisation à 5 m : emprise et hauteur des bâtiments, zones de végétation, surfaces en eau (mesurées par l'IGN).
  2. Agrégation en mailles de 100 m, puis lissage à l'échelle du quartier (rayon ~500 m) : l'air nocturne se mélange
     sur quelques centaines de mètres, et un grand parc rafraîchit ses abords.
  3. Écart de nuit = a × volume bâti du quartier (m³ par m² de sol) + b × part de végétation du quartier, nul à la maille
     de la station Montsouris. a et b sont AJUSTÉS (moindres carrés) sur les écarts de température minimale mesurés
     par les stations Météo-France de la zone les nuits où Montsouris reste au-dessus de 20 °C (data/stations-nuit.json,
     scripts/check_stations.py) : c'est de l'air, la nuit, ce que la carte doit représenter. L'erreur est estimée en
     laissant chaque station de côté à tour de rôle. Sans ces stations, poids de départ de Fournaise ci-dessous.
  4. Contrôle : corrélation de la carte avec les températures de surface Landsat d'été (data/zone-lst-100m.json,
     scripts/build_lst.py). Landsat voit la surface vers 12 h 40, pas l'air la nuit : il ne sert plus au calage
     (les pelouses d'aéroport, brûlantes à midi, sont fraîches la nuit), seulement à repérer les incohérences.
"""
import glob, json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from zone import LON0, LON1, LAT0, LAT1, KM_LON, KM_LAT, CELL, COLS, ROWS, TILE, COARSE, MONTSOURIS, CORE

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw", "ign")
FINE = 5.0     # m par pixel de rastérisation
K = int(CELL / FINE)
W, H = COLS * K, ROWS * K

# Poids de départ (sans stations) : choix de Fournaise.
A_VOLUME = 0.3    # °C par m³ de bâti par m² de sol, rayon ~500 m (≈ hauteur moyenne × part bâtie)
B_VEG = -4.5      # °C pour un quartier entièrement végétalisé, rayon ~500 m
SIGMA = 500       # m : échelle du quartier pour l'air de nuit (la meilleure en validation croisée sur les stations)
NIGHT_FACTOR = 1.12  # facteur moyen d'intensité de l'îlot les nuits à Tn ≥ 20 °C (uhiNightFactor de js/model.js)


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
    """Raster float32 : 1 (ou la valeur de la propriété) sous les polygones, 0 ailleurs.
    Les trous (cours intérieures, clairières) sont remis à 0. Un objet lu dans deux pavés est dessiné deux fois, sans effet."""
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
    print(layer, n, "objets", flush=True)
    return np.asarray(img, dtype=np.float32)


def water_rings(min_m2=20000, tol=0.0002):
    """Surfaces en eau de plus de 2 ha (Seine, Marne, lacs), simplifiées à ~15 m et codées comme les contours
    de js/data-paris.js (entiers en 1e-4 degré : premier point puis écarts). Dessin de la carte seulement."""
    from zone import simplify
    feats = {}
    for path in glob.glob(os.path.join(RAW, "surface_hydrographique_*.json")):
        for f in json.load(open(path))["features"]:
            feats[f["id"]] = f
    out = []
    for f in feats.values():
        for poly in polygons(f["geometry"]):
            r = [c[:2] for c in poly[0]]
            a = abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(r, r[1:] + r[:1]))) / 2 * KM_LON * KM_LAT * 1e6
            if a < min_m2:
                continue
            q = [(round(x * 1e4), round(y * 1e4)) for x, y in simplify(r, tol)]
            out.append([q[0][0], q[0][1]] + [v for a_, b in zip(q, q[1:]) for v in (b[0] - a_[0], b[1] - a_[1])])
    return out


def zone_mask():
    """Mailles de 100 m dont le centre est dans Paris ou la petite couronne."""
    img = Image.new("L", (COLS, ROWS), 0)
    draw = ImageDraw.Draw(img)
    for f in json.load(open(os.path.join(ROOT, "data", "zone-communes.geojson")))["features"]:
        for poly in polygons(f["geometry"]):
            draw.polygon([((c[0] - LON0) * KM_LON * 1000 / CELL, (LAT1 - c[1]) * KM_LAT * 1000 / CELL) for c in poly[0]], fill=1)
    return np.asarray(img) > 0


def block_mean(a, k=K):
    r, c = a.shape[0] // k, a.shape[1] // k
    return a[:r * k, :c * k].reshape(r, k, c, k).mean(axis=(1, 3))


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


def fit_stations(feats, ref):
    """Moindres carrés passant par Montsouris : écart mesuré = somme des poids × (part au point − part à Montsouris).
    Renvoie les poids, l'ajustement et l'erreur en validation croisée (chaque station laissée de côté à tour de rôle)."""
    path = os.path.join(ROOT, "data", "stations-nuit.json")
    if not os.path.exists(path):
        return {"volume": A_VOLUME, "veg": B_VEG}, None
    st = [s for s in json.load(open(path))["stations"] if s["calage"]]
    names = list(feats)
    X = np.array([[feats[n][cell_of(s["lon"], s["lat"])] - feats[n][ref] for n in names] for s in st])
    y = np.array([s["ecartNuitsChaudes"] / NIGHT_FACTOR for s in st])
    coef = np.linalg.lstsq(X, y, rcond=None)[0]
    loo = []
    for i in range(len(st)):
        keep = [j for j in range(len(st)) if j != i]
        c = np.linalg.lstsq(X[keep], y[keep], rcond=None)[0]
        loo.append(y[i] - X[i] @ c)
    pred = X @ coef
    rows = []
    for s, yi, pi, li in zip(st, y, pred, loo):
        rows.append({"nom": s["nom"], "mesure": round(float(yi), 2), "carte": round(float(pi), 2), "sansElle": round(float(yi - li), 2)})
        print(f"  {s['nom']:<22} mesuré {yi:+.2f} °C  carte {pi:+.2f} °C  (sans cette station {yi - li:+.2f})")
    fit = {"stations": rows, "rmse": round(float(np.sqrt(((y - pred) ** 2).mean())), 2),
           "rmseValidation": round(float(np.sqrt(np.mean(np.square(loo)))), 2),
           "rmseSansCarte": round(float(np.sqrt((y ** 2).mean())), 2)}
    print("écart quadratique moyen : ajustement", fit["rmse"], "°C, validation croisée", fit["rmseValidation"], "°C, sans carte", fit["rmseSansCarte"], "°C")
    return {n: round(float(c), 4) for n, c in zip(names, coef)}, fit


def main():
    cache = os.path.join(ROOT, "data", "raw", "heat-parts.npz")  # parts par maille, pour relancer vite le calage
    if os.path.exists(cache) and os.path.getmtime(cache) > max(os.path.getmtime(p) for p in glob.glob(os.path.join(RAW, "*.json"))):
        z = np.load(cache)
        B, V, Wt, Hs = z["B"], z["V"], z["Wt"], z["Hs"]
    else:
        height = rasterize("batiment", "hauteur")
        built = (height > 0).astype(np.float32)
        veg = rasterize("zone_de_vegetation") * (1 - built)  # un bâtiment dans un parc n'est pas de la végétation
        water = rasterize("surface_hydrographique")
        B, V, Wt = block_mean(built), block_mean(veg), block_mean(water)
        Hs = block_mean(height)  # hauteur × part bâtie
        del height, built, veg, water
        np.savez_compressed(cache, B=B, V=V, Wt=Wt, Hs=Hs)

    Bn, Vn = gauss(B, 200), gauss(V, 200)                  # descriptions affichées (rayon ~200 m)
    Hn = np.minimum(gauss(Hs, 200) / np.maximum(Bn, 1e-3), 60)
    feats = {"volume": gauss(Hs, SIGMA), "veg": gauss(V, SIGMA)}  # variables de l'écart de nuit (rayon ~500 m)
    r0, c0 = cell_of(*MONTSOURIS)
    wts, stations = fit_stations(feats, (r0, c0))
    raw = sum(wts[n] * feats[n] for n in feats)
    delta = np.clip(raw - raw[r0, c0], -4, 4)
    mask = zone_mask()
    rr, cc = np.mgrid[0:ROWS, 0:COLS]
    core = np.hypot((LON0 + (cc + 0.5) * CELL / 1000 / KM_LON - CORE[0]) * KM_LON, (LAT1 - (rr + 0.5) * CELL / 1000 / KM_LAT - CORE[1]) * KM_LAT) <= 1.2
    print("poids", wts, "; delta dans la zone min/max", round(float(delta[mask].min()), 2), round(float(delta[mask].max()), 2),
          "; cœur de Paris", round(float(delta[core].mean()), 2), "°C")
    landsat = None
    lst_path = os.path.join(ROOT, "data", "zone-lst-100m.json")
    if os.path.exists(lst_path):
        lst = np.array(json.load(open(lst_path))["anomaly"], float).reshape(ROWS, COLS) / 10
        m = (lst > -99) & mask
        landsat = {"r": round(float(np.corrcoef(delta[m], gauss(np.where(lst > -99, lst, 0), SIGMA)[m])[0, 1]), 2), "cells": int(m.sum())}
        print("corrélation avec Landsat (surface de jour, même lissage)", landsat)

    meta = {
        "source": "IGN BD TOPO V3 (bâtiments, végétation, eau), poids ajustés sur les stations Météo-France (Tn des nuits chaudes) ; calcul Fournaise",
        "stationFit": stations, "landsatCheck": landsat,
        "lon0": LON0, "lat1": LAT1, "kmLon": round(KM_LON, 5), "kmLat": KM_LAT,
        "weights": wts, "sigmaM": SIGMA, "tile": TILE,
    }
    fields = {
        "delta": np.round(delta * 10).astype(int),             # dixièmes de °C
        "built": np.round(Bn * 100).astype(int),               # % bâti autour (rayon ~200 m)
        "veg": np.round(Vn * 100).astype(int),                 # % végétation autour
        "height": np.round(Hn).astype(int),                    # hauteur moyenne du bâti (m)
    }
    # Grille complète, lisible
    full = dict(meta, cellM=CELL, cols=COLS, rows=ROWS, **{n: a.ravel().tolist() for n, a in fields.items()})
    json.dump(full, open(os.path.join(ROOT, "data", "zone-chaleur-100m.json"), "w"), separators=(",", ":"), ensure_ascii=False)

    # Tuiles fines : seulement celles qui touchent la zone
    out = os.path.join(ROOT, "data", "heat")
    os.makedirs(out, exist_ok=True)
    for f in glob.glob(os.path.join(out, "*.json")):
        os.remove(f)
    tiles = []
    for tr in range(0, ROWS, TILE):
        for tc in range(0, COLS, TILE):
            if not mask[max(0, tr - 1):tr + TILE + 1, max(0, tc - 1):tc + TILE + 1].any():
                continue
            sl = (slice(tr, tr + TILE), slice(tc, tc + TILE))
            t = {"r0": tr, "c0": tc, "rows": fields["delta"][sl].shape[0], "cols": fields["delta"][sl].shape[1]}
            t.update({n: a[sl].ravel().tolist() for n, a in fields.items()})
            name = f"{tr // TILE}_{tc // TILE}"
            json.dump(t, open(os.path.join(out, name + ".json"), "w"), separators=(",", ":"))
            tiles.append(name)

    # Carte d'ensemble : moyenne par blocs de COARSE × COARSE mailles, eau marquée pour le dessin de la carte
    cd = block_mean(delta, COARSE)
    cm = block_mean(mask.astype(float), COARSE) > 0
    coarse = dict(meta, cellM=CELL * COARSE, fineM=CELL, cols=cd.shape[1], rows=cd.shape[0], tiles=tiles,
                  delta=[int(round(v * 10)) if m else 0 for v, m in zip(cd.ravel(), cm.ravel())],
                  water=water_rings())
    with open(os.path.join(ROOT, "js", "data-heat.js"), "w") as fh:
        fh.write("// Généré par scripts/build_heat.py — ne pas modifier à la main.\n")
        fh.write("window.FOURNAISE_DATA = window.FOURNAISE_DATA || {};\n")
        fh.write("window.FOURNAISE_DATA.heat = " + json.dumps(coarse, separators=(",", ":"), ensure_ascii=False) + ";\n")
    print("grille", COLS, "x", ROWS, ";", len(tiles), "tuiles ; carte d'ensemble", cd.shape[1], "x", cd.shape[0])


if __name__ == "__main__":
    main()
