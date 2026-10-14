/**
 * Filtre de pseudos — « au mieux » : il bloque les insultes et les noms trompeurs évidents ; il ne remplace ni les signalements des joueurs
 * (POST /api/report) ni la modération par l'opérateur (server/admin.ts). Les faux positifs se corrigent en ajoutant un pseudo valide, jamais en le
 * contournant ; les listes peuvent être étendues par la variable d'environnement BLOCKED_WORDS (mots séparés par des virgules).
 */

/** Écarts de graphie courants (« l33t ») ramenés aux lettres. */
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };

/** Forme comparable : sans accents, minuscules, graphies « l33t » ramenées aux lettres, sans séparateurs et lettres répétées ramenées à une seule (« fuuuck » = « fuck »). */
export function fold(nickname: string): string {
  const base = nickname
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[01345 7@$!]/g, (c) => LEET[c] ?? c);
  return base.replace(/[^a-z0-9]/g, '').replace(/(.)\1+/g, '$1');
}

/** Mots interdits en sous-chaîne (assez longs pour éviter les faux positifs courants). */
const BLOCKED_CONTAINS = (['putain', 'connard', 'connasse', 'salope', 'salaud', 'encule', 'merde', 'fuck', 'nigger', 'nigga', 'hitler', 'pedophile', 'bitch', 'whore', 'cocksucker', 'enfoire']).map(fold);
/** Mots interdits seulement lorsqu'ils forment tout le pseudo (courts : « pute » est dans « computer »). */
const BLOCKED_EXACT = ['nazi', 'pute', 'shit', 'fag', 'cunt', 'pedo', 'nique', 'ntm', 'fdp', 'tg'].map(fold);
/** Noms trompeurs : se faire passer pour le jeu, le service ou l'équipe. */
const RESERVED = ['admin', 'administrateur', 'moderateur', 'modo', 'support', 'staff', 'officiel', 'official', 'polarrift', 'polarite', 'systeme', 'system', 'serveur', 'server', 'root', 'anonyme', 'joueur'].map(fold);

export type NicknameVerdict = { ok: true } | { ok: false; reason: 'blocked' | 'reserved' };

export function checkNickname(nickname: string, extraBlocked: readonly string[] = []): NicknameVerdict {
  const f = fold(nickname);
  if (RESERVED.includes(f)) return { ok: false, reason: 'reserved' };
  if (BLOCKED_EXACT.includes(f)) return { ok: false, reason: 'blocked' };
  for (const w of [...BLOCKED_CONTAINS, ...extraBlocked.map(fold).filter((x) => x.length >= 4)]) if (f.includes(w)) return { ok: false, reason: 'blocked' };
  return { ok: true };
}

/** Pseudo de remplacement attribué par l'opérateur à un pseudo masqué (stable, neutre, distinct). */
export function maskedNickname(playerId: string): string {
  return `Joueur-${playerId.replace(/-/g, '').slice(0, 6)}`;
}
