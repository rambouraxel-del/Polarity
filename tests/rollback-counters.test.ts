import { afterEach, describe, expect, it } from 'vitest';
import { INSTALL_KEY, ensureInstallId, newInstallId, useInstallStore } from '../src/economy/ids';
import { applySyncResult, buildSyncBody, pendingSummary } from '../src/economy/reconcile';
import type { SyncResponse } from '../src/net/accountProtocol';
import { MemoryStore, SAVE_KEY, defaultSave, loadSave } from '../src/save/save';

/**
 * Retour arrière du jeu : une ancienne version réécrit la sauvegarde SANS le bloc économie (identifiant d'installation, compteurs d'achats et d'usage
 * des bonus). Le nouveau jeu doit retrouver la même installation et ne jamais laisser ses compteurs monotones sous ceux du service.
 */
afterEach(() => useInstallStore(null));

const reply = (over: Partial<SyncResponse> = {}): SyncResponse => ({
  rev: 1,
  balance: { shards: 0, medals: 0, prisms: 0 },
  inventory: { boost: 0, gel: 0 },
  bonus: { boost: 0, gel: 0 },
  bonusRejected: { boost: 0, gel: 0 },
  claimed: [],
  rejectedClaims: [],
  watermark: 0,
  capped: false,
  acknowledged: [],
  rejected: [],
  save: defaultSave(),
  at: 0,
  ...over,
});

describe('identifiant d’installation : doublé hors de la sauvegarde', () => {
  it('une sauvegarde réécrite par une ancienne version (sans bloc économie) retrouve la MÊME installation', () => {
    const store = new MemoryStore();
    useInstallStore(store);
    const save = defaultSave();
    expect(ensureInstallId(save)).toBe(true);
    const id = save.economy.installId;
    expect(store.get(INSTALL_KEY)).toBe(id);
    // L'ancienne version réécrit la sauvegarde au format 6 : plus d'économie ni d'identifiant
    const old = JSON.parse(JSON.stringify(save)) as Record<string, unknown>;
    old.version = 6;
    delete old.economy;
    store.set(SAVE_KEY, JSON.stringify(old));
    const loaded = loadSave(store).data;
    expect(loaded.economy.installId).toBe('');
    expect(ensureInstallId(loaded)).toBe(true);
    expect(loaded.economy.installId).toBe(id);
  });

  it('sans clé : nouvelle installation créée et doublée ; clé illisible ignorée ; la sauvegarde fait foi si elle a un identifiant', () => {
    const store = new MemoryStore();
    useInstallStore(store);
    const a = defaultSave();
    ensureInstallId(a);
    expect(store.get(INSTALL_KEY)).toBe(a.economy.installId);
    store.set(INSTALL_KEY, '!!');
    const b = defaultSave();
    ensureInstallId(b);
    expect(b.economy.installId).not.toBe('!!');
    expect(store.get(INSTALL_KEY)).toBe(b.economy.installId);
    const c = defaultSave();
    c.economy.installId = newInstallId();
    expect(ensureInstallId(c)).toBe(false);
    expect(store.get(INSTALL_KEY)).toBe(c.economy.installId);
  });

  it('remise à zéro volontaire (clé effacée) : nouvelle installation', () => {
    const store = new MemoryStore();
    useInstallStore(store);
    const a = defaultSave();
    ensureInstallId(a);
    store.remove(INSTALL_KEY);
    const b = defaultSave();
    ensureInstallId(b);
    expect(b.economy.installId).not.toBe(a.economy.installId);
  });

  it('sans stockage injecté (tests, hors jeu) : comportement inchangé', () => {
    const a = defaultSave();
    expect(ensureInstallId(a)).toBe(true);
    expect(ensureInstallId(a)).toBe(false);
  });
});

describe('compteurs monotones de charges : jamais sous ceux du service', () => {
  it('compteurs locaux à zéro (sauvegarde réécrite) : relevés au niveau du service ; rien n’est redéclaré ni redemandé', () => {
    const save = defaultSave();
    save.economy.installId = newInstallId();
    const sent = structuredClone(save);
    applySyncResult(save, reply({ bonus: { boost: 5, gel: 1 }, used: { boost: 3, gel: 0 }, inventory: { boost: 2, gel: 1 } }), sent);
    expect(save.economy.bonusBought).toEqual({ boost: 5, gel: 1 });
    expect(save.economy.bonusUsed).toEqual({ boost: 3, gel: 0 });
    expect(save.economy.bonusProcessed).toEqual({ boost: 5, gel: 1 });
    expect(pendingSummary(save).charges).toBe(0);
    // Le prochain achat/usage part du bon total : le service le prendra en compte (écart > son compteur)
    expect(buildSyncBody(save).bonusUsed).toEqual({ boost: 3, gel: 0 });
    expect(buildSyncBody(save).bonusBought).toEqual({ boost: 5, gel: 1 });
  });

  it('compteurs locaux plus HAUTS que ceux du service (achats/usage en attente) : conservés ; ancien serveur sans « used » : sans effet', () => {
    const save = defaultSave();
    save.economy.installId = newInstallId();
    save.economy.bonusBought = { boost: 7, gel: 2 };
    save.economy.bonusUsed = { boost: 4, gel: 1 };
    applySyncResult(save, reply({ bonus: { boost: 5, gel: 1 }, used: { boost: 3, gel: 0 } }), structuredClone(save));
    expect(save.economy.bonusBought).toEqual({ boost: 7, gel: 2 });
    expect(save.economy.bonusUsed).toEqual({ boost: 4, gel: 1 });
    expect(pendingSummary(save).charges).toBe(3);
    const noUsed = reply({ bonus: { boost: 0, gel: 0 } });
    delete noUsed.used;
    applySyncResult(save, noUsed, structuredClone(save));
    expect(save.economy.bonusUsed).toEqual({ boost: 4, gel: 1 });
  });
});
