#!/usr/bin/env python3
"""Sources des icônes et du splash (assets/*.png) et icônes web (public/icons/*.png), à partir des visuels existants du projet
(art/source/ship.png et art/source/logo.png). Aucun visuel nouveau n'est inventé : le vaisseau du jeu sur le fond nuit du jeu, avec son orbite.
Les icônes natives (mipmaps Android, AppIcon iOS, splash) sont ensuite déclinées par `npm run mobile:assets` (@capacitor/assets).

Usage : npm run mobile:icons        (Pillow requis ; idempotent)
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NIGHT = (7, 11, 31)        # --c-bg du jeu (#070b1f)
NIGHT_LIGHT = (14, 22, 62)
CYAN = (57, 243, 255)      # orbite du jeu (favicon)


def bg(size: int) -> Image.Image:
    """Fond nuit avec un halo bleuté au centre."""
    im = Image.new('RGB', (size, size), NIGHT)
    px = im.load()
    c = size / 2
    for y in range(size):
        for x in range(size):
            d = min(1.0, math.hypot(x - c, y - c) / (size * 0.62))
            t = (1 - d) ** 2
            px[x, y] = tuple(int(NIGHT[i] + (NIGHT_LIGHT[i] - NIGHT[i]) * t) for i in range(3))
    return im


def ring(size: int, radius: float, width: int) -> Image.Image:
    """Orbite cyan lumineuse (anneau net + halo flou)."""
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    c = size / 2
    box = [c - radius, c - radius, c + radius, c + radius]
    d.ellipse(box, outline=CYAN + (255,), width=width)
    glow = layer.filter(ImageFilter.GaussianBlur(width * 2.2))
    out = Image.alpha_composite(glow, glow)
    return Image.alpha_composite(out, layer)


def ship(size: int, height_ratio: float) -> Image.Image:
    src = Image.open(os.path.join(ROOT, 'art/source/ship.png')).convert('RGBA')
    h = int(size * height_ratio)
    w = int(src.width * h / src.height)
    s = src.resize((w, h), Image.LANCZOS)
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    layer.paste(s, ((size - w) // 2, (size - h) // 2), s)
    return layer


def compose(size: int, ring_ratio: float, ship_ratio: float, with_bg: bool) -> Image.Image:
    base = bg(size).convert('RGBA') if with_bg else Image.new('RGBA', (size, size), (0, 0, 0, 0))
    base = Image.alpha_composite(base, ring(size, size * ring_ratio, max(6, size // 70)))
    return Image.alpha_composite(base, ship(size, ship_ratio))


def save(im: Image.Image, rel: str, opaque: bool = False) -> None:
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    (im.convert('RGB') if opaque else im).save(path, optimize=True)
    print('écrit', rel, im.size)


def main() -> None:
    # Icône « pleine » (iOS : opaque, sans transparence ; Android hérité)
    full = compose(1024, 0.40, 0.56, True)
    save(full, 'assets/icon-only.png', opaque=True)
    # Android adaptatif : avant-plan transparent dans la zone sûre (≈ 61 % centrale) + fond uni
    save(compose(1024, 0.27, 0.38, False), 'assets/icon-foreground.png')
    save(bg(1024), 'assets/icon-background.png', opaque=True)
    # Écran de démarrage : logo du jeu centré sur le fond nuit (clair et sombre identiques : le jeu est sombre)
    splash = bg(2732).convert('RGBA')
    logo = Image.open(os.path.join(ROOT, 'art/source/logo.png')).convert('RGBA')
    w = int(2732 * 0.58)
    logo = logo.resize((w, int(logo.height * w / logo.width)), Image.LANCZOS)
    splash.alpha_composite(logo, ((2732 - w) // 2, (2732 - logo.height) // 2))
    save(splash, 'assets/splash.png', opaque=True)
    save(splash, 'assets/splash-dark.png', opaque=True)
    # Icônes web : « any » (fond arrondi implicite par le navigateur), « maskable » (zone sûre 80 %), apple-touch (opaque), favicon PNG
    save(full.resize((192, 192), Image.LANCZOS), 'public/icons/icon-192.png')
    save(full.resize((512, 512), Image.LANCZOS), 'public/icons/icon-512.png')
    save(compose(512, 0.30, 0.42, True), 'public/icons/maskable-512.png')
    save(full.resize((180, 180), Image.LANCZOS), 'public/icons/apple-touch-icon.png', opaque=True)
    save(full.resize((48, 48), Image.LANCZOS), 'public/icons/favicon-48.png')


if __name__ == '__main__':
    main()
