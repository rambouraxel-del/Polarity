/**
 * Envoi de courriels (liens magiques). Interface minimale : une implémentation par fournisseur, aucune dépendance.
 * Fournie : Resend (API HTTPS). Désactivé tant que `RESEND_API_KEY` et `MAIL_FROM` ne sont pas configurés (la connexion par courriel est alors masquée).
 * Pour un autre fournisseur (SMTP, Postmark…) : implémenter `Mailer` et le passer à `createApp`.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

export class ResendMailer implements Mailer {
  constructor(private readonly o: { apiKey: string; from: string; fetchFn?: typeof fetch }) {}

  async send(msg: MailMessage): Promise<void> {
    const f = this.o.fetchFn ?? fetch;
    const res = await f('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.o.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.o.from, to: [msg.to], subject: msg.subject, text: msg.text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Envoi du courriel refusé (${res.status})`);
  }
}

/** Mailer configuré par l'environnement, ou null (fonction désactivée). */
export function mailerFromEnv(env: Record<string, string | undefined>): Mailer | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.MAIL_FROM?.trim();
  return apiKey && from ? new ResendMailer({ apiKey, from }) : null;
}
