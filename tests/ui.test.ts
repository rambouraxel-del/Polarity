import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GAME_NAME, STORAGE_NAMESPACE } from '../src/config/brand';
import { LEVELS } from '../src/config/levels';
import { SKIN_CONFIG } from '../src/config/skins';
import { TEST_PACK_ID, addTestPack } from './helpers';
import { ACHIEVEMENTS } from '../src/progression/achievements';
import { BACKUP_PREFIX, BALANCE_BACKUP_PREFIX, CORRUPT_KEY, SAVE_KEY, defaultSave } from '../src/save/save';
import { THEME, contrast, themeVariables, type ThemeColor } from '../src/ui/theme';
import { bannerHelp } from '../src/ui/controls';
import { applyRun } from '../src/progression/progress';
import { formatScore } from '../src/ui/format';
import * as S from '../src/ui/screens';

const STYLES = join(__dirname, '..', 'src', 'styles');
const css = readdirSync(STYLES).filter((f) => f.endsWith('.css')).map((f) => ({ f, text: readFileSync(join(STYLES, f), 'utf8') }));

describe('marque et sauvegarde', () => {
  it('le nom affiché est Polar Rift et les clés de sauvegarde restent « polarite.* »', () => {
    expect(GAME_NAME).toBe('Polar Rift');
    expect(STORAGE_NAMESPACE).toBe('polarite');
    for (const k of [SAVE_KEY, CORRUPT_KEY, BACKUP_PREFIX, BALANCE_BACKUP_PREFIX]) expect(k.startsWith('polarite.')).toBe(true);
    expect(SAVE_KEY).toBe('polarite.save');
  });
});

describe('thème centralisé', () => {
  it('définit une variable CSS (et son triplet RGB) par couleur', () => {
    const names = new Set(themeVariables().map(([n]) => n));
    for (const c of Object.keys(THEME.color)) {
      const kebab = c.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      expect(names.has(`--c-${kebab}`)).toBe(true);
      expect(names.has(`--c-${kebab}-rgb`)).toBe(true);
    }
  });

  it('les feuilles de style n’utilisent aucune couleur écrite en dur', () => {
    for (const { f, text } of css) {
      // Seules exceptions : les valeurs de repli de var(--c-x, #hex) avant l'exécution du script (base.css)
      const noComments = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/,\s*#[0-9a-fA-F]{3,8}\)/g, ')');
      expect(noComments.match(/#[0-9a-fA-F]{3,8}\b/g), `${f} : couleur hexadécimale`).toBeNull();
      expect(noComments.match(/\brgba?\(\s*\d/g), `${f} : rgb() numérique`).toBeNull();
    }
  });

  it('toutes les variables --c-/--r-/--t-/--font- utilisées par les styles existent', () => {
    const defined = new Set(themeVariables().map(([n]) => n));
    // --fill (curseur de volume) est écrit en ligne par l'application
    const local = new Set<string>(['--fill']);
    for (const { text } of css) for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:/g)) local.add(m[1]);
    for (const { f, text } of css) {
      for (const m of text.matchAll(/var\((--[a-z0-9-]+)/g)) {
        expect(defined.has(m[1]) || local.has(m[1]), `${f} : ${m[1]}`).toBe(true);
      }
      for (const m of text.matchAll(/rgb\(var\((--c-[a-z0-9-]+-rgb)\)/g)) expect(defined.has(m[1]), `${f} : ${m[1]}`).toBe(true);
    }
  });

  it('les textes restent lisibles (contraste WCAG ≥ 4,5 sur les panneaux et les boutons)', () => {
    const c = THEME.color;
    for (const fg of [c.text, c.white, c.muted, c.gold, c.cyan] as string[]) expect(contrast(fg, c.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.ink, c.cyan)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.coral, c.panel)).toBeGreaterThanOrEqual(3);
  });

  it('couleurs de l’arène : fond et quadrillage inchangés, orbite cyan vif', () => {
    const t = THEME.color as Record<ThemeColor, string>;
    expect(t.bgDeep).toBe('#070B1F');
    expect(t.grid).toBe('#16204A');
    expect(t.orbit).toBe('#00E5FF');
  });
});

describe('écrans : données réelles', () => {
  const save = defaultSave();

  it('accueil : Survie en tête, puis Campagne et Défi quotidien, puis Apparences, Succès, Options', () => {
    const html = S.homeScreen(save, '2026-10-12');
    const order = ['data-action="survival"', 'data-action="campaign"', 'data-action="daily"', 'data-action="cosmetics"', 'data-action="achievements"', 'data-action="leaderboard"', 'data-action="options"'];
    const idx = order.map((s) => html.indexOf(s));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(html).toContain('alt="Polar Rift"');
    expect(html).toContain('home__version');
    expect(html).not.toContain('reload-app');
    expect(S.homeScreen(save, '2026-10-12', false, true)).toContain('data-action="reload-app"');
    expect(html).toContain(`0/${ACHIEVEMENTS.length}`);
  });

  it('niveaux : 12 cartes, un seul niveau à jouer, les autres verrouillés', () => {
    const html = S.levelsScreen(save);
    expect(html.match(/class="level-card[ "]/g)?.length ?? 0).toBe(LEVELS.length);
    expect(S.nextLevelId(save)).toBe(1);
    expect(html.match(/disabled/g)?.length).toBe(LEVELS.length - 1);
  });

  it('options, apparences, succès, pause, résultat : rendus sans valeur figée', () => {
    expect(S.optionsScreen(save)).toContain('Polar Rift v');
    expect(S.cosmeticsScreen(save, 'ships', 'all')).toContain('data-action="cat-trails"');
    const ach = S.achievementsScreen(save);
    for (const a of ACHIEVEMENTS) expect(ach).toContain(a.name);
    expect(S.pauseScreen('Survie')).toContain('data-action="resume"');
    expect(S.confirmResetScreen()).toContain('data-action');
  });
});

describe('Boutique (cosmétiques en Médailles, au choix Éclats / Prismes ; bonus en Éclats)', () => {
  const base = (): ReturnType<typeof defaultSave> => {
    const s = defaultSave();
    s.wallet = { shards: 1200, medals: 700, prisms: 0 };
    s.owned = ['chantier-orbital'];
    s.skin = 'chantier-orbital';
    s.achievements = { first_cycle: 1 };
    return s;
  };
  /** Identifiants des cartes cliquables, dans l'ordre d'affichage. */
  const cardIds = (html: string): string[] => [...html.matchAll(/data-action="select-item" data-item="([^"]+)"/g)].map((m) => m[1]);
  /** Boutons `buy` (balise ouvrante) d'un écran. */
  const buyButtons = (html: string): string[] => html.match(/<button[^>]*data-action="buy"[^>]*>/g) ?? [];

  it('soldes affichés une seule fois, quatre catégories (dont Bonus), trois filtres', () => {
    const html = S.cosmeticsScreen(base(), 'ships', 'all');
    expect(html.match(/data-wallet="shards"/g)?.length).toBe(1);
    expect(html.match(/data-wallet="medals"/g)?.length).toBe(1);
    // Sans service de comptes, le solde de Prismes n'est pas affiché (aucune monnaie « fantôme »)
    expect(html).not.toContain('data-wallet="prisms"');
    for (const a of ['cat-ships', 'cat-trails', 'cat-bonus', 'cat-prisms', 'filter-all', 'filter-owned', 'filter-locked']) expect(html).toContain(`data-action="${a}"`);
    expect(html).not.toContain('cat-packs'); // l'onglet « Packs » n'existe plus
    expect(html).not.toContain('tab-shop');
    expect(S.homeScreen(base(), '2026-10-12')).not.toContain('data-action="skins"');
  });

  it('filtres : Tous, Possédés, À débloquer', () => {
    const save = base();
    const all = S.cosmeticItems(save, 'ships', 'all').map((i) => i.id);
    const owned = S.cosmeticItems(save, 'ships', 'owned').map((i) => i.id);
    const locked = S.cosmeticItems(save, 'ships', 'locked').map((i) => i.id);
    expect(owned.sort()).toEqual(['chantier-orbital', 'tole-brute']);
    expect(locked).toEqual(all.filter((id) => !owned.includes(id)));
    expect(owned.length + locked.length).toBe(all.length);
    expect(locked).toContain('long-courrier');
    expect(locked).toContain('cartographe');
    expect(locked).toContain('porcelaine');
    // L'article affiché appartient toujours au filtre
    expect(S.cosmeticsScreen(save, 'ships', 'locked', 'chantier-orbital')).not.toContain('data-skin-preview="chantier-orbital"');
    expect(S.cosmeticsScreen(save, 'ships', 'owned')).toContain('data-skin-preview="chantier-orbital"');
    // Catégorie vide dans un filtre : message
    const everything = base();
    everything.owned = S.cosmeticItems(everything, 'ships', 'all').map((i) => i.id);
    expect(S.cosmeticsScreen(everything, 'ships', 'locked')).toContain('Tout est débloqué');
  });

  it('états : Acheter, Médailles insuffisantes, Équiper, Équipé, Indisponible', () => {
    const save = base();
    let html = S.cosmeticsScreen(save, 'ships', 'all', 'carbone-utilitaire');
    expect(html).toMatch(/data-action="buy"[^>]*data-item="carbone-utilitaire"/);
    expect(html).toContain('Acheter');
    save.wallet.medals = 50;
    html = S.cosmeticsScreen(save, 'ships', 'all', 'carbone-utilitaire');
    expect(html).toContain('Médailles insuffisantes');
    expect(html).toMatch(/data-action="buy"\s+disabled/);
    expect(html).toContain('Il manque 100 Médailles');
    // Les Éclats ne financent pas un cosmétique en Médailles : le solde d'Éclats n'y change rien
    save.wallet.shards = 100000;
    expect(S.cosmeticsScreen(save, 'ships', 'all', 'carbone-utilitaire')).toContain('Il manque 100 Médailles');
    save.owned.push('dipole');
    html = S.cosmeticsScreen(save, 'ships', 'all', 'dipole');
    expect(html).toMatch(/data-action="equip-item"[^>]*data-item="dipole"/);
    expect(html).toContain('Possédé');
    html = S.cosmeticsScreen(save, 'ships', 'all', 'chantier-orbital');
    expect(html).toContain('Équipé');
    // Pas de « succès requis » : un vaisseau s'achète en Médailles, à son prix
    html = S.cosmeticsScreen(save, 'ships', 'all', 'cartographe');
    expect(html).not.toContain('Succès requis');
    expect(html).toContain('300');
    // Indisponible (Porcelaine) : prix absent, aucun achat possible
    html = S.cosmeticsScreen(save, 'ships', 'all', 'porcelaine');
    expect(html).toContain('Indisponible');
    expect(buyButtons(html).every((b) => b.includes('disabled'))).toBe(true);
    expect(html).not.toMatch(/data-action="equip-item"[^>]*data-item="porcelaine"/);
  });

  it('achat au choix : un bouton par monnaie (data-currency), Éclats actif si le solde suffit, Prismes inactif sans service', () => {
    const save = base();
    save.wallet.shards = 1500;
    let html = S.cosmeticsScreen(save, 'ships', 'all', 'long-courrier');
    const shards = buyButtons(html).find((b) => b.includes('data-currency="shards"'));
    const prisms = buyButtons(html).find((b) => b.includes('data-currency="prisms"'));
    expect(shards).toBeDefined();
    expect(prisms).toBeDefined();
    expect(shards).toContain('data-item="long-courrier"');
    expect(shards).not.toContain('disabled');
    expect(prisms).toContain('disabled'); // Prismes : sans service de comptes
    expect(html).toContain(`${formatScore(1500)} Éclats`);
    expect(html).toContain('60 Prismes');
    expect(html).toContain('Bientôt disponible');
    // Fonds insuffisants : les deux boutons restent visibles mais inactifs
    save.wallet.shards = 100;
    html = S.cosmeticsScreen(save, 'ships', 'all', 'long-courrier');
    expect(buyButtons(html).filter((b) => b.includes('data-currency')).length).toBe(2);
    expect(buyButtons(html).every((b) => b.includes('disabled'))).toBe(true);
    expect(html).toContain('Solde insuffisant');
    // Avec un service et un solde de Prismes CONFIRMÉ : l'option Prismes devient active
    save.economy.managed = true;
    save.wallet.prisms = 60;
    save.economy.confirmed = { shards: 0, medals: 0, prisms: 60 };
    html = S.cosmeticsScreen(save, 'ships', 'all', 'long-courrier');
    expect(buyButtons(html).find((b) => b.includes('data-currency="prisms"'))).not.toContain('disabled');
    expect(S.confirmPurchaseScreen(save, 'long-courrier', false, 'prisms')).toContain('Confirmer l’achat');
    expect(S.confirmPurchaseScreen(save, 'long-courrier', false, 'shards')).toContain('Achat impossible');
  });

  it('les vaisseaux sont présentés dans UNE seule grille, dans l’ordre de la configuration ; les traînées sont indisponibles ; l’onglet Prismes n’a plus de lignes premium', () => {
    const html = S.cosmeticsScreen(base(), 'ships', 'all');
    expect(html).toContain('Vaisseaux');
    expect(html).not.toContain('En Médailles');
    expect(html).not.toContain('Premium · en Prismes');
    expect(html.match(/class="skins"/g)).toHaveLength(1);
    expect(cardIds(html)).toEqual(SKIN_CONFIG.map((c) => c.id));
    // Traînées : message et aucune carte cliquable
    const trails = S.cosmeticsScreen(base(), 'trails', 'all');
    expect(trails).toContain('Indisponible pour l’instant');
    expect(cardIds(trails)).toEqual([]);
    expect(trails).not.toContain('select-item');
    expect(buyButtons(trails)).toEqual([]);
    expect(trails).not.toContain('equip-item');
    // Onglet Prismes : plus aucune ligne premium (aucun article payable en Prismes seulement)
    const prismes = S.cosmeticsScreen(base(), 'prisms', 'all');
    expect(prismes).not.toContain('En Médailles');
    expect(prismes).not.toContain('Premium · en Prismes');
    expect(prismes).not.toContain('data-premium');
    // Un article premium (pack factice) y réapparaîtrait, jamais en Médailles
    const remove = addTestPack(100);
    try {
      const withPack = S.cosmeticsScreen(base(), 'prisms', 'all');
      expect(withPack).toContain('Premium · en Prismes');
      expect(withPack).toContain(`data-premium="${TEST_PACK_ID}"`);
      expect(withPack).not.toContain('En Médailles');
    } finally {
      remove();
    }
  });

  it('chaque article affiche aperçu animé, description, prix ou condition', () => {
    const save = base();
    const remove = addTestPack(100);
    try {
      const pack = S.cosmeticsScreen(save, 'prisms', 'all');
      expect(pack).toContain('Pack test');
      expect(pack).toContain(`data-premium="${TEST_PACK_ID}"`);
      expect(pack).toContain('100');
    } finally {
      remove();
    }
    const ship = S.cosmeticsScreen(save, 'ships', 'all', 'long-courrier');
    expect(ship).toContain('data-skin-preview="long-courrier"');
    expect(ship).toContain('Coque claire, bandes rouges de convoyeur.');
    expect(ship).toContain(formatScore(1500));
    expect(ship).toContain('60');
    // Prestige affiché pour Porcelaine
    expect(S.cosmeticsScreen(save, 'ships', 'all', 'porcelaine')).toContain('prestige 2');
  });

  it('aucun article premium ni option Prismes n’a de bouton de paiement actif sans service, dans aucune catégorie', () => {
    const remove = addTestPack(100);
    try {
      const save = base();
      save.wallet.prisms = 100000;
      save.wallet.shards = 0;
      for (const [tab, item] of [['ships', 'long-courrier'], ['ships', 'basalte'], ['ships', 'arcade-84'], ['trails', 'emeraude'], ['prisms', TEST_PACK_ID]] as const) {
        const html = S.cosmeticsScreen(save, tab, 'all', item);
        expect(buyButtons(html).filter((b) => !b.includes('disabled')), `${tab} ${item}`).toEqual([]);
      }
      expect(S.cosmeticsScreen(save, 'prisms', 'all', TEST_PACK_ID)).toContain('Bientôt');
    } finally {
      remove();
    }
  });

  it('confirmation : récapitulatif sans rien débiter', () => {
    const save = base();
    const html = S.confirmPurchaseScreen(save, 'circuit');
    expect(html).toContain('Confirmer l’achat');
    expect(html).toContain('250');
    expect(html).toMatch(/data-action="confirm-buy"[^>]*data-item="circuit"/);
    expect(html).toContain('data-action="back-cosmetics"');
    expect(save.wallet.medals).toBe(700);
    expect(save.owned).toEqual(['chantier-orbital']);
    expect(S.confirmPurchaseScreen(save, 'inconnu')).not.toContain('confirm-buy');
    // Achat au choix : la monnaie demandée fixe le prix ; sans monnaie, la première option (Éclats)
    save.wallet.shards = 1500;
    const choice = S.confirmPurchaseScreen(save, 'long-courrier', false, 'shards');
    expect(choice).toContain('Confirmer l’achat');
    expect(choice).toContain(formatScore(1500));
    expect(S.confirmPurchaseScreen(save, 'long-courrier')).toContain(formatScore(1500));
    expect(save.wallet).toEqual({ shards: 1500, medals: 700, prisms: 0 });
  });
});

describe('menu Succès', () => {
  it('liste tous les succès par catégorie avec progression, Médailles et état ; « Récupérer » uniquement pour un succès accompli non réclamé', () => {
    const save = defaultSave();
    save.achievements = { first_cycle: 1, first_level: 2 };
    save.medals.claimed = ['first_level'];
    save.stats.totalCycles = 7;
    const html = S.achievementsScreen(save);
    for (const a of ACHIEVEMENTS) {
      expect(html).toContain(a.name);
      expect(html).toContain(`+${formatScore(a.medals)}`);
    }
    for (const c of ['Découverte', 'Survie', 'Niveaux', 'Collectes', 'Maîtrise']) expect(html).toContain(c);
    expect(html).toContain('Obtenu');
    expect(html.match(/data-action="claim-medal"/g)).toHaveLength(1);
    expect(html).toMatch(/data-action="claim-medal"[^>]*data-ach="first_cycle"/);
    expect(html).toContain('Médailles récupérées');
    expect(html).toContain('data-action="claim-all"');
    expect(html).toContain('Tout récupérer (20 Médailles)');
    // Progression : 7 cycles sur 10
    expect(html).toContain('7 / 10');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('0:00 / 1:00');
    expect(html).toContain(`2 / ${ACHIEVEMENTS.length}`);
    // Plus aucun cosmétique annoncé comme récompense d'un succès
    expect(html).not.toContain('Vaisseau Glace');
    expect(html).not.toContain('Traînée Citron');
    // Rien à récupérer : ni « Récupérer » ni « Tout récupérer »
    save.medals.claimed = ['first_level', 'first_cycle'];
    const done = S.achievementsScreen(save);
    expect(done).not.toContain('data-action="claim-medal"');
    expect(done).not.toContain('data-action="claim-all"');
  });

  it('animation de réclamation : la ligne réclamée à l’instant est marquée ; message annoncé aux lecteurs d’écran', () => {
    const save = defaultSave();
    save.achievements = { first_cycle: 1 };
    save.medals.claimed = ['first_cycle'];
    const html = S.achievementsScreen(save, { kind: 'ok', text: '+20 Médailles' }, ['first_cycle']);
    expect(html).toContain('ach--just-claimed');
    expect(html).toMatch(/role="status"[^>]*>\+20 Médailles/);
  });
});

describe('aide aux contrôles', () => {
  it('mobile : toucher ; ordinateur : clic, Espace et Échap', () => {
    const save = defaultSave();
    const touch = S.homeScreen(save, '2026-10-12', true);
    const desk = S.homeScreen(save, '2026-10-12', false);
    expect(touch).toContain('Touchez l’écran');
    expect(touch).not.toContain('Espace');
    expect(desk).toContain('Espace');
    expect(desk).toContain('Échap');
    expect(desk).toContain('Cliquez');
    expect(desk).not.toContain('Touchez');
    expect(bannerHelp(true)).not.toContain('Espace');
    expect(bannerHelp(false)).toContain('Espace');
  });
});

describe('boutique et soldes', () => {
  const base = (): ReturnType<typeof defaultSave> => {
    const s = defaultSave();
    s.wallet = { shards: 1200, medals: 0, prisms: 0 };
    s.owned = ['chantier-orbital'];
    s.skin = 'chantier-orbital';
    return s;
  };

  it('les trois monnaies sont distinctes : Éclats et Médailles sur l’accueil et la boutique ; les Prismes seulement avec un service de comptes', () => {
    const save = base();
    save.wallet.medals = 345;
    for (const html of [S.homeScreen(save, '2026-10-12'), S.cosmeticsScreen(save, 'ships', 'all')]) {
      expect(html).toContain('data-wallet="shards"');
      expect(html).toContain('data-wallet="medals"');
      expect(html).not.toContain('data-wallet="prisms"');
      expect(html).toContain(formatScore(1200));
      expect(html).toContain(formatScore(345));
      expect(html).toContain('Éclats');
      expect(html).toContain('Médailles');
    }
    save.economy.managed = true;
    expect(S.homeScreen(save, '2026-10-12')).toContain('data-wallet="prisms"');
    expect(S.cosmeticsScreen(save, 'ships', 'all')).toContain('data-wallet="prisms"');
  });

  it('un fournisseur de paiement actif ferait apparaître le solde de Prismes (et seulement alors)', async () => {
    const { setPaymentProvider, NullPaymentProvider } = await import('../src/monetization/payments');
    const save = base();
    setPaymentProvider({ isAvailable: () => true, listProducts: async () => [], purchase: async () => ({ status: 'unavailable' }) });
    try {
      expect(S.homeScreen(save, '2026-10-12')).toContain('data-wallet="prisms"');
    } finally {
      setPaymentProvider(new NullPaymentProvider());
    }
    expect(S.homeScreen(save, '2026-10-12')).not.toContain('data-wallet="prisms"');
  });

  it('résultat : Éclats gagnés, origine et nouveau solde ; réafficher l’écran ne recrédite rien', () => {
    const save = defaultSave();
    const rep = applyRun(save, { mode: 'level', levelId: 1, time: 90, score: 60000, cycles: 2, bestMultiplier: 2, outcome: 'complete' });
    expect(save.wallet.shards).toBe(rep.levelReward!.total);
    const html = S.resultScreen(rep, true);
    expect(html).toContain('Première réussite du niveau');
    expect(html).toContain(`+${rep.levelReward!.total}`);
    expect(html).toContain('Nouveau solde');
    const before = save.wallet.shards;
    S.resultScreen(rep, true);
    S.resultScreen(rep, true);
    expect(save.wallet.shards).toBe(before);
    // Survie : Éclats collectés sur l'orbite
    const surv = applyRun(save, { mode: 'survival', time: 84.6, score: 12400, cycles: 3, bestMultiplier: 3, outcome: 'dead', shards: 25 });
    const h2 = S.resultScreen(surv, false);
    expect(h2).toContain('Éclats collectés sur l’orbite');
    expect(h2).toContain('+25');
    // Les succès ne versent plus d'Éclats ; réafficher l'écran ne crédite rien
    expect(save.wallet.shards).toBe(before);
    const after = save.wallet.shards;
    S.resultScreen(surv, false);
    S.resultScreen(surv, false);
    expect(save.wallet.shards).toBe(after);
    // Notification des succès obtenus : Médailles à récupérer (non créditées)
    const notif = S.resultScreen(rep, true);
    expect(notif).toContain('Succès');
    expect(notif).toContain('Médailles à récupérer');
  });
});
