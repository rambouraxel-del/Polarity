import { createHash, randomBytes, randomInt } from 'node:crypto';
import { checkPurchase, entitledRewards, grantedBy, importRef, earnRef, PREMIUM_ITEMS, refillBucket, spendRef, SYNC_RULES } from '../src/economy/rules';
import { mergeSaves } from '../src/economy/merge';
import { CATALOG } from '../src/config/catalog';
import { WALLET_MAX } from '../src/config/economy';
import type {
  AuthResponse,
  ConflictResponse,
  EmailRequestResponse,
  IdentityInfo,
  NonceResponse,
  ProfileResponse,
  ProvidersResponse,
  ProviderId,
  PurchaseRejection,
  SyncResponse,
} from '../src/net/accountProtocol';
import { nicknameKey } from '../src/net/protocol';
import { parseSave, sanitize, type SaveData } from '../src/save/save';
import type { HttpRequest, HttpResponse, PlayerRow } from './app';
import { hashToken, newPlayerId, newToken, parseBearer } from './auth';
import { transaction, type Db } from './db';
import type { Mailer } from './mailer';
import { APPLE_ISSUERS, APPLE_JWKS, GOOGLE_ISSUERS, GOOGLE_JWKS, JwksCache, OidcError, defaultJwksFetcher, nonceMatches, verifyIdToken, type JwksFetcher, type OidcProvider } from './oidc';
import { balancesOf, guestNickname } from './profile';

/**
 * Comptes, connexions facultatives, migration des anciennes sauvegardes, synchronisation et fusion de profils (économie v3).
 * Modèle de confiance et décisions : docs/COMPTES.md et docs/ETAT_MAJ_ECONOMIE.md.
 *
 * Points clés :
 * - tout est IDEMPOTENT : les écritures du registre (`ledger`) portent une clé unique par profil ; rejouer une requête ne crée jamais de second crédit ;
 * - les Prismes ne sont JAMAIS crédités ici (aucun chemin du client n'y mène) ;
 * - une fusion exige la preuve du compte cible (jeton fournisseur vérifié, nonce à usage unique) ET l'authentification du profil invité à fusionner ;
 *   un profil qui possède déjà un compte n'est jamais fusionné automatiquement (collisions et prises de contrôle évitées) ;
 * - une méthode de connexion non configurée reste désactivée : aucune fausse connexion.
 */
export interface AccountsConfig {
  /** Identifiants clients OAuth Google acceptés comme audience (web, Android, iOS) ; `web` est exposé à l'interface du navigateur. Absent = désactivé. */
  google?: { audiences: string[]; web?: string };
  /** Identifiants clients Apple (identifiant de service web, identifiant d'application iOS). Absent = désactivé. */
  apple?: { audiences: string[]; web?: string };
  /** Service d'envoi de courriels (liens magiques). Absent = connexion par courriel désactivée. */
  mailer?: Mailer | null;
  /** Adresse publique du jeu (lien du courriel), ex. https://utilisateur.github.io/Polarity/ */
  appUrl?: string;
  /** Récupération des clés publiques des fournisseurs (injectable pour les tests). */
  jwksFetcher?: JwksFetcher;
}

export interface AccountsDeps {
  db: Db;
  now: () => number;
  allow: (key: string, max: number, windowMs: number) => boolean;
  /** Joueur authentifié (profil effectif), ou null si l'en-tête est absent ou invalide. */
  authenticate: (req: HttpRequest) => PlayerRow | null;
  cfg: AccountsConfig;
}

const json = (status: number, body: unknown): HttpResponse => ({ status, body });
const err = (status: number, error: string, message: string): HttpResponse => json(status, { error, message });
const HOUR = 3_600_000;
const NONCE_TTL_S = 600;
const MAIL_TTL_S = 900;
const MAIL_ATTEMPTS = 5;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Plafond d'un solde hérité : 2 000 000 Éclats (≈ 2 mois de jeu continu : au-delà, valeur aberrante, ramenée à ce plafond et signalée dans le registre). */
export const LEGACY_SHARDS_CAP = 2_000_000;

const emailValid = (e: string): boolean => e.length >= 5 && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
export const maskEmail = (e: string): string => {
  const [local, domain] = e.split('@');
  return domain ? `${local.slice(0, 1)}***@${domain}` : '';
};
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const isInstallId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Routes qui attendent le réseau : servies par `app.async`. */
export const ASYNC_ROUTES: ReadonlySet<string> = new Set(['POST /api/auth/google', 'POST /api/auth/apple', 'POST /api/auth/email/request']);

export interface Accounts {
  /** Routes synchrones (null si la route n'est pas gérée ici). */
  handle(req: HttpRequest): HttpResponse | null;
  /** Routes qui attendent le réseau (clés des fournisseurs, courriel) : une promesse, ou null. */
  handleAsync(req: HttpRequest): Promise<HttpResponse> | null;
}

export function createAccounts(deps: AccountsDeps): Accounts {
  const { db, now, allow, authenticate, cfg } = deps;
  const jwks = new JwksCache(cfg.jwksFetcher ?? defaultJwksFetcher, now);
  const providers: Record<'google' | 'apple', OidcProvider | null> = {
    google: cfg.google && cfg.google.audiences.length > 0 ? { name: 'google', issuers: GOOGLE_ISSUERS, jwksUri: GOOGLE_JWKS, audiences: cfg.google.audiences } : null,
    apple: cfg.apple && cfg.apple.audiences.length > 0 ? { name: 'apple', issuers: APPLE_ISSUERS, jwksUri: APPLE_JWKS, audiences: cfg.apple.audiences } : null,
  };

  const q = {
    player: db.prepare('SELECT id, nickname, token_hash, moderation, guest, merged_into FROM players WHERE id = ?'),
    insertPlayer: db.prepare('INSERT INTO players (id, nickname, nickname_key, token_hash, created_at, guest) VALUES (?, ?, ?, ?, ?, ?)'),
    identity: db.prepare('SELECT id, player_id, provider, subject, email FROM identities WHERE provider = ? AND subject = ?'),
    identitiesOf: db.prepare('SELECT provider, email FROM identities WHERE player_id = ? ORDER BY id'),
    insertIdentity: db.prepare('INSERT INTO identities (player_id, provider, subject, email, created_at) VALUES (?, ?, ?, ?, ?)'),
    delIdentity: db.prepare('DELETE FROM identities WHERE player_id = ? AND provider = ?'),
    insertSession: db.prepare('INSERT INTO sessions (id, player_id, token_hash, label, created_at) VALUES (?, ?, ?, ?, ?)'),
    revokeSession: db.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL'),
    insertNonce: db.prepare('INSERT INTO auth_nonces (nonce, created_at, expires_at) VALUES (?, ?, ?)'),
    nonce: db.prepare('SELECT used_at, expires_at FROM auth_nonces WHERE nonce = ?'),
    useNonce: db.prepare('UPDATE auth_nonces SET used_at = ? WHERE nonce = ? AND used_at IS NULL AND expires_at > ?'),
    purgeNonces: db.prepare('DELETE FROM auth_nonces WHERE expires_at < ?'),
    insertLogin: db.prepare('INSERT INTO login_requests (id, email, email_hash, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'),
    loginRequest: db.prepare('SELECT id, email, code_hash, attempts, expires_at, consumed_at FROM login_requests WHERE id = ?'),
    bumpAttempts: db.prepare('UPDATE login_requests SET attempts = attempts + 1 WHERE id = ? AND consumed_at IS NULL AND expires_at > ? AND attempts < ?'),
    consumeLogin: db.prepare('UPDATE login_requests SET consumed_at = ?, email = NULL WHERE id = ? AND consumed_at IS NULL'),
    recentLogins: db.prepare('SELECT COUNT(*) AS n FROM login_requests WHERE email_hash = ? AND created_at > ?'),
    purgeLogins: db.prepare('DELETE FROM login_requests WHERE created_at < ?'),
    save: db.prepare('SELECT rev, data FROM saves WHERE player_id = ?'),
    upsertSave: db.prepare('INSERT INTO saves (player_id, rev, data, updated_at, device) VALUES (?, ?, ?, ?, ?) ON CONFLICT(player_id) DO UPDATE SET rev = excluded.rev, data = excluded.data, updated_at = excluded.updated_at, device = excluded.device'),
    delSave: db.prepare('DELETE FROM saves WHERE player_id = ?'),
    install: db.prepare('SELECT install_id, player_id, earned, bucket, legacy_imported, last_sync FROM installs WHERE install_id = ?'),
    insertInstall: db.prepare('INSERT INTO installs (install_id, player_id, earned, bucket, legacy_imported, first_seen, last_sync) VALUES (?, ?, 0, ?, 0, ?, ?)'),
    updateInstall: db.prepare('UPDATE installs SET earned = ?, bucket = ?, legacy_imported = ?, last_sync = ? WHERE install_id = ?'),
    legacyCount: db.prepare('SELECT COUNT(*) AS n FROM installs WHERE player_id = ? AND legacy_imported = 1'),
    ledgerInsert: db.prepare('INSERT OR IGNORE INTO ledger (player_id, currency, kind, amount, ref, at, meta) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    ledgerHas: db.prepare('SELECT amount FROM ledger WHERE player_id = ? AND ref = ?'),
  };

  // ————————————————————————— profils, accès

  const identitiesOf = (playerId: string): IdentityInfo[] =>
    (q.identitiesOf.all(playerId) as unknown as { provider: ProviderId; email: string | null }[]).map((r) => ({ provider: r.provider, label: r.email ? maskEmail(r.email) : '' }));

  const authBody = (p: { id: string; nickname: string; guest: number }, extra: Partial<AuthResponse> = {}): AuthResponse => ({
    playerId: p.id,
    nickname: p.nickname,
    guest: p.guest === 1,
    identities: identitiesOf(p.id),
    ...extra,
  });

  /** Nouvel accès (un secret propre à l'appareil) pour un profil existant. Le secret n'est renvoyé qu'une fois ; seule son empreinte est conservée. */
  function newSession(playerId: string, label: string): string {
    const token = newToken();
    q.insertSession.run(randomBytes(12).toString('hex'), playerId, hashToken(token), label.slice(0, 40), now());
    return token;
  }

  /** Crée un profil invité (pseudo « Joueur-xxxxxx », absent du classement public). Renvoie l'identifiant et son secret. */
  function createGuest(): { id: string; token: string; nickname: string } {
    const id = newPlayerId();
    const token = newToken();
    for (let attempt = 0; attempt < 4; attempt++) {
      const nick = guestNickname(id, attempt);
      try {
        q.insertPlayer.run(id, nick, nicknameKey(nick), hashToken(token), now(), 1);
        return { id, token, nickname: nick };
      } catch (e) {
        if (!(e instanceof Error && /UNIQUE/i.test(e.message))) throw e;
      }
    }
    throw new Error('pseudo invité indisponible');
  }

  const row = (id: string): PlayerRow & { guest: number; merged_into: string | null } => q.player.get(id) as unknown as PlayerRow & { guest: number; merged_into: string | null };

  // ————————————————————————— fusion de deux profils

  /**
   * Fusionne le profil `from` (invité de cet appareil, sans compte) DANS `into` (compte retrouvé). À appeler dans une transaction.
   * Rien n'est perdu et rien n'est compté deux fois : records = le meilleur (vérifié par rejeu), registre dédupliqué par clé, sauvegardes fusionnées
   * (union / meilleur / maximum), installations et accès transférés ; `from` devient un alias (ses anciens accès continuent de fonctionner).
   */
  function mergeProfiles(fromId: string, intoId: string): Record<string, number | string> {
    const from = row(fromId);
    const into = row(intoId);
    const summary: Record<string, number | string> = {};
    // Pseudo : le compte garde le sien ; un profil invité reprend le pseudo choisi du profil fusionné
    const fromKey = (db.prepare('SELECT nickname_key AS k FROM players WHERE id = ?').get(fromId) as unknown as { k: string }).k;
    db.prepare("UPDATE players SET nickname_key = ?, nickname = ?, merged_into = ? WHERE id = ?").run(`fusionne:${fromId}`, `Fusionné-${fromId.slice(0, 6)}`, intoId, fromId);
    if (from.guest === 0 && into.guest === 1) {
      db.prepare('UPDATE players SET nickname = ?, nickname_key = ?, guest = 0 WHERE id = ?').run(from.nickname, fromKey, intoId);
      summary.nickname = 'repris';
    }
    if (from.moderation > into.moderation) db.prepare('UPDATE players SET moderation = ? WHERE id = ?').run(from.moderation, intoId);

    // Records vérifiés (rejeu serveur) : le meilleur par version d'équilibrage
    const bests = db.prepare('SELECT balance, steps, score, run_id, achieved_at FROM bests WHERE player_id = ?').all(fromId) as unknown as { balance: number; steps: number; score: number; run_id: number; achieved_at: number }[];
    for (const b of bests) {
      const cur = db.prepare('SELECT steps, score, achieved_at FROM bests WHERE player_id = ? AND balance = ?').get(intoId, b.balance) as unknown as { steps: number; score: number; achieved_at: number } | undefined;
      const better = !cur || b.steps > cur.steps || (b.steps === cur.steps && (b.score > cur.score || (b.score === cur.score && b.achieved_at < cur.achieved_at)));
      if (better) {
        db.prepare('INSERT INTO bests (player_id, balance, steps, score, run_id, achieved_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(player_id, balance) DO UPDATE SET steps = excluded.steps, score = excluded.score, run_id = excluded.run_id, achieved_at = excluded.achieved_at').run(intoId, b.balance, b.steps, b.score, b.run_id, b.achieved_at);
      }
    }
    db.prepare('DELETE FROM bests WHERE player_id = ?').run(fromId);
    summary.runs = Number(db.prepare('UPDATE runs SET player_id = ? WHERE player_id = ?').run(intoId, fromId).changes);
    // Tickets : la signature est liée au joueur ; les tickets non utilisés de l'ancien profil deviennent inutilisables (supprimés), les autres restent en historique
    db.prepare('DELETE FROM tickets WHERE player_id = ? AND used_at IS NULL').run(fromId);
    db.prepare('UPDATE tickets SET player_id = ? WHERE player_id = ?').run(intoId, fromId);
    db.prepare('UPDATE OR IGNORE reports SET reporter_id = ? WHERE reporter_id = ?').run(intoId, fromId);
    db.prepare('UPDATE OR IGNORE reports SET target_id = ? WHERE target_id = ?').run(intoId, fromId);
    db.prepare('DELETE FROM reports WHERE reporter_id = ? OR target_id = ?').run(fromId, fromId);
    summary.sessions = Number(db.prepare('UPDATE sessions SET player_id = ? WHERE player_id = ?').run(intoId, fromId).changes);
    summary.installs = Number(db.prepare('UPDATE installs SET player_id = ? WHERE player_id = ?').run(intoId, fromId).changes);

    // Registre : déduplication PAR CLÉ. Récompenses / marqueurs : on garde le plus PETIT montant (un marqueur à 0 « déjà couvert par un import » l'emporte
    // sur un crédit) ; dépenses : le plus petit débit. Jamais de double crédit.
    const entries = db.prepare('SELECT id, currency, kind, amount, ref, at, meta FROM ledger WHERE player_id = ?').all(fromId) as unknown as { id: number; currency: string; kind: string; amount: number; ref: string; at: number; meta: string | null }[];
    let moved = 0;
    let dropped = 0;
    for (const e of entries) {
      const cur = db.prepare('SELECT id, amount FROM ledger WHERE player_id = ? AND ref = ?').get(intoId, e.ref) as unknown as { id: number; amount: number } | undefined;
      if (!cur) {
        db.prepare('UPDATE ledger SET player_id = ? WHERE id = ?').run(intoId, e.id);
        moved++;
        continue;
      }
      const spend = e.ref.startsWith('spend:');
      const keepFrom = spend ? e.amount > cur.amount : e.amount < cur.amount;
      if (keepFrom) {
        db.prepare('DELETE FROM ledger WHERE id = ?').run(cur.id);
        db.prepare('UPDATE ledger SET player_id = ? WHERE id = ?').run(intoId, e.id);
        moved++;
      } else {
        db.prepare('DELETE FROM ledger WHERE id = ?').run(e.id);
        dropped++;
      }
    }
    summary.ledgerMoved = moved;
    summary.ledgerDeduplicated = dropped;

    // Sauvegardes : union / meilleur / maximum
    const a = readSnapshot(intoId);
    const b = readSnapshot(fromId);
    const merged = mergeSaves(a.save, b.save);
    writeSnapshot(intoId, merged, a.rev + 1, 'fusion');
    q.delSave.run(fromId);
    db.prepare('INSERT INTO merges (from_player, into_player, at, summary) VALUES (?, ?, ?, ?)').run(fromId, intoId, now(), JSON.stringify(summary));
    return summary;
  }

  // ————————————————————————— sauvegarde conservée par le serveur

  function readSnapshot(playerId: string): { rev: number; save: SaveData } {
    const r = q.save.get(playerId) as unknown as { rev: number; data: string } | undefined;
    if (!r) return { rev: 0, save: sanitize({}) };
    return { rev: r.rev, save: parseSave(r.data) ?? sanitize({}) };
  }

  function writeSnapshot(playerId: string, save: SaveData, rev: number, device: string): void {
    // Le serveur ne conserve ni les options (propres à l'appareil), ni le portefeuille (le registre fait foi) ni le bloc de comptabilité locale
    const stored = structuredClone(save);
    stored.wallet = { shards: 0, prisms: 0 };
    stored.rewardNotice = null;
    stored.economy = sanitize({}).economy;
    q.upsertSave.run(playerId, rev, JSON.stringify(stored), now(), device.slice(0, 40));
  }

  // ————————————————————————— connexion (commune à Google, Apple et au lien magique)

  function completeLogin(req: HttpRequest, ident: { provider: ProviderId; subject: string; email?: string }, merge: boolean): HttpResponse {
    const caller = authenticate(req);
    if (req.headers.authorization && !caller) return err(401, 'unauthorized', 'Authentification requise.');
    const existing = q.identity.get(ident.provider, ident.subject) as unknown as { player_id: string } | undefined;
    const label = String(req.headers['user-agent'] ?? 'appareil').slice(0, 40);

    if (!existing) {
      if (caller) {
        // Association d'une nouvelle méthode au profil de cet appareil (un seul compte par fournisseur et par profil)
        const mine = identitiesOf(caller.id);
        if (mine.some((i) => i.provider === ident.provider)) return err(409, 'provider_already_linked', 'Une autre adresse de ce type est déjà associée à ce profil.');
        q.insertIdentity.run(caller.id, ident.provider, ident.subject, ident.email ?? null, now());
        const p = row(caller.id);
        return json(200, authBody(p));
      }
      // Aucun profil sur cet appareil : nouveau profil rattaché à cette méthode
      const g = createGuest();
      q.insertIdentity.run(g.id, ident.provider, ident.subject, ident.email ?? null, now());
      return json(201, authBody({ id: g.id, nickname: g.nickname, guest: 1 }, { token: g.token, created: true }));
    }

    const target = row(existing.player_id);
    if (!caller) {
      // Connexion sur un nouvel appareil : accès propre à l'appareil pour le compte retrouvé
      const token = newSession(target.id, label);
      return json(200, authBody(target, { token }));
    }
    if (caller.id === target.id) return json(200, authBody(target));

    // Le profil de cet appareil et le compte retrouvé sont différents : fusion SEULEMENT si le profil de cet appareil n'a aucune méthode de connexion
    const callerHasAccount = identitiesOf(caller.id).length > 0;
    if (!merge) {
      const conflict: ConflictResponse = {
        error: 'identity_conflict',
        message: `Ce compte existe déjà (pseudo « ${target.nickname} »). Vous pouvez fusionner la progression de cet appareil dans ce compte.`,
        targetNickname: target.nickname,
        canMerge: !callerHasAccount,
      };
      return json(409, conflict);
    }
    if (callerHasAccount) return err(403, 'merge_not_allowed', 'Ce profil possède déjà un compte : la fusion de deux comptes n’est pas disponible. Déconnectez-vous ou contactez le support.');
    mergeProfiles(caller.id, target.id);
    const token = newSession(target.id, label);
    return json(200, authBody(row(target.id), { token, merged: true }));
  }

  // ————————————————————————— routes : jetons Google / Apple

  async function oidcRoute(req: HttpRequest, name: 'google' | 'apple'): Promise<HttpResponse> {
    const provider = providers[name];
    if (!provider) return err(503, 'provider_disabled', 'Cette méthode de connexion n’est pas configurée sur le service.');
    if (!allow(`auth:${req.ip}`, 30, HOUR)) return err(429, 'rate_limited', 'Trop de requêtes : réessayez plus tard.');
    const body = req.body as { idToken?: unknown; nonce?: unknown; merge?: unknown } | undefined;
    if (typeof body?.idToken !== 'string' || typeof body.nonce !== 'string' || body.nonce.length < 16 || body.nonce.length > 128) return err(400, 'bad_request', 'Requête invalide.');
    // Nonce : délivré par le service, valable une fois (contrôle rapide avant la vérification de signature)
    const n = q.nonce.get(body.nonce) as unknown as { used_at: number | null; expires_at: number } | undefined;
    if (!n || n.used_at !== null || n.expires_at * 1000 < now()) return err(400, 'bad_nonce', 'Demande de connexion expirée : recommencez.');
    let v;
    try {
      v = await verifyIdToken(body.idToken, provider, { now, jwks });
    } catch (e) {
      if (e instanceof OidcError && e.code === 'jwks_unavailable') return err(503, 'provider_unavailable', 'Le fournisseur de connexion est momentanément injoignable.');
      return err(401, 'bad_token', 'Jeton de connexion refusé.');
    }
    if (!nonceMatches(v.nonce, body.nonce)) return err(401, 'bad_token', 'Jeton de connexion refusé.');
    return transaction(db, () => {
      const res = completeLogin(req, { provider: name, subject: v.sub, email: v.email }, body.merge === true);
      // Le nonce n'est consommé que si la connexion a abouti (un conflit à confirmer peut être relancé avec le même jeton)
      if (res.status < 300 && q.useNonce.run(now(), body.nonce as string, now()).changes !== 1) throw new ReplayError();
      return res;
    });
  }

  // ————————————————————————— routes : lien magique par courriel

  async function emailRequest(req: HttpRequest): Promise<HttpResponse> {
    if (!cfg.mailer) return err(503, 'provider_disabled', 'La connexion par courriel n’est pas configurée sur le service.');
    if (!allow(`mail:${req.ip}`, 10, HOUR)) return err(429, 'rate_limited', 'Trop de requêtes : réessayez plus tard.');
    const raw = (req.body as { email?: unknown } | undefined)?.email;
    const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    const requestId = randomBytes(16).toString('hex');
    const reply = (): HttpResponse => json(202, { requestId, expiresIn: MAIL_TTL_S } satisfies EmailRequestResponse);
    // Adresse invalide : même réponse qu'une adresse valide (aucune information)
    if (!emailValid(email)) return reply();
    q.purgeLogins.run(now() - 24 * HOUR);
    if ((q.recentLogins.get(sha(email), now() - HOUR) as unknown as { n: number }).n >= 3) return err(429, 'rate_limited', 'Trop de demandes pour cette adresse : réessayez dans une heure.');
    const code = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    q.insertLogin.run(requestId, email, sha(email), sha(`${requestId}:${code}`), now(), now() + MAIL_TTL_S * 1000);
    const link = cfg.appUrl ? `${cfg.appUrl.replace(/\/+$/, '')}/?magic=${requestId}.${code}` : '';
    try {
      await cfg.mailer.send({
        to: email,
        subject: 'Votre code de connexion Polar Rift',
        text: `Votre code de connexion : ${code.slice(0, 4)}-${code.slice(4)}\n\nSaisissez-le dans le jeu (valable 15 minutes, utilisable une seule fois).${link ? `\nOu ouvrez ce lien :\n${link}\n` : ''}\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message : rien ne se passera.`,
      });
    } catch (e) {
      console.error('Envoi du courriel de connexion impossible :', e instanceof Error ? e.message : e);
      return err(503, 'mail_unavailable', 'Le message n’a pas pu être envoyé : réessayez plus tard.');
    }
    return reply();
  }

  function emailVerify(req: HttpRequest): HttpResponse {
    if (!cfg.mailer) return err(503, 'provider_disabled', 'La connexion par courriel n’est pas configurée sur le service.');
    if (!allow(`auth:${req.ip}`, 30, HOUR)) return err(429, 'rate_limited', 'Trop de requêtes : réessayez plus tard.');
    const body = req.body as { requestId?: unknown; code?: unknown; merge?: unknown } | undefined;
    if (typeof body?.requestId !== 'string' || !/^[0-9a-f]{32}$/.test(body.requestId) || typeof body.code !== 'string') return err(400, 'bad_request', 'Requête invalide.');
    const code = body.code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return transaction(db, () => {
      // Chaque essai est compté AVANT la comparaison (au plus 5 essais par demande, même en cas d'erreur)
      if (q.bumpAttempts.run(body.requestId as string, now(), MAIL_ATTEMPTS).changes !== 1) return err(400, 'bad_code', 'Code expiré ou trop d’essais : demandez un nouveau code.');
      const r = q.loginRequest.get(body.requestId as string) as unknown as { email: string | null; code_hash: string } | undefined;
      if (!r || !r.email || r.code_hash !== sha(`${body.requestId}:${code}`)) return err(400, 'bad_code', 'Code incorrect.');
      const res = completeLogin(req, { provider: 'email', subject: r.email, email: r.email }, body.merge === true);
      if (res.status < 300) q.consumeLogin.run(now(), body.requestId as string);
      return res;
    });
  }

  // ————————————————————————— routes : nonce, fournisseurs, profil, déconnexion

  function providersRoute(): HttpResponse {
    const res: ProvidersResponse = {
      google: { enabled: !!providers.google, ...(cfg.google?.web && providers.google ? { clientId: cfg.google.web } : {}) },
      apple: { enabled: !!providers.apple, ...(cfg.apple?.web && providers.apple ? { clientId: cfg.apple.web } : {}) },
      email: { enabled: !!cfg.mailer },
    };
    return json(200, res);
  }

  function nonceRoute(req: HttpRequest): HttpResponse {
    if (!allow(`nonce:${req.ip}`, 60, HOUR)) return err(429, 'rate_limited', 'Trop de requêtes : réessayez plus tard.');
    q.purgeNonces.run(Math.floor(now() / 1000) - 3600);
    const nonce = randomBytes(24).toString('base64url');
    q.insertNonce.run(nonce, Math.floor(now() / 1000), Math.floor(now() / 1000) + NONCE_TTL_S);
    return json(200, { nonce, expiresIn: NONCE_TTL_S } satisfies NonceResponse);
  }

  function profileRoute(me: PlayerRow): HttpResponse {
    const p = row(me.id);
    const ids = identitiesOf(me.id);
    const res: ProfileResponse = { playerId: p.id, nickname: p.nickname, guest: p.guest === 1, identities: ids, canBuyPremium: ids.length > 0, balance: balancesOf(db, p.id) };
    return json(200, res);
  }

  function logout(req: HttpRequest): HttpResponse {
    const b = parseBearer(req.headers.authorization);
    const revoked = b ? Number(q.revokeSession.run(now(), hashToken(b.token)).changes) > 0 : false;
    return json(200, { ok: true, revoked });
  }

  function unlink(req: HttpRequest, me: PlayerRow): HttpResponse {
    const provider = (req.body as { provider?: unknown } | undefined)?.provider;
    if (provider !== 'google' && provider !== 'apple' && provider !== 'email') return err(400, 'bad_request', 'Fournisseur invalide.');
    const ids = identitiesOf(me.id);
    if (!ids.some((i) => i.provider === provider)) return err(404, 'not_found', 'Cette méthode n’est pas associée à votre profil.');
    // Le compte garde toujours au moins une méthode de connexion (aucun verrouillage) : pour revenir en invité, supprimez le profil
    if (ids.length < 2) return err(409, 'last_identity', 'C’est votre seule méthode de connexion : ajoutez-en une autre avant de la retirer.');
    q.delIdentity.run(me.id, provider);
    return json(200, { ok: true, identities: identitiesOf(me.id) });
  }

  // ————————————————————————— migration et synchronisation

  const ledger = (playerId: string, kind: string, amount: number, ref: string, meta?: Record<string, unknown>): boolean =>
    Number(q.ledgerInsert.run(playerId, 'shards', kind, amount, ref, now(), meta ? JSON.stringify(meta) : null).changes) === 1;

  /** Installation connue : créée au premier contact ; appartient à UN profil (jamais partagée). */
  function installOf(installId: string, playerId: string): { earned: number; bucket: number; legacyImported: boolean; lastSync: number } | null {
    const r = q.install.get(installId) as unknown as { player_id: string; earned: number; bucket: number; legacy_imported: number; last_sync: number } | undefined;
    if (!r) {
      // Première rencontre : seau plein (rafale acceptée une fois)
      q.insertInstall.run(installId, playerId, SYNC_RULES.earnBucketCap, now(), now());
      return { earned: 0, bucket: SYNC_RULES.earnBucketCap, legacyImported: false, lastSync: now() };
    }
    if (r.player_id !== playerId) return null;
    return { earned: r.earned, bucket: r.bucket, legacyImported: r.legacy_imported === 1, lastSync: r.last_sync };
  }

  function respond(playerId: string, rev: number, save: SaveData, extra: Partial<SyncResponse> & { watermark: number }): HttpResponse {
    const bal = balancesOf(db, playerId);
    const out = structuredClone(save);
    out.wallet = { shards: bal.shards, prisms: bal.prisms };
    out.economy = sanitize({}).economy;
    return json(200, { rev, balance: bal, capped: false, acknowledged: [], rejected: [], save: out, at: now(), ...extra } satisfies SyncResponse);
  }

  /** Récompenses uniques auxquelles la sauvegarde donne droit : une seule ligne par clé et par profil. Renvoie le total nouvellement crédité. */
  function creditEntitled(playerId: string, save: SaveData): number {
    let total = 0;
    for (const r of entitledRewards(save)) if (ledger(playerId, 'reward', r.amount, r.ref)) total += r.amount;
    return total;
  }

  /**
   * MIGRATION EXCEPTIONNELLE d'une ancienne sauvegarde (formats ≤ 6) : acceptée INTÉGRALEMENT (Éclats, succès, cosmétiques, statistiques, records locaux),
   * une seule fois par installation (idempotent), au plus `maxLegacyImports` installations par profil. Prismes JAMAIS importés ; articles premium refusés.
   * Risque documenté : la sauvegarde locale peut avoir été modifiée à la main ; cette politique ne s'applique PAS aux nouvelles transactions.
   */
  function migrate(req: HttpRequest, me: PlayerRow): HttpResponse {
    if (!allow(`migrate:${me.id}`, 10, HOUR)) return err(429, 'rate_limited', 'Trop de requêtes : réessayez plus tard.');
    const body = req.body as { installId?: unknown; save?: unknown } | undefined;
    if (!isInstallId(body?.installId) || !isRecord(body?.save)) return err(400, 'bad_request', 'Requête invalide.');
    const text = JSON.stringify(body.save);
    if (text.length > SYNC_RULES.maxSaveBytes) return err(413, 'too_large', 'Sauvegarde trop volumineuse.');
    const incoming = parseSave(text);
    if (!incoming) return err(400, 'bad_save', 'Sauvegarde illisible ou d’une version plus récente.');
    const installId = body.installId;
    return transaction(db, () => {
      const inst = installOf(installId, me.id);
      if (!inst) return err(409, 'install_conflict', 'Cette installation appartient à un autre profil.');
      const cur = readSnapshot(me.id);
      if (inst.legacyImported) return respond(me.id, cur.rev, cur.save, { watermark: inst.earned, legacy: 'already' });
      const legacy = incoming.economy.legacy;
      if (!legacy || legacy.imported) return respond(me.id, cur.rev, cur.save, { watermark: inst.earned, legacy: 'none' });
      if (Number((q.legacyCount.get(me.id) as unknown as { n: number }).n) >= SYNC_RULES.maxLegacyImports) return respond(me.id, cur.rev, cur.save, { watermark: inst.earned, legacy: 'limit' });
      const shards = Math.min(legacy.shards, LEGACY_SHARDS_CAP, WALLET_MAX);
      ledger(me.id, 'import', shards, importRef(installId), { claimed: legacy.shards, capped: shards < legacy.shards, version: incoming.version });
      // Les récompenses uniques que l'import couvre déjà sont marquées à 0 : elles ne seront jamais re-créditées (aucun double crédit)
      for (const r of entitledRewards(incoming)) ledger(me.id, 'reward_covered', 0, r.ref);
      // Cosmétiques : tout ce que contient l'ancienne sauvegarde, sauf l'article premium (Prismes) et les identifiants inconnus
      const known = new Set(CATALOG.map((i) => i.id));
      incoming.owned = incoming.owned.filter((id) => known.has(id) && !PREMIUM_ITEMS.has(id));
      const merged = mergeSaves(cur.save, incoming);
      const rev = cur.rev + 1;
      writeSnapshot(me.id, merged, rev, 'migration');
      q.updateInstall.run(inst.earned, refillBucket(inst.bucket, now() - inst.lastSync), 1, now(), installId);
      return respond(me.id, rev, merged, { watermark: inst.earned, legacy: 'imported' });
    });
  }

  /**
   * SYNCHRONISATION : gains répétables (écart du compteur monotone, borné par un plafond horaire), récompenses uniques (clés fixes), achats vérifiés
   * (catalogue, prix, solde), puis fusion de la progression. Idempotente : rejouer la même requête ne change rien. Le serveur répond avec sa vérité.
   */
  function sync(req: HttpRequest, me: PlayerRow): HttpResponse {
    if (!allow(`sync:${me.id}`, 120, HOUR)) return err(429, 'rate_limited', 'Trop de requêtes : réessayez plus tard.');
    const body = req.body as { installId?: unknown; earned?: unknown; purchases?: unknown; save?: unknown } | undefined;
    if (!isInstallId(body?.installId) || !isRecord(body?.save) || typeof body.earned !== 'number' || !Number.isInteger(body.earned) || body.earned < 0 || body.earned > 1e12) return err(400, 'bad_request', 'Requête invalide.');
    const text = JSON.stringify(body.save);
    if (text.length > SYNC_RULES.maxSaveBytes) return err(413, 'too_large', 'Sauvegarde trop volumineuse.');
    const incoming = parseSave(text);
    if (!incoming) return err(400, 'bad_save', 'Sauvegarde illisible ou d’une version plus récente.');
    const purchases: [string, number][] = isRecord(body.purchases) ? Object.entries(body.purchases).filter((e): e is [string, number] => typeof e[1] === 'number').slice(0, SYNC_RULES.maxPurchasesPerSync) : [];
    const installId = body.installId;
    const earned = body.earned;

    return transaction(db, () => {
      const inst = installOf(installId, me.id);
      if (!inst) return err(409, 'install_conflict', 'Cette installation appartient à un autre profil.');
      const cur = readSnapshot(me.id);

      // 1. Gains répétables : écart borné par le plafond horaire ; clé = filigrane atteint (idempotent)
      let watermark = inst.earned;
      let capped = false;
      let bucket = refillBucket(inst.bucket, now() - inst.lastSync);
      if (earned > watermark) {
        const delta = Math.min(earned - watermark, bucket);
        capped = earned - watermark > bucket;
        if (delta > 0) {
          watermark += delta;
          bucket -= delta;
          ledger(me.id, 'earn', delta, earnRef(installId, watermark), { claimed: earned });
        }
      }
      // 2. Récompenses uniques (succès, niveaux) : montants de la configuration, une fois par profil
      creditEntitled(me.id, incoming);

      // 3. Achats : article du catalogue, prix valable, solde suffisant ; déjà possédé = jamais débité
      const owned = new Set(cur.save.owned);
      const acknowledged: SyncResponse['acknowledged'] = [];
      const rejected: SyncResponse['rejected'] = [];
      for (const [itemId, paid] of purchases) {
        const check = checkPurchase(itemId, paid);
        if (!check.ok) {
          rejected.push({ item: itemId, reason: check.reason as PurchaseRejection });
          continue;
        }
        const granted = grantedBy(check.item);
        const prior = q.ledgerHas.get(me.id, spendRef(itemId)) as unknown as { amount: number } | undefined;
        if (prior || granted.every((g) => owned.has(g))) {
          acknowledged.push({ item: itemId, charged: !!prior });
          for (const g of granted) owned.add(g);
          continue;
        }
        if (balancesOf(db, me.id).shards < paid) {
          rejected.push({ item: itemId, reason: 'insufficient' });
          continue;
        }
        ledger(me.id, 'spend', -paid, spendRef(itemId), { granted });
        for (const g of granted) owned.add(g);
        acknowledged.push({ item: itemId, charged: true });
      }

      // 4. Progression : jamais d'article possédé que le serveur n'a pas vérifié (importé, déjà possédé ou acheté ci-dessus)
      incoming.owned = incoming.owned.filter((id) => owned.has(id));
      const merged = mergeSaves(cur.save, incoming);
      merged.owned = [...new Set([...merged.owned, ...owned])];
      const changed = JSON.stringify(merged) !== JSON.stringify(cur.save);
      const rev = changed ? cur.rev + 1 : cur.rev;
      if (changed || cur.rev === 0) writeSnapshot(me.id, merged, rev === 0 ? 1 : rev, 'sync');
      q.updateInstall.run(watermark, bucket, inst.legacyImported ? 1 : 0, now(), installId);
      return respond(me.id, rev === 0 ? 1 : rev, merged, { watermark, capped, acknowledged, rejected });
    });
  }

  // ————————————————————————— aiguillage

  const withAuth = (req: HttpRequest, fn: (me: PlayerRow) => HttpResponse): HttpResponse => {
    const me = authenticate(req);
    return me ? fn(me) : err(401, 'unauthorized', 'Authentification requise.');
  };

  return {
    handle(req) {
      switch (`${req.method} ${req.path}`) {
        case 'GET /api/auth/providers': return providersRoute();
        case 'POST /api/auth/nonce': return nonceRoute(req);
        case 'POST /api/auth/email/verify': return emailVerify(req);
        case 'POST /api/auth/logout': return withAuth(req, () => logout(req));
        case 'POST /api/auth/unlink': return withAuth(req, (me) => unlink(req, me));
        case 'GET /api/profile': return withAuth(req, profileRoute);
        case 'POST /api/migrate': return withAuth(req, (me) => migrate(req, me));
        case 'POST /api/sync': return withAuth(req, (me) => sync(req, me));
        default: return null;
      }
    },
    handleAsync(req) {
      switch (`${req.method} ${req.path}`) {
        case 'POST /api/auth/google': return oidcRoute(req, 'google').catch(replayGuard);
        case 'POST /api/auth/apple': return oidcRoute(req, 'apple').catch(replayGuard);
        case 'POST /api/auth/email/request': return emailRequest(req);
        default: return null;
      }
    },
  };
}

/** Un nonce consommé par une requête concurrente : la seconde est refusée (anti-rejeu). */
class ReplayError extends Error {}
function replayGuard(e: unknown): HttpResponse {
  if (e instanceof ReplayError) return err(400, 'bad_nonce', 'Demande de connexion déjà utilisée : recommencez.');
  throw e;
}
