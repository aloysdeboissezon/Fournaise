"""Dessine les icônes d'installation (favicon, écran d'accueil, PWA) à partir de la marque Fournaise.

Usage : python3 scripts/build_icons.py   (nécessite Pillow)
Sortie : img/icon-192.png, img/icon-512.png, img/icon-maskable-512.png, img/apple-touch-icon.png, img/favicon.svg
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "img")
BG = (19, 23, 28)
STOPS = [(0.0, (75, 11, 51)), (0.25, (163, 19, 63)), (0.5, (222, 74, 34)), (0.72, (241, 154, 62)), (1.0, (239, 211, 122))]


def grad(t):
    for (a, ca), (b, cb) in zip(STOPS, STOPS[1:]):
        if t <= b:
            k = (t - a) / (b - a)
            return tuple(round(ca[i] + (cb[i] - ca[i]) * k) for i in range(3))
    return STOPS[-1][1]


def icon(size, pill_h, rounded):
    s = size * 4  # suréchantillonnage pour des bords nets
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    bg = Image.new("RGBA", (s, s), BG + (255,))
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22) if rounded else 0, fill=255)
    im.paste(bg, (0, 0), mask)
    ph = int(s * pill_h)
    pw = int(ph * 0.5)
    x0, y0 = (s - pw) // 2, (s - ph) // 2
    fill = Image.new("RGBA", (pw, ph))
    px = fill.load()
    for y in range(ph):
        c = grad(1 - y / (ph - 1))
        for x in range(pw):
            px[x, y] = c + (255,)
    pm = Image.new("L", (pw, ph), 0)
    ImageDraw.Draw(pm).rounded_rectangle([0, 0, pw - 1, ph - 1], radius=pw // 2, fill=255)
    im.paste(fill, (x0, y0), pm)
    return im.resize((size, size), Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
icon(192, 0.62, True).save(os.path.join(OUT, "icon-192.png"))
icon(512, 0.62, True).save(os.path.join(OUT, "icon-512.png"))
icon(512, 0.5, False).save(os.path.join(OUT, "icon-maskable-512.png"))
icon(180, 0.58, False).convert("RGB").save(os.path.join(OUT, "apple-touch-icon.png"))
open(os.path.join(OUT, "favicon.svg"), "w").write(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="1" x2="0" y2="0">'
    + "".join('<stop offset="%g" stop-color="#%02x%02x%02x"/>' % ((o,) + c) for o, c in STOPS)
    + '</linearGradient></defs><rect width="32" height="32" rx="7" fill="#13171c"/><rect x="11" y="5" width="10" height="22" rx="5" fill="url(#g)"/></svg>\n'
)
print("icônes écrites dans img/")
