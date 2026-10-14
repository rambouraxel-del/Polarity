import { describe, expect, it } from 'vitest';
import { applyMission } from '../src/campaign/progress';
import type { MissionReport } from '../src/campaign/simulation';
import { MISSIONS } from '../src/config/campaign';
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
  stars: { main: true, challenge: false, ...over },
});

describe('écrans de campagne', () => {
  it('accueil : « Campagne » remplace « Niveaux » ; les défis classiques restent accessibles depuis la campagne', () => {
    const home = S.homeScreen(defaultSave(), '2026-10-12');
    expect(home).toContain('data-action="campaign"');
    expect(home).not.toContain('data-action="levels"');
    const camp = C.campaignScreen(defaultSave());
    expect(camp).toContain('data-action="levels"');
    expect(camp).toContain('Défis classiques');
    expect(camp).toContain('data-action="journal"');
    expect(camp).not.toContain('data-action="hangar"');
  });

  it('carte des chapitres : chapitre 1 ouvert, suite « À venir » sans bouton', () => {
    const html = C.campaignScreen(defaultSave());
    expect(html).toContain('Douze ans de silence');
    expect(html).toContain('Commencer');
    const soon = html.slice(html.indexOf('chapter-card--soon'));
    expect(soon).toContain('À venir');
    expect(soon.slice(0, soon.indexOf('</article>'))).not.toContain('<button');
  });

  it('carte des niveaux : 10 niveaux, un seul ouvert, puis « Suite du chapitre à venir » (information, pas un bouton)', () => {
    const html = C.chapterScreen(defaultSave());
    expect(html.match(/<button class="mission-node[ "]/g)?.length).toBe(MISSIONS.length);
    expect(html.match(/disabled/g)?.length).toBe(MISSIONS.length - 1);
    expect(html).toContain('Suite du chapitre à venir');
    expect(html.slice(html.indexOf('coming-soon'))).not.toMatch(/^[^]*?<button/);
    const s = defaultSave();
    applyMission(s, win(1));
    expect(C.chapterScreen(s).match(/disabled/g)?.length).toBe(MISSIONS.length - 2);
  });

  it('fiche de niveau : objectif, défi secondaire, récompenses, Lancer ; relecture seulement des scènes vues', () => {
    const s = defaultSave();
    const html = C.missionScreen(s, 1);
    expect(html).toContain(MISSIONS[0].objectiveText);
    expect(html).toContain(MISSIONS[0].challenge.text);
    expect(html).toContain('+30');
    expect(html).toContain('data-action="play-mission"');
    expect(html).not.toContain('Revoir l’introduction');
    s.campaign.seen.push('n1-before', 'n1-after');
    const seen = C.missionScreen(s, 1);
    expect(seen).toContain('Revoir l’introduction');
    expect(seen).toContain('Revoir la conclusion');
    expect(C.missionScreen(defaultSave(), 6)).not.toContain('play-mission');
  });

  it('journal : seules les scènes découvertes sont listées', () => {
    const s = defaultSave();
    expect(C.journalScreen(s)).toContain('Aucune scène');
    s.campaign.seen.push(STORY[0].id);
    const html = C.journalScreen(s);
    expect(html).toContain(STORY[0].title);
    expect(html).not.toContain(STORY[1].title);
    expect(html).toContain(`${STORY.length - 1} scènes encore à découvrir`);
  });

  it('récit : illustration au-dessus, boîte de dialogue au-dessous, portrait du bon locuteur, passer la scène', () => {
    const seq = STORY.find((x) => x.id === 'n1-before')!;
    const first = C.storyScreen(seq, 0, 'Lancer le niveau');
    expect(first.indexOf('story__scene')).toBeLessThan(first.indexOf('story__box'));
    expect(first).toContain('data-action="story-advance"');
    expect(first).toContain('data-action="story-skip"');
    expect(first).toContain('Passer la scène');
    expect(first).toContain('story__name">Nora<');
    expect(first).toContain(seq.lines[0].text);
    expect(first).toContain('story__portrait');
    const second = C.storyScreen(seq, 1, 'Lancer le niveau');
    expect(second).toContain('story__name">Élias<');
    const last = C.storyScreen(seq, seq.lines.length - 1, 'Lancer le niveau');
    expect(last).toContain('Lancer le niveau');
  });

  it('récit : message système sans portrait ni locuteur humain, voix enregistrée anonyme', () => {
    const seq = STORY.find((x) => x.id === 'n5-after')!;
    const iSys = seq.lines.findIndex((l) => l.system);
    expect(iSys).toBeGreaterThan(-1);
    const sys = C.storyScreen(seq, iSys, 'Fermer');
    expect(sys).toContain('story__box--system');
    expect(sys).not.toContain('story__portrait');
    expect(sys).toContain('Système');
    const iVoice = seq.lines.findIndex((l) => l.who === 'transmission_inconnue');
    const voice = C.storyScreen(seq, iVoice, 'Fermer');
    expect(voice).toContain('Voix enregistrée');
    expect(voice.toLowerCase()).not.toContain(' ia');
  });

  it('bilan : étoiles et gains détaillés ; échec sans récompense', () => {
    const s = defaultSave();
    const res = applyMission(s, win(1, { challenge: true }));
    const html = C.campaignResultScreen(s, res, true);
    expect(html).toContain('Niveau réussi');
    expect(html).toContain('Première réussite');
    expect(html).toContain('Éclats de campagne gagnés');
    expect(html).toContain('data-action="next-mission"');
    expect(html).toContain('data-replay');
    const fail = applyMission(s, { ...win(2), outcome: 'failure', stars: { main: false, challenge: false } });
    const fh = C.campaignResultScreen(s, fail, false);
    expect(fh).toContain('Collision');
    expect(fh).not.toContain('gagnés');
    expect(fh).toContain('data-replay');
  });

  it('fin des dix niveaux : « Suite du chapitre à venir » et possibilité de rejouer, sans niveau suivant', () => {
    const s = defaultSave();
    for (let i = 1; i < 10; i++) applyMission(s, win(i));
    const last = applyMission(s, win(10));
    const html = C.campaignResultScreen(s, last, false);
    expect(html).toContain('Suite du chapitre à venir');
    expect(html).toContain('data-replay');
    expect(html).not.toContain('next-mission');
  });
});

describe('bilan : cas d’échec et fin de V1', () => {
  it('temps écoulé : pas de « Niveau réussi », pas de récompense, pas de « Suite du chapitre », rejouer possible', () => {
    const s = defaultSave();
    const res = applyMission(s, { ...win(3), outcome: 'timeout', stars: { main: false, challenge: false } });
    const html = C.campaignResultScreen(s, res, false);
    expect(html).toContain('Temps écoulé');
    expect(html).not.toContain('Niveau réussi');
    expect(html).not.toContain('gagnés');
    expect(html).not.toContain('Suite du chapitre');
    expect(html).toContain('data-replay');
  });

  it('niveaux 1 à 9 : jamais de « Suite du chapitre à venir » dans le bilan ; seulement après le niveau 10', () => {
    const s = defaultSave();
    for (let i = 1; i < 10; i++) {
      const r = applyMission(s, win(i));
      expect(C.campaignResultScreen(s, r, true), `niveau ${i}`).not.toContain('Suite du chapitre');
      expect(C.campaignResultScreen(s, r, true)).toContain('next-mission');
    }
    const last = applyMission(s, win(10));
    expect(C.campaignResultScreen(s, last, false)).toContain('Suite du chapitre à venir');
  });

  it('carte des niveaux et accueil : la suite est annoncée comme « à venir », sans bouton ni niveau fictif', () => {
    const s = defaultSave();
    for (const m of MISSIONS) applyMission(s, win(m.id));
    const map = C.chapterScreen(s);
    expect(map).toContain('Suite du chapitre à venir');
    expect(map.match(/class="mission-node[ "]/g)).toHaveLength(10);
    expect(C.campaignScreen(s)).toContain('À venir');
    expect(C.campaignScreen(s)).toContain('10/10 niveaux');
    // Aucune interface de hangar / amélioration proposée
    for (const html of [map, C.campaignScreen(s), C.missionScreen(s, 10), C.journalScreen(s)]) expect(html).not.toMatch(/hangar|Bouclier de secours|Collecteur|Stabilisateur/i);
  });

  it('récit : une illustration, une boîte, aucune image absente ; le jeton data-action pour toucher l’illustration et la boîte', () => {
    for (const seq of STORY) {
      const html = C.storyScreen(seq, 0, 'Suite');
      expect(html, seq.id).toContain('story__img');
      expect(html.match(/data-action="story-advance"/g)).toHaveLength(2);
      expect(html.match(/data-action="story-skip"/g)).toHaveLength(1);
    }
  });
});
