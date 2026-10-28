import Phaser from 'phaser';
import { AMBIENCE, AMBIENCE_COLORS } from '../../config/ambience';
import { WORLD_LIST } from '../../config/worlds';
import type { AmbienceState } from '../../ambience/director';
import { AMB_TEX } from './textures';
import { clamp01, lerpColor, type AmbienceView } from './view';

const MAX_POINTS = AMBIENCE.quality.tiers.high.holePoints;
/** Harmoniques du contour : fréquence, amplitude, vitesse angulaire (rad/s, signe = sens de rotation des courants). */
const HARM = [
  { k: 2, a: 0.2, w: 0.25 },
  { k: 3, a: 0.15, w: -0.38 },
  { k: 5, a: 0.07, w: 0.52 },
  { k: 8, a: 0.03, w: -0.7 },
] as const;
const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/**
 * Noyau puis faille de la phase 1 : au départ une petite sphère lumineuse ; de 4 min 30 à 5 min elle s'ouvre en un cœur sombre au contour irrégulier
 * (harmoniques qui tournent, sommets qui respirent, pointes cristallines), bordé d'un liseré bleu/violet en trois passes dont l'éclat circule le long du
 * contour. Il pulse avec la musique. Pendant la traversée il grandit jusqu'à envelopper tout l'écran, puis s'efface sous le flash ; il ne reste
 * alors que le point de fuite lumineux du tunnel. Dessiné au-dessus du voile (visible au centre), sous l'orbite, les menaces et le vaisseau.
 * Décoratif : `Math.random` n'est utilisé qu'à l'initialisation des formes.
 */
export class Hole {
  private readonly halo: Phaser.GameObjects.Image;
  private readonly orb: Phaser.GameObjects.Image;
  private readonly dark: Phaser.GameObjects.Graphics;
  private readonly rim: Phaser.GameObjects.Graphics;
  private readonly jag = new Float32Array(MAX_POINTS);
  private readonly ph = new Float32Array(MAX_POINTS);
  private readonly spike = new Uint8Array(MAX_POINTS);
  private readonly px = new Float32Array(MAX_POINTS);
  private readonly py = new Float32Array(MAX_POINTS);
  private readonly psi = HARM.map(() => Math.random() * Math.PI * 2);
  /** Dimensions courantes (unités monde) et axe : utilisés pour faire jaillir les éclairs depuis le bord. */
  radius: number = AMBIENCE.hole.radiusMin;
  rot = 0;
  stretchX = 1;
  stretchY = 1;

  constructor(scene: Phaser.Scene, depth: number) {
    this.halo = scene.add.image(0, 0, AMB_TEX.glow).setDepth(depth).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.dark = scene.add.graphics().setDepth(depth + 0.01).setVisible(false);
    this.rim = scene.add.graphics().setDepth(depth + 0.02).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.orb = scene.add.image(0, 0, AMB_TEX.glow).setDepth(depth + 0.025).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    const cfg = AMBIENCE.hole;
    for (let j = 0; j < MAX_POINTS; j++) {
      this.jag[j] = 0.93 + Math.random() * 0.16;
      this.ph[j] = Math.random() * Math.PI * 2;
    }
    // Pointes réparties le long du contour (indices espacés, légèrement décalés)
    for (let k = 0; k < cfg.spikes; k++) this.spike[Math.min(MAX_POINTS - 1, Math.floor(((k + Math.random() * 0.6) / cfg.spikes) * MAX_POINTS))] = 1;
  }

  setVisible(v: boolean): void {
    this.halo.setVisible(v);
    this.dark.setVisible(v);
    this.rim.setVisible(v);
    this.orb.setVisible(v);
    if (!v) {
      this.dark.clear();
      this.rim.clear();
    }
  }

  /** @param tunnel visibilité du tunnel (0–1) : le cœur sombre devient transparent à mesure que le tunnel apparaît dessous */
  draw(s: AmbienceState, v: AmbienceView, tunnel: number): void {
    const cfg = AMBIENCE.hole;
    const motion = s.reduced ? AMBIENCE.reduced.motion : 1;
    const tr = AMBIENCE.transit;
    const user = s.user;
    const dark = this.dark;
    const rim = this.rim;
    dark.clear();
    rim.clear();

    // Ouverture : sphère → faille (core) puis, pendant la traversée, enveloppe tout l'écran (g)
    const core = s.core;
    const g = s.transit > 0 ? smooth(s.transit / tr.engulfBy) : 0;
    // Univers : la faille se forme à la fin de chaque univers et se referme à l'arrivée (couleurs de la transition)
    const open = s.world > 0 ? s.holeOpen : 1 - s.look; // le cœur sombre s'efface sous le flash
    const worlds = s.world > 0;
    const cover = (v.halfDiag / v.scale) * 2.1;
    // Ouverture rapide au début (la faille est bien visible dès 4 min 45) puis qui s'affine
    const base0 = cfg.radiusMin + (cfg.radiusMax - cfg.radiusMin) * Math.pow(core, 0.5);
    // Croissance lente puis accélérée : le bord lumineux traverse l'écran avant de l'envelopper
    const ge = Math.pow(g, 2.6);
    const base = base0 + (cover - base0) * ge;
    // La Faille (univers 2) : la déchirure pulse franchement avec les basses et les impacts (gain `pulse`), le noyau vibre avec les basses
    const react = 1 + (0.1 * s.beat + 0.05 * s.bass + 0.08 * s.drop) * s.pulse;
    const w2 = AMBIENCE.world2.hole;
    const vib = worlds && s.world === 2 && !s.reduced ? w2.vibrate * s.bass * (1 - s.stab) * v.scale : 0;
    const vx = vib * Math.sin(s.time * 61);
    const vy = vib * Math.cos(s.time * 53);
    const sx = Math.sqrt(cfg.stretch);
    const sy = 1 / sx;
    const rot = AMBIENCE.motion.riftAngle + Math.sin(s.time * 0.05 * motion) * AMBIENCE.motion.riftSway + 0.3 * g;
    this.radius = base * react;
    this.rot = rot;
    this.stretchX = sx;
    this.stretchY = sy;

    // Lueur de fond et sphère centrale / point de fuite
    const heat = clamp01(s.p.heat);
    // La Faille : violet profond → magenta électrique (impacts) ; l'énergie violette cède la place à la brume turquoise pendant la transition de sortie
    const pal = WORLD_LIST[1].palette;
    const exit = s.world === 2 ? Math.max(g, s.worldMix) : 0;
    const w2Violet = lerpColor(lerpColor(pal.primary, pal.secondary, clamp01(0.25 + 0.5 * s.drop + 0.3 * s.perc)), s.riftTo, exit);
    const tint = worlds ? (s.world === 2 ? w2Violet : lerpColor(s.riftFrom, s.riftTo, 0.4 + 0.4 * g)) : lerpColor(AMBIENCE_COLORS.azure, AMBIENCE_COLORS.violet, heat * 0.6 + 0.25 * s.drop);
    const glowBoost = 0.8 + 0.45 * s.bass + 0.3 * s.beat + 0.4 * s.drop;
    const haloSize = Math.max(40 * v.dpr, this.radius * sx * 5.4 * v.scale);
    const haloA = Math.min(cfg.alphaMax, (0.15 + 0.55 * Math.pow(core, 0.5)) * glowBoost * open * (1 - 0.85 * ge) * user);
    this.halo.setPosition(v.cx + vx, v.cy + vy).setTint(tint).setAlpha(haloA).setDisplaySize(haloSize, haloSize * (1 / (sx * sx)) * 1.25).setRotation(rot);
    const orbSize = (60 + 90 * core) * v.scale * (1 + 0.45 * s.beat + 0.2 * s.drop) * (1 + 0.5 * g);
    let orbA = Math.min(1, (0.2 + 0.55 * (1 - core * 0.7)) * user * (0.85 + 0.3 * s.bass) * (1 - 0.75 * g) + 0.1 * s.look * user);
    // Univers 3 et 4 : leurs noyaux propres (sphère gazeuse, œil) remplacent la sphère d'origine, sauf quand la faille se forme
    if (worlds) orbA *= Math.min(1, s.amt[0] + s.amt[1] + core);
    this.orb.setPosition(v.cx, v.cy).setTint(lerpColor(lerpColor(AMBIENCE_COLORS.ice, AMBIENCE_COLORS.azure, Math.max(s.look, g) * 0.7), AMBIENCE_COLORS.white, s.beat * 0.5)).setAlpha(Math.min(cfg.alphaMax + 0.25, orbA * (s.look > 0.5 ? 0.45 : 1))).setDisplaySize(orbSize, orbSize);
    if (open <= 0.01 || user <= 0) return;

    // Contour
    const n = Math.min(MAX_POINTS, s.quality.holePoints);
    // Instabilité (montées, passages intenses) : contour plus déchiré, pointes plus longues
    const unstable = 1 + w2.instability * s.instab;
    const rough = cfg.roughness * (0.3 + 0.7 * core) * unstable;
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const spikeLen = cfg.spikeLength * core * unstable;
    const t = s.time * motion;
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2;
      let noise = 0;
      for (let h = 0; h < HARM.length; h++) noise += HARM[h].a * Math.sin(HARM[h].k * a + this.psi[h] + HARM[h].w * t);
      let rho = (this.jag[j % MAX_POINTS] * (1 + 0.05 * Math.sin(t * 0.9 + this.ph[j % MAX_POINTS])) + rough * noise) * this.radius;
      if (this.spike[Math.floor((j / n) * MAX_POINTS) % MAX_POINTS]) rho *= 1 + spikeLen * (0.75 + 0.25 * Math.sin(t * 1.7 + j));
      const lx = Math.cos(a) * rho * sx;
      const ly = Math.sin(a) * rho * sy;
      this.px[j] = v.cx + vx + (lx * cr - ly * sr) * v.scale;
      this.py[j] = v.cy + vy + (lx * sr + ly * cr) * v.scale;
    }

    // Cœur sombre
    // La Faille : le cœur reste sombre au milieu du tunnel (la déchirure se lit comme un vide), les autres univers le laissent s'effacer
    const darkTunnel = worlds && s.world === 2 ? 1 - (1 - AMBIENCE.world2.hole.darkness) * tunnel : 1 - 0.9 * tunnel;
    const darkA = cfg.darkAlpha * open * Math.min(1, 0.15 + 1.6 * Math.pow(core, 0.7)) * (1 - 0.55 * ge) * darkTunnel * user;
    if (darkA > 0.01) {
      dark.fillStyle(cfg.dark, Math.min(1, darkA));
      dark.beginPath();
      dark.moveTo(this.px[0], this.py[0]);
      for (let j = 1; j < n; j++) dark.lineTo(this.px[j], this.py[j]);
      dark.closePath();
      dark.fillPath();
    }

    // Liseré lumineux : deux passes douces d'un seul tenant, une passe fine dont l'éclat circule le long du contour
    const strength = Math.min(1, 0.25 + 0.9 * core + 0.4 * g) * open * user;
    const widthK = (0.45 + 0.55 * core) * (1 + 2.5 * ge) * (1 + 0.5 * s.beat) * v.scale;
    const inW2 = worlds && s.world === 2;
    const c1 = inW2 ? lerpColor(pal.secondary, s.riftTo, exit) : worlds ? s.riftTo : AMBIENCE_COLORS.violet;
    const c2 = inW2 ? lerpColor(lerpColor(pal.primary, pal.accent, 0.5 + 0.3 * s.drop), s.riftTo, exit) : worlds ? lerpColor(s.riftFrom, s.riftTo, 0.5 + 0.3 * s.drop) : lerpColor(AMBIENCE_COLORS.azure, AMBIENCE_COLORS.violet, heat * 0.6 + 0.3 * s.drop);
    const c3 = lerpColor(AMBIENCE_COLORS.ice, AMBIENCE_COLORS.white, Math.min(1, s.beat * 0.6 + 0.2 * s.drop + 0.5 * s.perc));
    const pulse = 0.78 + 0.22 * Math.min(1, s.beat + 0.6 * s.bass + s.drop * 0.5 + 0.4 * s.perc);
    for (let p = 0; p < 2; p++) {
      const r = cfg.rim[p];
      rim.lineStyle(Math.max(2 * v.dpr, r.width * widthK), p === 0 ? c1 : c2, Math.min(cfg.alphaMax, r.alpha * strength * pulse * 1.4));
      rim.beginPath();
      rim.moveTo(this.px[0], this.py[0]);
      for (let j = 1; j < n; j++) rim.lineTo(this.px[j], this.py[j]);
      rim.closePath();
      rim.strokePath();
    }
    const r3 = cfg.rim[2];
    const w3 = Math.max(1.2 * v.dpr, r3.width * widthK);
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      // Éclat qui circule autour de la faille + scintillement propre à chaque sommet
      const wave = 0.5 + 0.5 * Math.sin(t * 2.2 - (j / n) * Math.PI * 6);
      const flick = 0.75 + 0.25 * Math.sin(t * 5 + this.ph[j % MAX_POINTS] * 3);
      rim.lineStyle(w3, c3, Math.min(1, r3.alpha * strength * pulse * (0.35 + 0.65 * wave) * flick));
      rim.beginPath();
      rim.moveTo(this.px[j], this.py[j]);
      rim.lineTo(this.px[k], this.py[k]);
      rim.strokePath();
    }
  }
}
