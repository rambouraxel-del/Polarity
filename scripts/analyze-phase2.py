#!/usr/bin/env python3
"""
Analyse HORS LIGNE de la musique de la phase 2 de la Survie (MP3 fourni, jamais réencodé) → `src/data/polar-rift-phase2.json`.

Le jeu lit ce fichier pour : (1) boucler le morceau sans trou audible (points de boucle sur la grille de battements, fondu enchaîné
calé en phase), (2) synchroniser l'ambiance visuelle sur la position RÉELLE de lecture (carte : battements, basses, intensité, drops, montées),
(3) fournir au GAMEPLAY une grille de battements régulière (`beatPeriod`, `firstBeat`) — le gameplay ne lit jamais l'audio en direct.

Méthode (numpy, déterministe ; les fonctions d'analyse sont celles de `analyze-music.py`) :
- période et placement des battements : autocorrélation de l'enveloppe d'attaques (pulsation cherchée entre 0,40 et 0,50 s : le pic global à 0,67 s
  est une syncope ternaire de croches pointées, les pics 0,22 / 0,45 / 0,89 s révèlent la grille de doubles-croches) puis programmation dynamique, puis régression linéaire
  t = firstBeat + k · beatPeriod sur tous les battements (morceau électronique à tempo constant : résidu mesuré et affiché) ;
- fin de contenu : silence final détecté (≈ 2 s) et « queue » d'extinction repérée par la chute d'énergie ;
- boucle : `loopEnd` = dernier battement de la grille avant la queue ; `loopStart` = battement tel que la durée soit un multiple de 16 temps
  (phrase) et que le son qui précède `loopStart` ressemble le plus à celui qui précède `loopEnd` (spectre moyen sur 4 s) : le fondu enchaîné
  superpose ces deux zones, en phase de battement.

Usage : python3 -I scripts/analyze-phase2.py [mp3] [sortie.json]
"""
import importlib.util
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('am', os.path.join(ROOT, 'scripts', 'analyze-music.py'))
am = importlib.util.module_from_spec(spec)
spec.loader.exec_module(am)

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'src', 'assets', 'audio', 'polar-rift-phase2.mp3')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'src', 'data', 'polar-rift-phase2.json')
ENV_FPS = am.ENV_FPS
SR = am.SR
PHRASE = 16  # temps
XFADE = 2.0  # fondu enchaîné de boucle (s)


def beat_period_in(o, lo_s, hi_s):
    """Période de pulsation : pic d'autocorrélation de l'enveloppe d'attaques dans [lo_s, hi_s] (le pic global à 0,67 s est une syncope ternaire, pas la pulsation : voir la docstring)."""
    o = o - o.mean()
    lags = np.arange(int(lo_s * am.ONSET_FPS), int(hi_s * am.ONSET_FPS) + 1)
    ac = np.array([np.dot(o[:-k], o[k:]) / (len(o) - k) for k in lags])
    i = int(np.argmax(ac))
    k = float(lags[i])
    if 0 < i < len(ac) - 1:
        a, b, c = ac[i - 1], ac[i], ac[i + 1]
        k += 0.5 * (a - c) / (a - 2 * b + c)
    return k / am.ONSET_FPS


def main():
    x = am.decode(SRC)
    D = len(x) / SR
    on = am.onset_envelope(x)
    period = beat_period_in(on, 0.40, 0.50)
    # Grille régulière : (période, phase) qui maximisent l'énergie d'attaque moyenne sous les battements (peigne), sur tout le morceau.
    # Le morceau est électronique à tempo constant ; la grille est ensuite vérifiée par tiers (la phase ne doit pas dériver).
    idx = np.arange(len(on))

    def comb(P, phi, a=0.0, b=D):
        t = np.arange(phi + np.ceil((a - phi) / P) * P, b - 0.1, P)
        return float(np.interp(t * am.ONSET_FPS, idx, on).mean())

    best = max(((comb(P, ph), P, ph) for P in np.arange(period - 0.004, period + 0.004, 0.0001) for ph in np.arange(0, period, 0.004)))
    _, P, b0 = best
    b0 = max(((comb(P, ph), ph) for ph in np.arange(b0 - 0.004, b0 + 0.004, 0.001)))[1] % P
    thirds = [max(((comb(P, ph, lo, hi), ph) for ph in np.arange(0, P, 0.002)))[1] for lo, hi in ((0, 100), (100, 200), (200, 296))]
    beats = np.arange(b0, D - 0.3, P)
    strength = np.array([on[max(0, int(round(b * am.ONSET_FPS)) - 2): int(round(b * am.ONSET_FPS)) + 3].max() for b in beats])
    strength = np.clip(strength / (np.percentile(strength, 90) + 1e-9), 0, 1)
    shift = am.attack_shift(x, beats, strength)
    beats = beats + shift
    b0 = b0 + shift
    print(f'durée {D:.3f} s ; période {P:.5f} s ({60 / P:.2f} pulsations/min) ; premier battement {b0:.4f} s (attaque corrigée de {shift * 1000:+.1f} ms) ; '
          f'phase par tiers du morceau : {", ".join(f"{t:.3f}" for t in thirds)} s (dérive < {(max(thirds) - min(thirds)) * 1000:.0f} ms)')

    # Enveloppes (30 images/s)
    bass = am.band_rms(x, ENV_FPS, 30, 150)
    e = am.full_rms(x, ENV_FPS)
    bass = np.clip(bass / (np.percentile(bass, 98) + 1e-9), 0, 1)
    sm = am.smooth(e, int(2 * ENV_FPS))
    lo, hi = np.percentile(sm, 5), np.percentile(sm, 99)
    inten = np.clip((sm - lo) / (hi - lo + 1e-9), 0, 1)
    n = min(len(bass), len(inten))
    bass, inten = bass[:n], inten[:n]

    # Fin de contenu : silence final puis queue d'extinction
    env1 = am.smooth(e, ENV_FPS)
    nz = np.where(e > 0.01 * e.max())[0]
    content_end = (nz[-1] + 1) / ENV_FPS
    ref = np.median(env1[int((content_end - 70) * ENV_FPS): int((content_end - 12) * ENV_FPS)])
    i = int(content_end * ENV_FPS) - 1
    while i > 0 and env1[i] < 0.75 * ref:
        i -= 1
    taper = (i + 1) / ENV_FPS
    print(f'contenu jusqu’à {content_end:.2f} s ; extinction (< 75 % de l’énergie moyenne) dès {taper:.2f} s ; silence final {D - content_end:.2f} s')

    # Boucle : fin sur la grille juste avant la queue ; début = fin − m·16 temps, le plus ressemblant
    kle = int(np.floor((taper - b0) / P))
    le = b0 + kle * P
    freqs = np.fft.rfftfreq(am.N_FFT, 1 / SR)
    bands = np.geomspace(60, 12000, 24)
    S = am.spectrum(x, SR // 100)

    def sig(t, span=4.0):
        a, b = int((t - span) * 100), int(t * 100)
        v = np.log1p(100 * S[a:b].mean(0))
        return np.array([v[(freqs >= bands[j]) & (freqs < bands[j + 1])].mean() for j in range(len(bands) - 1)])

    ref_sig = sig(le)
    cands = []
    for m in range(1, 200):
        kls = kle - m * PHRASE
        ls = b0 + kls * P
        if ls < 12.0 or ls > 0.55 * le:
            continue
        s = sig(ls)
        cos = float(np.dot(s, ref_sig) / (np.linalg.norm(s) * np.linalg.norm(ref_sig)))
        # énergie comparable avant les deux points (le raccord ne doit pas faire un saut de niveau)
        ea = float(e[int((ls - 4) * ENV_FPS): int(ls * ENV_FPS)].mean())
        eb = float(e[int((le - 4) * ENV_FPS): int(le * ENV_FPS)].mean())
        cands.append((cos - 0.8 * abs(ea - eb) / (eb + 1e-9), cos, ls, kls))
    cands.sort(reverse=True)
    _, cos, ls, kls = cands[0]
    print(f'boucle : début {ls:.3f} s, fin {le:.3f} s, durée {le - ls:.3f} s = {kle - kls} temps ({(kle - kls) // PHRASE} phrases) ; ressemblance spectrale {cos:.3f}')

    # Événements
    def drops(e_, b_, beats_s):
        out, cand = [], []
        for i in range(6 * ENV_FPS, len(e_) - 2 * ENV_FPS):
            before = e_[i - 6 * ENV_FPS: i].mean()
            after = e_[i: i + 2 * ENV_FPS].mean()
            bb = b_[i - 6 * ENV_FPS: i].mean()
            ba = b_[i: i + 2 * ENV_FPS].mean()
            r = after / (before + 1e-9)
            if r > 1.15 and ba > bb * 1.25:
                cand.append((r * ba / (bb + 1e-9), i))
        cand.sort(reverse=True)
        kept = []
        for _, i in cand:
            if all(abs(i - k_) > 12 * ENV_FPS for k_ in kept):
                kept.append(i)
        for i in sorted(kept):
            t = i / ENV_FPS
            j = int(np.argmin(np.abs(beats_s - t)))
            out.append(float(beats_s[j]) if abs(beats_s[j] - t) < 0.3 else t)
        return out

    def builds(intensity):
        s = am.smooth(intensity, 4 * ENV_FPS)
        d = np.gradient(s) * ENV_FPS
        up = d > 0.025
        out, i = [], 0
        while i < len(up):
            if up[i]:
                j = i
                while j < len(up) and up[j]:
                    j += 1
                if (j - i) / ENV_FPS >= 3 and s[j - 1] - s[i] > 0.1:
                    out.append([round(i / ENV_FPS, 3), round(j / ENV_FPS, 3)])
                i = j
            else:
                i += 1
        return out

    dr = [round(t, 3) for t in drops(e, bass, beats)]
    bu = builds(inten)
    print('drops', dr, '\nmontées', bu)

    out = {
        'schemaVersion': 1,
        'generator': 'scripts/analyze-phase2.py',
        'file': 'polar-rift-phase2.mp3',
        'note': 'Temps en secondes depuis le début du fichier. Grille de battements régulière (gameplay et fondu de boucle) : t = firstBeat + k · beatPeriod. Enveloppes : octets 0–255 en hexadécimal, envFps images/s.',
        'fileDuration': round(D, 3),
        'contentEnd': round(float(content_end), 3),
        'beatPeriod': round(float(P), 6),
        'firstBeat': round(float(b0), 4),
        'loopStart': round(float(ls), 4),
        'loopEnd': round(float(le), 4),
        'crossfade': XFADE,
        'envFps': ENV_FPS,
        'beats': [round(float(t), 3) for t in beats],
        'strength': [round(float(s), 2) for s in strength],
        'bass': am.q8(bass),
        'intensity': am.q8(inten),
        'drops': dr,
        'builds': bu,
    }
    with open(OUT, 'w') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    print(f'écrit {OUT} ({os.path.getsize(OUT) // 1024} Ko)')


if __name__ == '__main__':
    main()
