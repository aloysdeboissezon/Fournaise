"""Zone couverte par Fournaise : Paris et la petite couronne (Hauts-de-Seine, Seine-Saint-Denis, Val-de-Marne).

Partagé par fetch_sources.py, build_heat.py, build_lst.py, build_dpe.py, build_bdnb.py et build_data.py.
Le rectangle englobe les 143 communes et arrondissements de la zone (contours ADMIN EXPRESS de l'IGN),
plus une marge de ~600 m pour que le lissage de la carte de chaleur ne s'arrête pas net à la limite.
"""
import math

DEPTS = ["75", "92", "93", "94"]
LON0, LON1, LAT0, LAT1 = 2.137, 2.624, 48.682, 49.018
KM_LON = 111.32 * math.cos(math.radians(48.86))
KM_LAT = 110.57
CELL = 100.0       # m par maille de la carte de chaleur
TILE = 40          # mailles par côté d'une tuile de la carte fine (4 km), chargée à la demande
COARSE = 4         # facteur de la carte d'ensemble embarquée dans la page (400 m)
COLS = int(round((LON1 - LON0) * KM_LON * 1000 / CELL))
ROWS = int(round((LAT1 - LAT0) * KM_LAT * 1000 / CELL))
# Références : station Paris-Montsouris (0 °C par construction) et cœur de Paris (1,2 km autour de Châtelet)
MONTSOURIS = (2.3378, 48.8222)
CORE = (2.347, 48.8605)


def simplify(pts, tol):
    """Douglas-Peucker sur un anneau fermé."""
    if len(pts) < 5:
        return pts
    def rec(a, b):
        (x1, y1), (x2, y2) = pts[a], pts[b]
        dx, dy = x2 - x1, y2 - y1
        n = (dx * dx + dy * dy) ** 0.5 or 1e-12
        best, idx = 0, -1
        for i in range(a + 1, b):
            d = abs(dy * (pts[i][0] - x1) - dx * (pts[i][1] - y1)) / n
            if d > best:
                best, idx = d, i
        if best > tol:
            return rec(a, idx)[:-1] + rec(idx, b)
        return [pts[a], pts[b]]
    mid = len(pts) // 2
    out = rec(0, mid)[:-1] + rec(mid, len(pts) - 1)
    return out if len(out) >= 4 else pts
