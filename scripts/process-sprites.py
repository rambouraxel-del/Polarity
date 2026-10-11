#!/usr/bin/env python3
"""
Prépare les textures du jeu à partir des sources (art/source/*.png, fond transparent, recadrées).
Chaque sprite est centré dans une toile carrée de 128 px (puissance de deux : mipmaps),
sa plus grande dimension occupant 120 px (CONTENT). Aucun effet n'est ajouté ici :
réacteur, traînées et particules sont générés par le code (src/render).

Usage : python3 scripts/process-sprites.py   (nécessite Pillow)
"""
from pathlib import Path
from PIL import Image

CANVAS = 128
CONTENT = 120
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art" / "source"
OUT = ROOT / "src" / "assets" / "sprites"
OUT.mkdir(parents=True, exist_ok=True)

for path in sorted(SRC.glob("*.png")):
    im = Image.open(path).convert("RGBA")
    im = im.crop(im.getchannel("A").getbbox())
    k = CONTENT / max(im.size)
    im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.alpha_composite(im, ((CANVAS - im.width) // 2, (CANVAS - im.height) // 2))
    canvas.save(OUT / path.name, optimize=True)
    print(f"{path.name}: {im.width}x{im.height} dans {CANVAS}x{CANVAS}")
