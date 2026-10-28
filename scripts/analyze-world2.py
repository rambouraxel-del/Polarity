#!/usr/bin/env python3
"""
Analyse HORS LIGNE de la musique de l'univers 2 « La Faille » du voyage des univers (MP3 « Portal Surge », jamais réencodé)
→ `src/data/polar-rift-world2.json`.

Ce fichier est LU par le jeu pour : (1) monter le morceau sur les 120 s de jeu actif (une phrase de 3 mesures répétée, raccord calé sur deux
battements réels et fondu de quelques dizaines de ms), (2) synchroniser le décor sur la position RÉELLE de lecture (battements, percussions, basses,
montées, impacts, passages calmes), (3) fournir au GAMEPLAY une grille de rythme déterministe (battements et impacts) : le gameplay ne lit
JAMAIS l'audio, seulement ces tableaux préparés à l'avance, identiques pour le joueur et pour le service qui rejouerait la partie.

Tous les temps du fichier JSON sont exprimés dans le temps du MONTAGE (0 = début de la musique montée), pas dans celui du MP3 : la répétition de
la phrase est déjà appliquée aux tableaux, la position de lecture est donc monotone.

Méthode (numpy, déterministe ; fonctions de base : scripts/analyze-music.py) :
- battements : période par autocorrélation (0,40–0,46 s), placement par programmation dynamique sur l'enveloppe d'attaques (chaque battement tombe
  sur une attaque réelle ; le morceau est à ≈ 140 pulsations/min mais sa pulsation n'est pas parfaitement métronomique : aucune grille supposée),
  force = attaque mesurée, correction de latence d'analyse mesurée sur les attaques fortes ;
- percussions : pics du flux spectral des bandes médium/aigu (caisses, charleston, claquements) à 5 ms de résolution, force normalisée ;
- impacts (« drops ») : grandes attaques isolées dont l'énergie large bande dépasse nettement le niveau local, avec basses ;
- montées : intervalles où l'intensité (énergie lissée) croît nettement pendant au moins 3 s ; passages calmes : intensité basse pendant 2 s au moins ;
- basses (30–150 Hz) et intensité à 30 images/s, normalisées sur le morceau ;
- montage : le morceau fait ≈ 118,8 s dont le dernier coup sec (≈ 116,8 s) est suivi d'une queue de réverbération ; une phrase de PHRASE_BARS mesures est
  répétée (le saut revient `PHRASE_BARS` mesures en arrière, sur un battement réel) pour que ce dernier coup tombe sur l'ouverture de la faille de
  sortie. Le point de raccord est celui dont les contextes avant/après se ressemblent le plus.

Usage : python3 -I scripts/analyze-world2.py [mp3] [sortie.json]
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
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'src', 'data', 'polar-rift-world2.json')
SR = am.SR
ENV_FPS = am.ENV_FPS
PHRASE_BARS = 3          # longueur de la phrase répétée (mesures de 4 temps)
BEATS_PER_BAR = 4
XFADE = 0.08             # fondu de raccord (s), terminé AVANT l'attaque du battement de raccord
CUT_LEVEL = 0.5          # le dernier coup sec : énergie 30 ms après < CUT_LEVEL × énergie 30 ms avant


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
    return np.concatenate([np.zeros(int(n / 2 / hop)), o]), fps


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

    # ———— battements
    o0 = on - on.mean()
    lags = np.arange(int(0.40 * am.ONSET_FPS), int(0.46 * am.ONSET_FPS) + 1)
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

    # Contrôle de synchronisation : écart entre chaque battement fort de la carte et la montée réelle de l'attaque (enveloppe large bande au pas de
    # l'échantillon, lissage 4 ms), mesuré APRÈS correction. Un décalage systématique > 20 ms signalerait une carte en retard ou en avance sur le son.
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

    # ———— dernier coup sec (fin du contenu fort) : chute d'énergie brutale suivie de la queue de réverbération
    e100 = am.full_rms(x, 100)
    cut = None
    for j in range(int(60 * 100), len(e100) - 6):
        before = e100[j - 3: j].mean()
        after = e100[j + 3: j + 6].mean()
        if before > 0.15 and after < CUT_LEVEL * before and e100[j - 30: j].mean() > 0.2:
            cut = j / 100.0
            break
    if cut is None:
        raise SystemExit('dernier coup sec introuvable')
    print(f'dernier coup sec (chute d’énergie) à {cut:.2f} s ; queue jusqu’à {D:.2f} s')

    # ———— percussions (médium + aigu)
    mid, fps = fine_flux(x, 180, 1400)
    top, _ = fine_flux(x, 2500, 12000)
    perc = mid / (np.percentile(mid, 95) + 1e-9) * 0.6 + top / (np.percentile(top, 95) + 1e-9) * 0.4
    # tendance retirée (0,3 s) : on garde les attaques
    perc = np.maximum(0, perc - np.convolve(perc, np.ones(int(0.3 * fps)) / (0.3 * fps), 'same'))
    thr = np.percentile(perc, 94)
    pk = peaks(perc, fps, thr, 0.11)
    pt = np.array(pk) / fps
    ps = np.clip(perc[pk] / (np.percentile(perc[pk], 92) + 1e-9), 0, 1)
    # Affinage : chaque pic de flux (fenêtre de 23 ms) est recalé sur la montée réelle de l'attaque dans la bande aiguë (> 1,5 kHz, lissage 3 ms) à ± 35 ms
    xh = x - np.convolve(x, np.ones(int(SR / 1500)) / int(SR / 1500), 'same')  # passe-haut grossier (retire le grave)
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
    print(f'percussions : {len(pt)} (≥ percentile 94, écart ≥ 0,11 s) ; recalage sur l’attaque : médian {np.median(moved) * 1000:+.1f} ms, p10/p90 {np.percentile(moved, 10) * 1000:+.0f}/{np.percentile(moved, 90) * 1000:+.0f} ms')

    # ———— impacts : grandes attaques isolées
    d_on = on.copy()
    cands = []
    for i0 in range(150, len(d_on) - 150):
        if d_on[i0] < d_on[i0 - 1] or d_on[i0] <= d_on[i0 + 1]:
            continue
        local = np.median(d_on[i0 - 400: i0 + 400])
        if d_on[i0] > 6 * local and d_on[i0] > np.percentile(d_on, 99.3):
            cands.append((float(d_on[i0]), i0))
    cands.sort(reverse=True)
    kept = []
    for v, i0 in cands:
        if all(abs(i0 - j) > 150 for _, j in kept):
            kept.append((v, i0))
    kept.sort(key=lambda p: p[1])
    drops_f = np.array([j / am.ONSET_FPS + shift for _, j in kept])
    dmax = max(v for v, _ in kept)
    dstr = np.array([v / dmax for v, _ in kept])
    # calés sur le battement le plus proche s'il est à moins de 0,12 s
    for q, t in enumerate(drops_f):
        j = int(np.argmin(np.abs(beats - t)))
        if abs(beats[j] - t) < 0.12:
            drops_f[q] = beats[j]
    print('impacts (s du fichier) :', [round(float(t), 2) for t in drops_f], 'forces', [round(float(s), 2) for s in dstr])

    # ———— montage : choix du raccord (battement A, saut de PHRASE_BARS mesures en arrière)
    L_beats = PHRASE_BARS * BEATS_PER_BAR
    S = am.spectrum(x, SR // 100)
    freqs = np.fft.rfftfreq(am.N_FFT, 1 / SR)
    edges = np.geomspace(60, 12000, 25)

    def sig(t0, t1):
        a, b = int(t0 * 100), int(t1 * 100)
        v = np.log1p(100 * S[a:b].mean(0))
        return np.array([v[(freqs >= edges[j]) & (freqs < edges[j + 1])].mean() for j in range(len(edges) - 1)])

    def dist(u, v):
        return float(np.linalg.norm(u - v) / (np.linalg.norm(u) + np.linalg.norm(v) + 1e-9))

    best = None
    for ia in range(L_beats + 4, len(beats) - 4):
        A = float(beats[ia])
        B = float(beats[ia - L_beats])       # début de la phrase répétée
        if A < 30 or A > cut - 12 or B < 14:
            continue
        # le raccord ne doit pas traverser une rupture : ni impact ni calme entre B et A
        if any(B - 1.0 < t < A + 1.0 for t in drops_f):
            continue
        if bass[int(B * ENV_FPS): int(A * ENV_FPS)].min() < 0.1:
            continue
        span = 2.5
        before = dist(sig(A - span, A), sig(B - span, B))
        after = dist(sig(A, A + span), sig(B, B + span))
        ea = float(e[int((A - 2) * ENV_FPS): int(A * ENV_FPS)].mean())
        eb = float(e[int((B - 2) * ENV_FPS): int(B * ENV_FPS)].mean())
        score = before + after + 0.5 * abs(ea - eb) / (eb + 1e-9)
        # préférence légère pour la seconde moitié du morceau (le premier plateau reste dans l'ordre du fichier)
        if best is None or score < best[0]:
            best = (score, A, B, before, after)
    if best is None:
        raise SystemExit('aucun raccord possible')
    _, A, B, sb, sa = best
    Lsec = A - B
    print(f'raccord : saut du battement {A:.3f} s vers {B:.3f} s (phrase de {Lsec:.3f} s = {L_beats} battements, {PHRASE_BARS} mesures) ; '
          f'distance avant {sb:.3f}, après {sa:.3f}')
    M = D + Lsec  # durée du montage (queue comprise)

    def to_m(t):
        """Temps du fichier → temps du montage (liste de positions : avant le raccord, et après — la phrase [B, A) existe deux fois)."""
        out = []
        if t <= A + 1e-9:
            out.append(t)
        if t >= B - 1e-9:
            out.append(t + Lsec)
        return out

    def seq(times, vals=None):
        pairs = []
        for q, t in enumerate(times):
            for tm in to_m(float(t)):
                pairs.append((tm, None if vals is None else float(vals[q])))
        pairs.sort(key=lambda p: p[0])
        # Le repère du raccord (battement A = battement B décalé de la phrase) existe dans les deux segments : un seul exemplaire, jamais deux événements au même instant
        out = []
        for tm, v in pairs:
            if out and tm - out[-1][0] < 0.04:
                if v is not None and out[-1][1] is not None and v > out[-1][1]:
                    out[-1] = (out[-1][0], v)
                continue
            out.append((tm, v))
        return out

    # tableaux dans le temps du montage
    bp = seq(beats, strength)
    pp = seq(pt, ps)
    dp = seq(drops_f, dstr)

    # enveloppes montées : copie des images du fichier selon le plan
    def env_m(arr):
        out = np.zeros(int(round(M * ENV_FPS)), np.float32)
        for fm in range(len(out)):
            t_m = fm / ENV_FPS
            t_f = t_m if t_m < A else t_m - Lsec
            j = min(len(arr) - 1, int(round(t_f * ENV_FPS)))
            out[fm] = arr[j]
        return out

    bass_m, int_m = env_m(bass), env_m(inten)
    cut_m = cut + Lsec

    # ———— montées et passages calmes, détectés sur les enveloppes du MONTAGE (temps du montage)
    feel = 0.5 * int_m + 0.5 * am.smooth(bass_m, int(1.5 * ENV_FPS))
    sf = am.smooth(feel, 3 * ENV_FPS)
    grad = np.gradient(sf) * ENV_FPS
    builds_m, i0 = [], 0
    while i0 < len(grad):
        if grad[i0] > 0.025:
            j = i0
            while j < len(grad) and grad[j] > 0.025:
                j += 1
            if (j - i0) / ENV_FPS >= 2.5 and sf[j - 1] - sf[i0] > 0.1:
                builds_m.append([i0 / ENV_FPS, j / ENV_FPS])
            i0 = j
        else:
            i0 += 1
    bs1 = am.smooth(bass_m, ENV_FPS)
    is1 = am.smooth(int_m, ENV_FPS)
    calm_m, i0 = [], 0
    low = np.zeros(len(bs1), bool)
    for q in range(len(bs1)):
        prev = bs1[max(0, q - 6 * ENV_FPS): q].mean() if q > ENV_FPS else 1.0
        low[q] = (bs1[q] < 0.12 and is1[q] < 0.16) or (bs1[q] < 0.45 * max(prev, 0.2) and prev > 0.3)
    while i0 < len(low):
        if low[i0]:
            j = i0
            while j < len(low) and low[j]:
                j += 1
            if (j - i0) / ENV_FPS >= 1.0:
                calm_m.append([i0 / ENV_FPS, j / ENV_FPS])
            i0 = j
        else:
            i0 += 1
    print('montées (montage) :', [[round(a, 1), round(b, 1)] for a, b in builds_m])
    print('calmes (montage)  :', [[round(a, 1), round(b, 1)] for a, b in calm_m])
    print(f'montage : {M:.3f} s ; dernier coup sec à {cut_m:.3f} s ; battements {len(bp)} ; percussions {len(pp)} ; impacts {len(dp)}')

    # carte du montage (par tranche de 10 s) : lecture rapide de la structure
    print('structure du montage (t montage : intensité, basses, battements, percussions) :')
    for s0 in range(0, int(M), 10):
        a, b = int(s0 * ENV_FPS), int(min(M, s0 + 10) * ENV_FPS)
        print(f'  {s0:3d}–{min(int(M), s0 + 10):3d} s : intensité {int_m[a:b].mean():.2f}  basses {bass_m[a:b].mean():.2f}  '
              f'battements {sum(1 for t, _ in bp if s0 <= t < s0 + 10)}  percussions {sum(1 for t, _ in pp if s0 <= t < s0 + 10)}')

    out = {
        'schemaVersion': 1,
        'generator': 'scripts/analyze-world2.py',
        'file': 'polar-rift-world2.mp3',
        'note': 'Temps en secondes dans le MONTAGE (0 = début de la musique montée). Segments : lecture du fichier [from, to) placée à at. Enveloppes : octets 0–255 en hexadécimal, envFps images/s.',
        'fileDuration': round(D, 3),
        'beatPeriod': round(float(period), 5),
        'envFps': ENV_FPS,
        'plan': {
            'segments': [
                {'from': 0.0, 'to': round(A, 4), 'at': 0.0},
                {'from': round(B, 4), 'to': round(D, 4), 'at': round(A, 4)},
            ],
            'crossfade': XFADE,
            'duration': round(M, 4),
            'repeat': {'from': round(B, 4), 'to': round(A, 4), 'length': round(Lsec, 4), 'beats': L_beats},
            'cut': round(cut_m, 4),
        },
        'beats': [round(t, 3) for t, _ in bp],
        'strength': [round(s, 2) for _, s in bp],
        'hits': [round(t, 3) for t, _ in pp],
        'hitStrength': [round(s, 2) for _, s in pp],
        'drops': [round(t, 3) for t, _ in dp],
        'dropStrength': [round(s, 2) for _, s in dp],
        'builds': [[round(a, 3), round(b, 3)] for a, b in builds_m],
        'calm': [[round(a, 3), round(b, 3)] for a, b in calm_m],
        'bass': am.q8(bass_m),
        'intensity': am.q8(int_m),
    }
    with open(OUT, 'w') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    print(f'écrit {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT) // 1024} Ko)')


if __name__ == '__main__':
    main()
