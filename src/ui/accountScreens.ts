import type { Availability } from '../account/providers';
import type { AccountState } from '../account/AccountService';
import type { ProviderId } from '../net/accountProtocol';
import { button, notice, screenHead, setting } from './components';
import { escapeHtml } from './format';

/**
 * Écran « Compte et synchronisation » (économie v3). Rien n'est proposé qui ne fonctionne pas : une méthode non configurée sur le service ou non
 * exécutable ici est affichée comme indisponible, avec sa raison, sans bouton. Le jeu reste complet sans compte.
 */
export interface AccountView {
  state: AccountState;
  methods: Availability[];
}

const PROVIDER_NAME: Record<ProviderId, string> = { google: 'Google', apple: 'Apple', email: 'Courriel (lien magique)' };

function when(ms: number | null): string {
  if (!ms) return 'jamais';
  const d = new Date(ms);
  return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function statusLine(s: AccountState): string {
  switch (s.sync.status) {
    case 'disabled': return 'Service non configuré dans cette version.';
    case 'syncing': return 'Synchronisation en cours…';
    case 'offline': return 'Hors connexion — vos gains et achats restent sur cet appareil et seront envoyés plus tard.';
    case 'error': return s.sync.message ?? 'Synchronisation impossible pour le moment.';
    case 'ok': return `Synchronisé le ${when(s.sync.lastAt)}.`;
    default: return s.sync.lastAt ? `Dernière synchronisation : ${when(s.sync.lastAt)}.` : 'Pas encore synchronisé.';
  }
}

function pendingLine(s: AccountState): string {
  const p = s.pending;
  const bits: string[] = [];
  if (p.legacy) bits.push('ancienne sauvegarde à importer');
  if (p.earned > 0) bits.push(`${p.earned} Éclat${p.earned > 1 ? 's' : ''} à confirmer`);
  if (p.claims > 0) bits.push(`${p.claims} succès à confirmer (Médailles)`);
  if (p.purchases > 0) bits.push(`${p.purchases} achat${p.purchases > 1 ? 's' : ''} à confirmer`);
  if (p.charges > 0) bits.push(`${p.charges} charge${p.charges > 1 ? 's' : ''} de bonus à confirmer`);
  return bits.length > 0 ? `En attente de confirmation par le service : ${bits.join(', ')}.` : '';
}

export function accountScreen(v: AccountView): string {
  const s = v.state;
  const head = screenHead('Compte', 'options');
  if (!s.configured) {
    return `<div class="panel">${head}
      ${notice('Les comptes et la synchronisation ne sont <strong>pas disponibles</strong> dans cette version. Le jeu reste entièrement jouable : votre progression est enregistrée sur cet appareil.', 'cyan')}
    </div>`;
  }
  const linked = new Set<ProviderId>((s.profile?.identities ?? []).map((i) => i.provider));
  const isAccount = linked.size > 0;
  const who = s.identity
    ? `<div class="lb-id"><span class="kind-label">${isAccount ? 'Compte connecté' : s.identity.guest ? 'Profil invité' : 'Profil du classement'}</span><strong class="lb-id__name">${escapeHtml(s.identity.nickname)}</strong></div>`
    : '<p class="sub" style="margin:10px 0">Profil invité : il sera créé automatiquement dès que le service est joignable. Aucune inscription n’est nécessaire.</p>';
  const msg = s.message ? `<p class="shop-note${s.message.kind === 'error' ? '' : ''}" role="${s.message.kind === 'error' ? 'alert' : 'status'}">${escapeHtml(s.message.text)}</p>` : '';
  const conflict = s.conflict
    ? `<div role="alert" class="notice"><strong>Ce compte existe déjà</strong> (pseudo « ${escapeHtml(s.conflict.targetNickname)} »). ${
        s.conflict.canMerge
          ? 'Fusionner la progression de cet appareil dans ce compte ? Succès, cosmétiques et meilleurs records sont réunis ; rien n’est compté deux fois.'
          : 'Ce profil possède déjà un compte : la fusion de deux comptes n’est pas disponible.'
      }<div class="btn-row">${s.conflict.canMerge ? button({ action: 'acct-merge-confirm', label: 'Fusionner', variant: 'primary', size: 'sm' }) : ''}${button({ action: 'acct-merge-cancel', label: 'Annuler', variant: 'secondary', size: 'sm' })}</div></div>`
    : '';
  const sync = `<h3 class="section-title">Synchronisation</h3>
    <p class="small" role="status">${escapeHtml(statusLine(s))}</p>
    ${pendingLine(s) ? `<p class="small">${escapeHtml(pendingLine(s))}</p>` : ''}
    ${button({ action: 'acct-sync', label: s.sync.status === 'syncing' ? 'Synchronisation…' : 'Synchroniser maintenant', icon: 'replay', variant: 'secondary', size: 'sm', attrs: s.busy || s.sync.status === 'syncing' ? 'disabled' : '' })}`;

  const methodRows = v.methods
    .map((m) => {
      const done = linked.has(m.provider);
      const name = PROVIDER_NAME[m.provider];
      if (done) {
        const label = s.profile?.identities.find((i) => i.provider === m.provider)?.label ?? '';
        const canUnlink = (s.profile?.identities.length ?? 0) >= 2;
        return setting('check', name, `Associé${label ? ` (${label})` : ''}`, canUnlink ? button({ action: 'acct-unlink', label: 'Retirer', variant: 'ghost', size: 'sm', attrs: `data-provider="${m.provider}"` }) : '');
      }
      if (!m.available) return setting('lock', name, m.reason ?? 'Indisponible', '');
      if (m.provider === 'google') return `<div class="setting setting--stack"><div class="setting__label">${name}</div><div id="acct-google" class="acct-google" aria-label="Se connecter avec Google"></div></div>`;
      if (m.provider === 'apple') return setting('lock', name, 'Se connecter avec Apple', button({ action: 'acct-apple', label: 'Continuer', variant: 'secondary', size: 'sm', attrs: s.busy ? 'disabled' : '' }));
      const em = s.email;
      return em.stage === 'code'
        ? `<form class="nick-form" data-form="acct-code" autocomplete="off" novalidate>
            <label class="sr-only" for="acct-code">Code reçu par courriel</label>
            <input id="acct-code" class="input" name="code" type="text" inputmode="text" maxlength="9" placeholder="Code reçu (XXXX-XXXX)" spellcheck="false" autocapitalize="characters" />
            ${button({ action: 'acct-code', label: 'Valider', icon: 'check', variant: 'primary', size: 'sm', attrs: 'type="submit"' })}
          </form><p class="small">Un message a été envoyé à <strong>${escapeHtml(em.address)}</strong>. Saisissez le code, ou ouvrez le lien reçu.</p>`
        : `<form class="nick-form" data-form="acct-email" autocomplete="on" novalidate>
            <label class="sr-only" for="acct-email">Adresse courriel</label>
            <input id="acct-email" class="input" name="email" type="email" autocomplete="email" maxlength="254" placeholder="Votre adresse courriel" spellcheck="false" autocapitalize="off" />
            ${button({ action: 'acct-email-send', label: 'Recevoir un code', variant: 'primary', size: 'sm', attrs: 'type="submit"' })}
          </form>`;
    })
    .join('');
  const connect = `<h3 class="section-title">${isAccount ? 'Méthodes de connexion' : 'Se connecter (facultatif)'}</h3>
    <p class="small">Un compte permet de retrouver votre progression sur un autre appareil et sera nécessaire pour de futurs achats. <strong>Rien ne change si vous n’en créez pas</strong> : le jeu reste jouable sans compte et sans Internet.</p>
    ${methodRows}`;
  const logout = s.identity && isAccount ? `<h3 class="section-title">Cet appareil</h3>${button({ action: 'acct-logout', label: 'Se déconnecter de cet appareil', variant: 'ghost', size: 'sm' })}<p class="small">Votre progression locale est conservée, ainsi que vos résultats classés en attente : ils seront envoyés à votre prochaine connexion.</p>` : '';
  return `<div class="panel">${head}${who}${msg}${conflict}${sync}${connect}${logout}
    <p class="small" style="margin-top:14px">Hors connexion, les Éclats gagnés et les achats sont enregistrés provisoirement sur cet appareil ; le service les confirme à la synchronisation suivante. Les données locales ne suffisent jamais à créer de nouvelles récompenses payantes.</p>
  </div>`;
}
