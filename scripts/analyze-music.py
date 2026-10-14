#!/usr/bin/env python3
"""
Carte musicale de Polar Rift : analyse HORS LIGNE des trois morceaux de partie (intro, boucle, outro).

Produit `src/data/polar-rift-music-map.json`, lu par le jeu pour synchroniser l'ambiance visuelle de la Survie
sur la position RÉELLE de lecture (voir docs/AMBIANCE.md). Les fichiers MP3 ne sont ni modifiés ni réencodés :
ils sont seulement décodés (ffmpeg) en mémoire pour l'analyse.

Méthode (numpy uniquement, déterministe) :
- enveloppe d'attaques (flux spectral, basses renforcées) à 100 images/s ;
- période du battement estimée par autocorrélation de cette enveloppe (aucun BPM supposé : on cherche le pic
  le plus fort entre 0,3 et 0,75 s, plage d'une pulsation dansable) ;
- placement des battements par programmation dynamique (Ellis 2007) : chaque battement tombe sur une attaque réelle ;
- force de chaque battement = attaque mesurée à cet instant (un passage sans pulsation donne des battements faibles,
  que le jeu ignore : pas de fausse synchronisation) ;
- basses (30–150 Hz) et intensité (énergie lissée ~2 s) à 30 images/s, normalisées sur l'ensemble des morceaux ;
- « drops » (passages forts) : saut d'énergie et de basses entre les 6 s précédentes et les 2 s suivantes ;
- « montées » : intervalles où l'intensité croît nettement pendant au moins 3 s.
La boucle est analysée dans son contexte circulaire (intro + boucle + boucle) : un événement situé au raccord
de la boucle est détecté comme à l'écoute.

Usage : python3 -I scripts/analyze-music.py [dossier_audio] [repères.json] [sortie.json]
"""
import json
import os
import subprocess
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO_DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'src', 'assets', 'audio')
TIMING = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'src', 'data', 'polar-rift-audio.json')
OUT = sys.argv[3] if len(sys.argv) > 3 else os.path.join(ROOT, 'src', 'data', 'polar-rift-music-map.json')

SR = 44100
ONSET_FPS = 100  # enveloppe d'attaques
ENV_FPS = 30  # enveloppes stockées (basses, intensité)
N_FFT = 2048


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def spectrum(x, hop):
    frames = max(1, (len(x) - N_FFT) // hop + 1)
    win = np.hanning(N_FFT).astype(np.float32)
    out = np.empty((frames, N_FFT // 2 + 1), np.float32)
    for i in range(0, frames, 2000):
        j = min(frames, i + 2000)
        idx = np.arange(N_FFT)[None, :] + hop * np.arange(i, j)[:, None]
        out[i:j] = np.abs(np.fft.rfft(x[idx] * win, axis=1))
    return out


def centered(sig, fps):
    """Le signal est calculé sur des fenêtres de N_FFT : on le recentre sur le milieu de chaque fenêtre."""
    shift = int(round((N_FFT / 2) / SR * fps))
    return np.concatenate([np.full(shift, sig[0]), sig])


def onset_envelope(x):
    hop = SR // ONSET_FPS
    S = spectrum(x, hop)
    freqs = np.fft.rfftfreq(N_FFT, 1 / SR)
    L = np.log1p(100 * S)
    flux = np.maximum(0, np.diff(L, axis=0, prepend=L[:1]))
    o = flux[:, freqs < 200].sum(1) * 2 + flux.sum(1) * 0.5
    o = o - np.convolve(o, np.ones(50) / 50, 'same')  # retire la tendance (1/2 s)
    return centered(np.maximum(o, 0), ONSET_FPS)


def band_rms(x, fps, lo, hi):
    hop = SR // fps
    S = spectrum(x, hop)
    freqs = np.fft.rfftfreq(N_FFT, 1 / SR)
    band = S[:, (freqs >= lo) & (freqs < hi)]
    return centered(np.sqrt((band ** 2).mean(1)), fps)


def full_rms(x, fps):
    hop = SR // fps
    n = len(x) // hop
    return np.sqrt((x[: n * hop].reshape(n, hop) ** 2).mean(1))


def beat_period(o):
    o = o - o.mean()
    lags = np.arange(int(0.3 * ONSET_FPS), int(0.75 * ONSET_FPS) + 1)
    ac = np.array([np.dot(o[:-k], o[k:]) / (len(o) - k) for k in lags])
    k = lags[int(np.argmax(ac))]
    # Affinage parabolique (sous-image)
    i = int(np.argmax(ac))
    if 0 < i < len(ac) - 1:
        a, b, c = ac[i - 1], ac[i], ac[i + 1]
        k = k + 0.5 * (a - c) / (a - 2 * b + c)
    return k / ONSET_FPS


def track_beats(o, period, tightness=120.0):
    """Programmation dynamique (Ellis 2007) : battements alignés sur les attaques, espacement proche de la période."""
    p = period * ONSET_FPS
    n = len(o)
    score = o / (o.std() + 1e-9)
    cum = score.copy()
    back = np.full(n, -1)
    lo, hi = int(round(p * 0.5)), int(round(p * 2))
    for i in range(hi, n):
        prev = np.arange(i - hi, i - lo + 1)
        pen = -tightness * (np.log((i - prev) / p)) ** 2
        cand = cum[prev] + pen
        j = int(np.argmax(cand))
        cum[i] = score[i] + cand[j]
        back[i] = prev[j]
    # Dernier battement : meilleur score dans la dernière période
    tail = np.arange(max(0, n - int(p)), n)
    i = int(tail[np.argmax(cum[tail])])
    beats = []
    while i >= 0:
        beats.append(i)
        i = back[i]
    beats = beats[::-1]
    # Début du morceau : prolonge vers 0 si la DP s'est arrêtée trop tôt
    while beats and beats[0] - p > 0:
        beats.insert(0, int(round(beats[0] - p)))
    return np.array(beats)


def attack_shift(x, beat_times, strength):
    """
    Décalage systématique (s) entre l'instant d'un battement de la carte et la montée réelle de l'attaque.
    Le flux spectral (fenêtres de 46 ms) détecte les attaques légèrement trop tôt ; on mesure, sur les battements forts,
    l'écart médian avec la montée la plus rapide de l'enveloppe large bande au pas de l'échantillon (lissage 4 ms),
    et la carte est corrigée de cette valeur (auto-calibrée sur l'audio, pas supposée).
    """
    d = np.abs(np.diff(x, prepend=0.0))
    k = int(0.004 * SR)
    env = np.convolve(d, np.ones(k) / k, 'same')
    offs = []
    for b, st in zip(beat_times, strength):
        if st < 0.6:
            continue
        c = int(b * SR)
        lo, hi = max(1, c - int(0.07 * SR)), min(len(env) - 1, c + int(0.07 * SR))
        if hi - lo < 100:
            continue
        offs.append((lo + int(np.argmax(np.diff(env[lo:hi])))) / SR - b)
    return float(np.median(offs)) if len(offs) >= 8 else 0.0


def smooth(sig, n):
    if n <= 1:
        return sig
    k = np.ones(n) / n
    pad = np.concatenate([np.full(n, sig[0]), sig, np.full(n, sig[-1])])
    return np.convolve(pad, k, 'same')[n:-n]


def q8(arr):
    a = np.clip(np.round(np.asarray(arr) * 255), 0, 255).astype(np.uint8)
    return a.tobytes().hex()


def main():
    timing = json.load(open(TIMING))
    files = timing['files']
    intro = decode(os.path.join(AUDIO_DIR, files['intro']['file']))
    loop_full = decode(os.path.join(AUDIO_DIR, files['loop']['file']))
    outro = decode(os.path.join(AUDIO_DIR, files['outro']['file']))
    ls, le = files['loop']['loopStartSamples'], files['loop']['loopEndSamples']
    loop = loop_full[ls:le]
    I, L, O = len(intro) / SR, len(loop) / SR, len(outro) / SR

    # Timeline telle qu'entendue : intro, puis deux tours de boucle (contexte circulaire), outro analysé à part
    timeline = np.concatenate([intro, loop, loop])

    # —— battements
    on_tl = onset_envelope(timeline)
    on_out = onset_envelope(outro)
    period = beat_period(on_tl[int(I * ONSET_FPS):])  # période mesurée sur la boucle (partie rythmique)
    beats_tl = track_beats(on_tl, period)
    beats_out = track_beats(on_out, period)
    strength_tl = np.array([on_tl[max(0, b - 2): b + 3].max() for b in beats_tl])
    strength_out = np.array([on_out[max(0, b - 2): b + 3].max() for b in beats_out]) if len(beats_out) else np.array([])
    ref = np.percentile(strength_tl, 90) + 1e-9
    strength_tl = np.clip(strength_tl / ref, 0, 1)
    strength_out = np.clip(strength_out / ref, 0, 1)

    # —— enveloppes (30 images/s)
    bass_tl = band_rms(timeline, ENV_FPS, 30, 150)
    bass_out = band_rms(outro, ENV_FPS, 30, 150)
    e_tl = full_rms(timeline, ENV_FPS)
    e_out = full_rms(outro, ENV_FPS)
    bref = np.percentile(np.concatenate([bass_tl, bass_out]), 98) + 1e-9
    bass_tl = np.clip(bass_tl / bref, 0, 1)
    bass_out = np.clip(bass_out / bref, 0, 1)
    sm_tl = smooth(e_tl, int(2 * ENV_FPS))
    sm_out = smooth(e_out, int(2 * ENV_FPS))
    both = np.concatenate([sm_tl, sm_out])
    lo, hi = np.percentile(both, 5), np.percentile(both, 99)
    int_tl = np.clip((sm_tl - lo) / (hi - lo + 1e-9), 0, 1)
    int_out = np.clip((sm_out - lo) / (hi - lo + 1e-9), 0, 1)
    # Enveloppes de même longueur (les fenêtres d'analyse diffèrent de quelques images en fin de morceau)
    n = min(len(bass_tl), len(int_tl))
    bass_tl, int_tl = bass_tl[:n], int_tl[:n]
    n = min(len(bass_out), len(int_out))
    bass_out, int_out = bass_out[:n], int_out[:n]

    # —— drops : saut d'énergie (2 s suivantes / 6 s précédentes) avec basses
    def drops(e, b, beats_s):
        n = len(e)
        cand = []
        for i in range(6 * ENV_FPS, n - 2 * ENV_FPS):
            before = e[i - 6 * ENV_FPS: i].mean()
            after = e[i: i + 2 * ENV_FPS].mean()
            bb = b[i - 6 * ENV_FPS: i].mean()
            ba = b[i: i + 2 * ENV_FPS].mean()
            r = after / (before + 1e-9)
            if r > 1.15 and ba > bb * 1.25:
                cand.append((r * ba / (bb + 1e-9), i))
        cand.sort(reverse=True)
        kept = []
        for _, i in cand:
            if all(abs(i - k) > 12 * ENV_FPS for k in kept):
                kept.append(i)
        out = []
        for i in sorted(kept):
            t = i / ENV_FPS
            # Calé sur le battement le plus proche (à moins de 0,3 s)
            if len(beats_s):
                j = int(np.argmin(np.abs(beats_s - t)))
                if abs(beats_s[j] - t) < 0.3:
                    t = float(beats_s[j])
            out.append(t)
        return out

    # —— montées : intensité (4 s) en hausse nette pendant au moins 3 s
    def builds(intensity):
        s = smooth(intensity, 4 * ENV_FPS)
        d = np.gradient(s) * ENV_FPS  # par seconde
        up = d > 0.025
        out, i, n = [], 0, len(up)
        while i < n:
            if up[i]:
                j = i
                while j < n and up[j]:
                    j += 1
                if (j - i) / ENV_FPS >= 3 and s[j - 1] - s[i] > 0.1:
                    out.append([i / ENV_FPS, j / ENV_FPS])
                i = j
            else:
                i += 1
        return out

    beat_t_tl = beats_tl / ONSET_FPS
    beat_t_out = beats_out / ONSET_FPS
    shift = attack_shift(timeline, beat_t_tl, strength_tl)
    beat_t_tl = beat_t_tl + shift
    beat_t_out = beat_t_out + shift
    print(f'correction d’attaque appliquée aux battements : {shift * 1000:+.1f} ms')
    drops_tl = drops(e_tl, bass_tl, beat_t_tl)
    drops_out = drops(e_out, bass_out, beat_t_out)
    builds_tl = builds(int_tl)
    builds_out = builds(int_out)

    def pick_events(times, a, b):
        return [round(t - a, 3) for t in times if a <= t < b]

    def pick_intervals(iv, a, b):
        return [[round(max(s, a) - a, 3), round(min(e, b) - a, 3)] for s, e in iv if e > a and s < b and min(e, b) - max(s, a) >= 2]

    def env_slice(sig, a, b):
        return sig[int(round(a * ENV_FPS)): int(round(b * ENV_FPS))]

    def beats_slice(a, b):
        m = (beat_t_tl >= a) & (beat_t_tl < b)
        return [round(float(t - a), 3) for t in beat_t_tl[m]], [round(float(s), 2) for s in strength_tl[m]]

    tracks = {}
    # Intro : [0, I) de la timeline
    bt, bs = beats_slice(0, I)
    tracks['intro'] = {'duration': round(I, 4), 'beats': bt, 'strength': bs,
                       'bass': q8(env_slice(bass_tl, 0, I)), 'intensity': q8(env_slice(int_tl, 0, I)),
                       'drops': pick_events(drops_tl, 0, I), 'builds': pick_intervals(builds_tl, 0, I)}
    # Boucle : second tour [I + L, I + 2L) (contexte circulaire complet) ; temps relatifs au début de la région en boucle
    a, b = I + L, I + 2 * L
    bt, bs = beats_slice(a, b)
    tracks['loop'] = {'duration': round(L, 4), 'beats': bt, 'strength': bs,
                      'bass': q8(env_slice(bass_tl, a, b)), 'intensity': q8(env_slice(int_tl, a, b)),
                      'drops': pick_events(drops_tl, a, b), 'builds': pick_intervals(builds_tl, a, b)}
    tracks['outro'] = {'duration': round(O, 4), 'beats': [round(float(t), 3) for t in beat_t_out],
                       'strength': [round(float(s), 2) for s in strength_out],
                       'bass': q8(bass_out), 'intensity': q8(int_out),
                       'drops': [round(t, 3) for t in drops_out], 'builds': pick_intervals(builds_out, 0, O)}

    out = {
        'schemaVersion': 1,
        'generator': 'scripts/analyze-music.py',
        'note': 'Temps en secondes : intro et outro depuis le début du fichier ; boucle depuis loopStartSeconds. Enveloppes : octets 0–255 en hexadécimal, ENV_FPS images/s.',
        'envFps': ENV_FPS,
        'beatPeriod': round(period, 4),
        'tracks': tracks,
    }
    with open(OUT, 'w') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    print(f'période {period:.4f} s ({60 / period:.1f} pulsations/min) ; '
          f'battements intro {len(tracks["intro"]["beats"])}, boucle {len(tracks["loop"]["beats"])}, outro {len(tracks["outro"]["beats"])}')
    for k, v in tracks.items():
        print(k, 'drops', v['drops'], 'montées', v['builds'])
    print('écrit', os.path.relpath(OUT, ROOT), os.path.getsize(OUT), 'octets')


if __name__ == '__main__':
    main()
