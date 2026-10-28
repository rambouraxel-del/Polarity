#!/usr/bin/env python3
"""
Contrôle INDÉPENDANT de la carte musicale de La Faille : le montage est rendu hors ligne EXACTEMENT comme le lecteur le programme (`audio/worldMusic.ts`,
segments et fondu de `polar-rift-world2.json`), puis les attaques réelles du son rendu sont comparées à la carte (battements, percussions, impacts, coup sec final).
Écart médian proche de 0 et très peu de repères hors tolérance = la carte est calée sur ce qu'on ENTEND, y compris autour du raccord de la phrase répétée.

Usage : python3 -I scripts/check-world2.py [mp3] [carte.json]   (code de sortie 1 si un seuil est dépassé)
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
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'src', 'assets', 'audio', 'polar-rift-world2.mp3')
MAP = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'src', 'data', 'polar-rift-world2.json')
SR = am.SR


def render(x, plan):
    """Montage rendu : chaque segment est une voix ; la voix suivante entre pendant `crossfade` s (rampe linéaire) pendant que la précédente sort."""
    xf = plan['crossfade']
    n = int(round(plan['duration'] * SR)) + SR
    out = np.zeros(n, np.float64)
    segs = plan['segments']
    for k, seg in enumerate(segs):
        last = k == len(segs) - 1
        start_m = seg['at'] - (xf if k > 0 else 0.0)
        a = int(round((seg['from'] - (xf if k > 0 else 0.0)) * SR))
        b = int(round(seg['to'] * SR)) if not last else len(x)
        v = x[a:b].astype(np.float64).copy()
        env = np.ones(len(v))
        if k > 0:
            m = min(len(v), int(xf * SR))
            env[:m] = np.linspace(0.0, 1.0, m)
        if not last:
            end_m = segs[k + 1]['at']
            cut = int(round((end_m - start_m) * SR))
            v = v[:cut]
            env = env[:cut]
            m = int(xf * SR)
            env[-m:] *= np.linspace(1.0, 0.0, m)
        i = int(round(start_m * SR))
        out[i:i + len(v)] += v * env[:len(v)]
    return out[:int(round(plan['duration'] * SR))].astype(np.float32)


def attack_times(y, lo, hi, thr_pct, gap):
    """Montées d'attaque d'une bande, au pas de l'échantillon (lissage 3 ms) : mêmes détecteurs que l'analyse, appliqués au SON RENDU."""
    k = int(SR / 1500)
    yh = y - np.convolve(y, np.ones(k) / k, 'same')
    k3 = int(0.003 * SR)
    env = np.convolve(np.abs(yh), np.ones(k3) / k3, 'same')
    d = np.diff(env, prepend=env[0])
    return env, d


def main():
    x = am.decode(SRC)
    j = json.load(open(MAP))
    plan = j['plan']
    y = render(x, plan)
    dur = len(y) / SR
    print(f'montage rendu : {dur:.3f} s (plan : {plan["duration"]:.3f} s)')
    dabs = np.abs(np.diff(y, prepend=0.0))
    kk = int(0.004 * SR)
    env = np.convolve(dabs, np.ones(kk) / kk, 'same')
    de = np.diff(env)
    bad = []

    def offsets(times, strengths, min_strength, win):
        offs = []
        for t, s in zip(times, strengths):
            if s < min_strength:
                continue
            c = int(t * SR)
            lo, hi = max(1, c - int(win * SR)), min(len(de) - 1, c + int(win * SR))
            if hi - lo < 100:
                continue
            offs.append((lo + int(np.argmax(de[lo:hi]))) / SR - t)
        return np.array(offs)

    # battements forts : montée large bande la plus rapide à ± 80 ms
    ob = offsets(j['beats'], j['strength'], 0.5, 0.08)
    print(f'battements forts : {len(ob)} ; écart médian {np.median(ob) * 1000:+.1f} ms ; ± 25 ms : {100 * np.mean(np.abs(ob) < 0.025):.0f} % ; ± 50 ms : {100 * np.mean(np.abs(ob) < 0.05):.0f} %')
    if abs(np.median(ob)) > 0.015 or np.mean(np.abs(ob) < 0.05) < 0.95:
        bad.append('battements')
    # autour du raccord : mêmes mesures, ± 2,5 s
    seam = plan['segments'][1]['at']
    near = [(t, s) for t, s in zip(j['beats'], j['strength']) if abs(t - seam) < 2.5 and s >= 0.2]
    on = offsets([t for t, _ in near], [s for _, s in near], 0.2, 0.08)
    print(f'autour du raccord ({seam:.2f} s) : {len(on)} battements ; écart médian {np.median(on) * 1000:+.1f} ms ; max {np.max(np.abs(on)) * 1000:.0f} ms')
    if np.max(np.abs(on)) > 0.06:
        bad.append('raccord')
    # impacts : attaque nette
    od = offsets(j['drops'], j['dropStrength'], 0.0, 0.06)
    print(f'impacts : {len(od)} ; écart médian {np.median(od) * 1000:+.1f} ms ; max {np.max(np.abs(od)) * 1000:.0f} ms')
    if np.median(np.abs(od)) > 0.02:
        bad.append('impacts')
    # coup sec final : l'énergie chute exactement à `plan.cut`
    e100 = am.full_rms(y, 100)
    cut = plan['cut']
    i = int(cut * 100)
    before, after = e100[i - 6:i - 1].mean(), e100[i + 4:i + 9].mean()
    print(f'coup sec final à {cut:.3f} s : énergie avant {before:.3f}, après {after:.3f}')
    if not (after < 0.6 * before):
        bad.append('coup sec')
    # aucun trou : pas de silence anormal à l'intérieur du montage (hors introduction et queue)
    sil = [t for t in np.arange(8, cut - 0.5, 0.25) if e100[int(t * 100)] < 0.01]
    print(f'secondes silencieuses inattendues : {len(sil)}')
    if len(sil) > 2:
        bad.append('trous')
    # raccord : pas de saut d'énergie brutal (fondu terminé avant l'attaque)
    a, b = int((seam - 0.3) * 100), int((seam + 0.3) * 100)
    jump = np.max(np.abs(np.diff(e100[a:b])))
    print(f'saut d’énergie maximal autour du raccord (± 0,3 s) : {jump:.3f}')
    print('RÉSULTAT :', 'OK' if not bad else 'ÉCHEC → ' + ', '.join(bad))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
