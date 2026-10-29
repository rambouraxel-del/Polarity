#!/usr/bin/env python3
"""
Analyse HORS LIGNE de la musique de l'univers 3 « La Mer nébulaire » du voyage des univers (MP3 « Cosmic Impact », jamais réencodé)
→ `src/data/polar-rift-world3.json`.

Ce fichier est LU par le jeu pour : (1) jouer le morceau sur les 120 s de jeu actif (il dure ≈ 119,2 s : AUCUN montage ni répétition, il est joué tel
quel, démarré une fraction de seconde avant l'émergence), (2) synchroniser le décor sur la position RÉELLE de lecture (battements, percussions, basses,
montées, impacts, passages calmes), (3) fournir au GAMEPLAY une grille de rythme déterministe (battements, percussions, impacts) : le gameplay ne lit
JAMAIS l'audio, seulement ces tableaux préparés à l'avance, identiques pour le joueur et pour le service qui rejouerait la partie.

Tous les temps du JSON sont exprimés dans le temps du FICHIER (= celui du « montage », qui n'a qu'un segment).

Méthode (numpy, déterministe ; fonctions de base : scripts/analyze-music.py ; même méthode que scripts/analyze-world2.py) :
- battements : période par autocorrélation (0,42–0,50 s, ≈ 130 pulsations/min ; le morceau a aussi une pulsation ternaire à 0,70 s qui est ignorée),
  placement par programmation dynamique sur l'enveloppe d'attaques, force = attaque mesurée, correction de latence d'analyse mesurée sur les attaques fortes ;
- percussions : pics du flux spectral des bandes médium/aigu à 5 ms de résolution, recalés sur la montée réelle de l'attaque ;
- impacts (« drops ») : grandes attaques isolées dont l'énergie dépasse nettement le niveau local ;
- montées : intervalles où l'intensité croît nettement pendant au moins 2,5 s ; passages calmes : chute réelle des basses par rapport aux secondes précédentes (≥ 1 s), tout début, fondu final (l'introduction douce n'en est pas un) ;
- basses (30–150 Hz) et intensité à 30 images/s, normalisées sur le morceau ;
- fin audible : instant où l'énergie retombe sous 10 % de son niveau moyen (le morceau finit par un long fondu).

Usage : python3 -I scripts/analyze-world3.py [mp3] [sortie.json]
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

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'src', 'assets', 'audio', 'polar-rift-world3.mp3')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'src', 'data', 'polar-rift-world3.json')
SR = am.SR
ENV_FPS = am.ENV_FPS


def fine_flux(x, lo, hi, fps=200, n=1024):
    """Flux spectral (log) d'une bande, à `fps` images/s, centré sur la fenêtre."""
    hop = SR // fps
    frames = (len(x) - n) // hop
    win = np.hanning(n).astype(np.float32)
    idx = np.arange(n)[None, :] + hop * np.arange(frames)[:, None]
    S = np.abs(np.fft.rfft(x[idx] * win, axis=1))
    f = np.fft.rfftfreq(n, 1 / SR)
    L = np.log1p(100 * S)
    flux = np.maximum(0, np.diff(L, axis=0, prepend=L[:1]))
    o = flux[:, (f >= lo) & (f < hi)].sum(1)
    return np.concatenate([np.zeros(int(n / 2 / (SR // fps))), o]), fps


def peaks(o, fps, thr, gap):
    """Maxima locaux ≥ thr séparés d'au moins `gap` s (on garde le plus fort)."""
    out = []
    for i in range(1, len(o) - 1):
        if o[i] >= thr and o[i] >= o[i - 1] and o[i] > o[i + 1]:
            if out and (i - out[-1]) / fps < gap:
                if o[i] > o[out[-1]]:
                    out[-1] = i
            else:
                out.append(i)
    return out


def main():
    x = am.decode(SRC)
    D = len(x) / SR
    on = am.onset_envelope(x)

    # ———— battements (pulsation binaire ≈ 0,46 s)
    o0 = on - on.mean()
    lags = np.arange(int(0.42 * am.ONSET_FPS), int(0.50 * am.ONSET_FPS) + 1)
    ac = np.array([np.dot(o0[:-k], o0[k:]) / (len(o0) - k) for k in lags])
    i = int(np.argmax(ac))
    k = float(lags[i])
    if 0 < i < len(ac) - 1:
        a, b, c = ac[i - 1], ac[i], ac[i + 1]
        k += 0.5 * (a - c) / (a - 2 * b + c)
    period = k / am.ONSET_FPS
    beats_i = am.track_beats(on, period)
    beats = beats_i / am.ONSET_FPS
    strength = np.array([on[max(0, b - 2): b + 3].max() for b in beats_i])
    strength = np.clip(strength / (np.percentile(strength, 90) + 1e-9), 0, 1)
    shift = am.attack_shift(x, beats, strength)
    beats = beats + shift
    d = np.diff(beats)
    print(f'durée {D:.3f} s ; période {period:.4f} s ({60 / period:.1f} pulsations/min) ; {len(beats)} battements ; intervalle {np.median(d):.3f} s '
          f'(écart-type {d.std() * 1000:.0f} ms) ; correction d’attaque {shift * 1000:+.1f} ms')

    # Contrôle de synchronisation : écart entre chaque battement fort de la carte et la montée réelle de l'attaque (APRÈS correction)
    dabs = np.abs(np.diff(x, prepend=0.0))
    kk = int(0.004 * SR)
    attack_env = np.convolve(dabs, np.ones(kk) / kk, 'same')
    offs = []
    for bt, st in zip(beats, strength):
        if st < 0.5:
            continue
        c0 = int(bt * SR)
        a0, b0 = max(1, c0 - int(0.08 * SR)), min(len(attack_env) - 1, c0 + int(0.08 * SR))
        if b0 - a0 < 100:
            continue
        offs.append((a0 + int(np.argmax(np.diff(attack_env[a0:b0])))) / SR - bt)
    offs = np.array(offs)
    print(f'contrôle de synchro : {len(offs)} battements forts ; écart médian {np.median(offs) * 1000:+.1f} ms ; '
          f'{100 * np.mean(np.abs(offs) < 0.025):.0f} % à ± 25 ms ; {100 * np.mean(np.abs(offs) < 0.05):.0f} % à ± 50 ms ; '
          f'percentiles 10/90 : {np.percentile(offs, 10) * 1000:+.0f} / {np.percentile(offs, 90) * 1000:+.0f} ms')

    # ———— enveloppes
    bass = am.band_rms(x, ENV_FPS, 30, 150)
    e = am.full_rms(x, ENV_FPS)
    bass = np.clip(bass / (np.percentile(bass, 98) + 1e-9), 0, 1)
    sm = am.smooth(e, int(2 * ENV_FPS))
    lo, hi = np.percentile(sm, 5), np.percentile(sm, 99)
    inten = np.clip((sm - lo) / (hi - lo + 1e-9), 0, 1)
    n = min(len(bass), len(inten))
    bass, inten, e = bass[:n], inten[:n], e[:n]

    # ———— fin audible : l'énergie (100 images/s, lissée) passe durablement sous 10 % de la moyenne du corps du morceau
    e100 = am.full_rms(x, 100)
    body = float(e100[int(20 * 100): int(100 * 100)].mean())
    s100 = am.smooth(e100, 30)
    end_audible = None
    for j in range(int(60 * 100), len(s100)):
        if s100[j] < 0.10 * body and s100[j:].max() < 0.10 * body:
            end_audible = j / 100.0
            break
    if end_audible is None:
        end_audible = D
    # début du fondu final : dernier instant où l'énergie est encore ≥ 60 % de la moyenne
    fade_start = D
    for j in range(len(s100) - 1, int(60 * 100), -1):
        if s100[j] >= 0.60 * body:
            fade_start = j / 100.0
            break
    print(f'fin audible {end_audible:.2f} s ; début du fondu final {fade_start:.2f} s ; durée du fichier {D:.2f} s')

    # ———— percussions (médium + aigu)
    mid, fps = fine_flux(x, 180, 1400)
    top, _ = fine_flux(x, 2500, 12000)
    perc = mid / (np.percentile(mid, 95) + 1e-9) * 0.6 + top / (np.percentile(top, 95) + 1e-9) * 0.4
    perc = np.maximum(0, perc - np.convolve(perc, np.ones(int(0.3 * fps)) / (0.3 * fps), 'same'))
    thr = np.percentile(perc, 94)
    pk = peaks(perc, fps, thr, 0.11)
    pt = np.array(pk) / fps
    ps = np.clip(perc[pk] / (np.percentile(perc[pk], 92) + 1e-9), 0, 1)
    xh = x - np.convolve(x, np.ones(int(SR / 1500)) / int(SR / 1500), 'same')
    k3 = int(0.003 * SR)
    henv = np.convolve(np.abs(xh), np.ones(k3) / k3, 'same')
    dh = np.diff(henv, prepend=henv[0])
    moved = []
    for q, t in enumerate(pt):
        c0 = int(t * SR)
        a0, b0 = max(0, c0 - int(0.035 * SR)), min(len(dh), c0 + int(0.035 * SR))
        t2 = (a0 + int(np.argmax(dh[a0:b0]))) / SR
        moved.append(t2 - t)
        pt[q] = t2
    moved = np.array(moved)
    print(f'percussions : {len(pt)} ; recalage sur l’attaque : médian {np.median(moved) * 1000:+.1f} ms, p10/p90 {np.percentile(moved, 10) * 1000:+.0f}/{np.percentile(moved, 90) * 1000:+.0f} ms')

    # ———— impacts : grandes attaques isolées
    cands = []
    for i0 in range(150, len(on) - 150):
        if on[i0] < on[i0 - 1] or on[i0] <= on[i0 + 1]:
            continue
        local = np.median(on[i0 - 400: i0 + 400])
        if on[i0] > 5 * local and on[i0] > np.percentile(on, 99.2):
            cands.append((float(on[i0]), i0))
    cands.sort(reverse=True)
    kept = []
    for v, i0 in cands:
        if all(abs(i0 - j) > 200 for _, j in kept):
            kept.append((v, i0))
    kept.sort(key=lambda p: p[1])
    drops = np.array([j / am.ONSET_FPS + shift for _, j in kept])
    dmax = max(v for v, _ in kept)
    dstr = np.array([v / dmax for v, _ in kept])
    for q, t in enumerate(drops):
        j = int(np.argmin(np.abs(beats - t)))
        if abs(beats[j] - t) < 0.12:
            drops[q] = beats[j]
    print('impacts (s) :', [round(float(t), 2) for t in drops], 'forces', [round(float(s), 2) for s in dstr])

    # ———— montées et passages calmes
    feel = 0.5 * inten + 0.5 * am.smooth(bass, int(1.5 * ENV_FPS))
    sf = am.smooth(feel, 3 * ENV_FPS)
    grad = np.gradient(sf) * ENV_FPS
    builds, i0 = [], 0
    while i0 < len(grad):
        if grad[i0] > 0.02:
            j = i0
            while j < len(grad) and grad[j] > 0.02:
                j += 1
            if (j - i0) / ENV_FPS >= 2.5 and sf[j - 1] - sf[i0] > 0.08:
                builds.append([i0 / ENV_FPS, j / ENV_FPS])
            i0 = j
        else:
            i0 += 1
    bs1 = am.smooth(bass, ENV_FPS)
    is1 = am.smooth(inten, ENV_FPS)
    calm, i0 = [], 0
    low = np.zeros(len(bs1), bool)
    for q in range(len(bs1)):
        prev = bs1[max(0, q - 6 * ENV_FPS): q].mean() if q > ENV_FPS else 1.0
        t_q = q / ENV_FPS
        # L'introduction est douce mais jouable (les premières attaques y arrivent) : un « calme » est une CHUTE réelle par rapport aux secondes qui précèdent,
        # l'extrême début (avant la première note audible) et le fondu final.
        low[q] = (bs1[q] < 0.45 * max(prev, 0.2) and prev > 0.3 and t_q < fade_start - 0.5) or t_q < 1.5 or t_q >= fade_start
    while i0 < len(low):
        if low[i0]:
            j = i0
            while j < len(low) and low[j]:
                j += 1
            if (j - i0) / ENV_FPS >= 1.0:
                calm.append([i0 / ENV_FPS, j / ENV_FPS])
            i0 = j
        else:
            i0 += 1
    print('montées :', [[round(a, 1), round(b, 1)] for a, b in builds])
    print('calmes  :', [[round(a, 1), round(b, 1)] for a, b in calm])
    print(f'battements {len(beats)} ; percussions {len(pt)} ; impacts {len(drops)}')

    print('structure (t : intensité, basses, battements, percussions) :')
    for s0 in range(0, int(D), 10):
        a, b = int(s0 * ENV_FPS), int(min(D, s0 + 10) * ENV_FPS)
        print(f'  {s0:3d}–{min(int(D), s0 + 10):3d} s : intensité {inten[a:b].mean():.2f}  basses {bass[a:b].mean():.2f}  '
              f'battements {int(((beats >= s0) & (beats < s0 + 10)).sum())}  percussions {int(((pt >= s0) & (pt < s0 + 10)).sum())}')

    out = {
        'schemaVersion': 1,
        'generator': 'scripts/analyze-world3.py',
        'file': 'polar-rift-world3.mp3',
        'note': 'Temps en secondes dans le FICHIER (= montage à un seul segment). Enveloppes : octets 0–255 en hexadécimal, envFps images/s.',
        'fileDuration': round(D, 3),
        'beatPeriod': round(float(period), 5),
        'envFps': ENV_FPS,
        'plan': {
            'segments': [{'from': 0.0, 'to': round(D, 4), 'at': 0.0}],
            'crossfade': 0.0,
            'duration': round(D, 4),
            'fadeStart': round(fade_start, 3),
            'endAudible': round(end_audible, 3),
        },
        'beats': [round(float(t), 3) for t in beats],
        'strength': [round(float(s), 2) for s in strength],
        'hits': [round(float(t), 3) for t in pt],
        'hitStrength': [round(float(s), 2) for s in ps],
        'drops': [round(float(t), 3) for t in drops],
        'dropStrength': [round(float(s), 2) for s in dstr],
        'builds': [[round(a, 3), round(b, 3)] for a, b in builds],
        'calm': [[round(a, 3), round(b, 3)] for a, b in calm],
        'bass': am.q8(bass),
        'intensity': am.q8(inten),
    }
    with open(OUT, 'w') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    print(f'écrit {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT) // 1024} Ko)')


if __name__ == '__main__':
    main()
