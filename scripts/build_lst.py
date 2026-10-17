"""Moyenne des températures de surface Landsat d'été sur la grille de 100 m de Paris et de la petite couronne.

Usage : python3 scripts/build_lst.py      (après scripts/fetch_sources.py landsat)
Entrée  : data/raw/landsat/*.npz  (bande thermique ST_B10 de Landsat 8/9 collection 2 niveau 2 + masque de qualité)
Sortie  : data/zone-lst-100m.json : écart moyen de température de surface (°C, dixièmes) à la moyenne de la zone,
          mailles de la grille de scripts/zone.py (nord au sud, ouest en est), -999 = pas de mesure.

Chaque scène (journée où Paris intra-muros dépasse 34 °C en surface) : pixels nuageux, ombrés ou sans donnée écartés,
conversion en °C (K = 0,00341802 × DN + 149), écart à la moyenne de la zone ce jour-là, puis moyenne des scènes.
Landsat passe vers 10 h 40 UTC : c'est la surface en milieu de matinée, pas l'air la nuit.
"""
import glob, json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from zone import LON0, LAT1, KM_LON, KM_LAT, CELL, COLS, ROWS

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw", "landsat")
G = {"lon0": LON0, "lat1": LAT1, "kmLon": KM_LON, "kmLat": KM_LAT, "cellM": CELL}
MIN_PARIS = 34.0  # °C : on ne garde que les journées chaudes, celles où les contrastes de quartier comptent


def masks():
    """Mailles de la zone, et de Paris intra-muros (sélection des scènes, comme avant l'extension)."""
    out = {}
    for name, keep in (("zone", lambda c: True), ("paris", lambda c: c.startswith("75"))):
        img = Image.new("L", (COLS, ROWS), 0)
        draw = ImageDraw.Draw(img)
        for f in json.load(open(os.path.join(ROOT, "data", "zone-communes.geojson")))["features"]:
            if not keep(f["properties"]["code"]):
                continue
            g = f["geometry"]
            for poly in g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]:
                draw.polygon([((x - LON0) * KM_LON * 1000 / CELL, (LAT1 - y) * KM_LAT * 1000 / CELL) for x, y in poly[0]], fill=1)
        out[name] = np.asarray(img) > 0
    return out["zone"], out["paris"]


def main():
    zmask, pmask = masks()
    acc = np.zeros((ROWS, COLS)); cnt = np.zeros((ROWS, COLS)); used = []
    for path in sorted(glob.glob(os.path.join(RAW, "*.npz"))):
        z = np.load(path)
        dn, qa = z["lwir"].astype(np.float64), z["qa"]
        a, b, c, d, e, f = z["tr"]
        h, w = dn.shape
        cc, rr = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
        x, y = a * cc + b * rr + c, d * cc + e * rr + f
        lon, lat = Transformer.from_crs(str(z["crs"]), "EPSG:4326", always_xy=True).transform(x, y)
        bad = (dn == 0) | ((qa & 0b00011110) != 0)   # nuage, ombre de nuage, cirrus, dilatation
        temp = dn * 0.00341802 + 149.0 - 273.15
        temp[bad] = np.nan
        ci = ((lon - G["lon0"]) * G["kmLon"] * 1000 / G["cellM"]).astype(int)
        ri = ((G["lat1"] - lat) * G["kmLat"] * 1000 / G["cellM"]).astype(int)
        ok = ~np.isnan(temp) & (ci >= 0) & (ci < COLS) & (ri >= 0) & (ri < ROWS)
        if ok.mean() < 0.8:
            print("scène écartée (trop de pixels masqués)", os.path.basename(path), round(float(ok.mean()), 2)); continue
        s = np.zeros((ROWS, COLS)); n = np.zeros((ROWS, COLS))
        np.add.at(s, (ri[ok], ci[ok]), temp[ok]); np.add.at(n, (ri[ok], ci[ok]), 1)
        m = n >= 6  # une maille de 100 m contient ~11 pixels de 30 m : on exige plus de la moitié
        cell = np.where(m, s / np.maximum(n, 1), np.nan)
        if np.isnan(cell[zmask]).mean() > 0.2:
            print("scène écartée (zone mal couverte)", os.path.basename(path)); continue
        paris, mean_zone = np.nanmean(cell[pmask]), np.nanmean(cell[zmask])
        if paris < MIN_PARIS:
            print("scène écartée (journée trop fraîche)", os.path.basename(path), round(float(paris), 1)); continue
        used.append((os.path.basename(path)[:-4], round(float(paris), 1)))
        acc[m] += cell[m] - mean_zone; cnt[m] += 1
    mean = np.where(cnt >= 3, acc / np.maximum(cnt, 1), np.nan)
    for u in used: print(*u)
    print(len(used), "scènes ; écart-type entre mailles", round(float(np.nanstd(mean)), 2), "°C ; min/max",
          round(float(np.nanmin(mean)), 1), round(float(np.nanmax(mean)), 1))
    out = {"source": "Landsat 8 et 9, collection 2 niveau 2, bande ST_B10 (USGS, via Microsoft Planetary Computer)",
           "scenes": [u[0] for u in used], "cols": COLS, "rows": ROWS,
           "anomaly": [-999 if np.isnan(v) else int(round(v * 10)) for v in mean.ravel()]}
    json.dump(out, open(os.path.join(ROOT, "data", "zone-lst-100m.json"), "w"), separators=(",", ":"))


if __name__ == "__main__":
    main()
