"""Assemble une page unique (CSS et JS en ligne) à partir de index.html.

Usage : python3 scripts/build_artifact.py
Sortie : dist/fournaise.html (page autonome, sans requête réseau sauf polices et géocodage).
"""
import os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
read = lambda p: open(os.path.join(ROOT, p), encoding="utf-8").read()

html = read("index.html")
body = html.split("<!-- BODY:START -->")[1].split("<!-- BODY:END -->")[0].strip()
fonts = re.search(r'<link rel="stylesheet" href="(https://fonts\.googleapis\.com[^"]+)">', html).group(1)
css = read("css/style.css")
scripts = "".join("<script>\n" + read(p) + "\n</script>\n" for p in ("js/data-paris.js", "js/data-heat.js", "js/model.js", "js/app.js"))

page = f"""<title>Fournaise</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="Le score de chaleur d'un logement parisien avant de le louer.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{fonts}">
<style>
{css}
</style>
{body}
{scripts}"""
os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
open(os.path.join(ROOT, "dist", "fournaise.html"), "w", encoding="utf-8").write(page)
print("dist/fournaise.html", len(page.encode()), "octets")
