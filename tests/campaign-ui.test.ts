import { describe, expect, it } from 'vitest';
import { applyMission } from '../src/campaign/progress';
import type { MissionReport } from '../src/campaign/simulation';
import { MISSIONS, UPGRADES } from '../src/config/campaign';
import { STORY } from '../src/config/story';
import { defaultSave } from '../src/save/save';
import * as C from '../src/ui/campaignScreens';
import * as S from '../src/ui/screens';

const win = (id: number, over: Partial<MissionReport['stars']> = {}): MissionReport => ({
  missionId: id,
  outcome: 'success',
  time: 30,
  beacons: 6,
  cycles: 0,
  maxMultiplier: 1,
  shieldUsed: false,
  objectsCollected: 0,
  objectsMissed: 0,
  stars: { main: true, challenge: false, noShield: true, ...over },
});

describe('écrans de campagne', () => {
  it('accueil : « Campagne » remplace « Niveaux » ; les défis classiques restent accessibles depuis la campagne', () => {
    const home = S.homeScreen(defaultSave(), '2026-10-12');
    expect(home).toContain('data-action="campaign"');
    expect(home).not.toContain('data-action="levels"');
    const camp = C.campaignScreen(defaultSave());
    expect(camp).toContain('data-action="levels"');
    expect(camp).toContain('Défis classiques');
    expect(camp).toContain('data-action="hangar"');
    expect(camp).toContain('data-action="journal"');
  });

  it('carte des chapitres : Écho-7 disponible, chapitre 2 « À venir » sans bouton', () => {
    const html = C.campaignScreen(defaultSave());
    expect(html).toContain('Le signal impossible');
    expect(html).toContain('Commencer');
    const soon = html.slice(html.indexOf('chapter-card--soon'));
    expect(soon).toContain('À venir');
    expect(soon.slice(0, soon.indexOf('</article>'))).not.toContain('<button');
  });

  it('carte des missions : 10 missions, seule la première ouverte', () => {
    const html = C.chapterScreen(defaultSave());
    expect(html.match(/<button class="mission-node[ "]/g)?.length).toBe(MISSIONS.length);
    expect(html.match(/disabled/g)?.length).toBe(MISSIONS.length - 1);
    const s = defaultSave();
    applyMission(s, win(1));
    expect(C.chapterScreen(s).match(/disabled/g)?.length).toBe(MISSIONS.length - 2);
  });

  it('fiche de mission : objectif, deux défis secondaires, récompenses, bouton Lancer', () => {
    const html = C.missionScreen(defaultSave(), 1);
    expect(html).toContain(MISSIONS[0].objectiveText);
    expect(html).toContain(MISSIONS[0].challenge.text);
    expect(html).toContain('Réussir sans déclencher le bouclier');
    expect(html).toContain('+30 Éclats');
    expect(html).toContain('data-action="play-mission"');
    // mission verrouillée : pas de bouton Lancer
    expect(C.missionScreen(defaultSave(), 5)).not.toContain('play-mission');
  });

  it('hangar : améliorations présentées après la mission requise, états achat / possédé', () => {
    const s = defaultSave();
    expect(C.hangarScreen(s)).not.toContain('Bouclier de secours');
    for (let i = 1; i <= 3; i++) applyMission(s, win(i));
    s.wallet.shards = 500;
    const html = C.hangarScreen(s);
    expect(html).toContain('Bouclier de secours');
    expect(html).not.toContain('Collecteur amélioré');
    expect(html).toContain('data-action="buy-upgrade"');
    expect(C.hangarScreen(s, 'shield')).toContain('data-action="confirm-upgrade"');
    s.campaign.upgrades.owned.push('shield');
    s.campaign.upgrades.enabled.push('shield');
    const owned = C.hangarScreen(s);
    expect(owned).toContain('role="switch"');
    expect(owned).toContain('Activée');
    for (const u of UPGRADES) expect(u.name.length).toBeGreaterThan(0);
  });

  it('journal : seules les transmissions découvertes sont listées', () => {
    const s = defaultSave();
    expect(C.journalScreen(s)).toContain('Aucune transmission');
    s.campaign.seen.push(STORY[0].id);
    const html = C.journalScreen(s);
    expect(html).toContain(STORY[0].title);
    expect(html).not.toContain(STORY[1].title);
    expect(html).toContain(`${STORY.length - 1} transmissions encore à découvrir`);
  });

  it('dialogue : une réplique à la fois, passable', () => {
    const seq = STORY[0];
    const first = C.dialogueScreen(seq, 0, 'Lancer');
    expect(first).toContain(seq.lines[0].text.replace(/’/g, '’'));
    expect(first).toContain('data-action="dialogue-skip"');
    const last = C.dialogueScreen(seq, seq.lines.length - 1, 'Lancer');
    expect(last).toContain('Lancer');
    expect(last).not.toContain('dialogue-skip');
  });

  it('résultat : étoiles et gains détaillés ; échec sans récompense', () => {
    const s = defaultSave();
    const res = applyMission(s, win(1, { challenge: true }));
    const html = C.campaignResultScreen(s, res, true);
    expect(html).toContain('Mission accomplie');
    expect(html).toContain('Première réussite');
    expect(html).toContain('data-action="next-mission"');
    expect(html).toContain('data-replay');
    const fail = applyMission(s, { ...win(2), outcome: 'failure', stars: { main: false, challenge: false, noShield: false } });
    const fh = C.campaignResultScreen(s, fail, false);
    expect(fh).toContain('Collision');
    expect(fh).not.toContain('Éclats gagnés');
  });

  it('chapitre terminé : mention de la suite « à venir » et de l’apparence Écho', () => {
    const s = defaultSave();
    let last = applyMission(s, win(10));
    expect(last.chapterCompleted).toBe(true);
    const html = C.campaignResultScreen(s, last, false);
    expect(html).toContain('Chapitre terminé');
    expect(html).toContain('à venir');
    expect(html).toContain('Écho');
    last = applyMission(s, win(10));
    expect(C.campaignResultScreen(s, last, false)).not.toContain('Chapitre terminé');
  });
});
