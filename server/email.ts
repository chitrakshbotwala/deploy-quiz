import { env } from './env';

/**
 * Sending mail through EmailJS, from the server.
 *
 * EmailJS is usually a browser SDK, and using it that way here would be wrong on
 * two counts. The obvious one is the private key: browser sends authenticate with
 * the public key alone, so anyone who opened the admin page could send mail from
 * the event's account for as long as the key lived. The quieter one is that the
 * browser would be the thing looping over 75 addresses — so a closed tab halfway
 * through would leave half the finalists told and no record of which half.
 *
 * So this is the REST API, called from Node with the private key, and the record
 * of who has been told is a field on their cut-member document. Sending is
 * therefore idempotent per recipient, resumable after any failure, and auditable
 * afterwards.
 *
 * Nothing here throws on a missing configuration: an event that never sets the
 * EmailJS variables simply has the feature switched off in the admin panel, rather
 * than a server that refuses to boot over a button nobody was going to press.
 */
const ENDPOINT = 'https://api.emailjs.com/api/v1.0/email/send';

/**
 * EmailJS applies its own rate limit and answers 429 above it. One send every
 * 700ms is comfortably under the documented ceiling and puts a 75-person round at
 * under a minute of real work, which the batching in the route then splits across
 * several requests so no single one hangs.
 */
export const SEND_SPACING_MS = 700;
/** A single send should not be able to hold a request open. */
const TIMEOUT_MS = 15_000;

export interface FinalistMail {
  toEmail: string;
  toName: string;
  rank: number;
  score: number;
  total: number;
  seconds: number;
  stageLabel: string;
  cutoff: number;
}

export type SendResult = { ok: true } | { ok: false; message: string; retryable: boolean };

export function emailConfigured(): boolean {
  const c = env.emailjs;
  return Boolean(c.serviceId && c.templateId && c.publicKey && c.privateKey);
}

/**
 * The template parameters, in snake_case because that is what an EmailJS template
 * interpolates. `to_email` is the one that matters operationally: the template's
 * own "To Email" field has to be set to `{{to_email}}` in the EmailJS dashboard, or
 * every message goes to whatever fixed address is configured there instead — which
 * fails by sending 75 copies to one person rather than by erroring.
 */
function paramsFor(mail: FinalistMail): Record<string, string | number> {
  return {
    to_email: mail.toEmail,
    to_name: mail.toName,
    rank: mail.rank,
    score: mail.score,
    total: mail.total,
    seconds: mail.seconds,
    stage_label: mail.stageLabel,
    cutoff: mail.cutoff
  };
}

export async function sendFinalistMail(mail: FinalistMail): Promise<SendResult> {
  const c = env.emailjs;
  if (!emailConfigured()) {
    return { ok: false, message: 'EmailJS is not configured on the server.', retryable: false };
  }

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        service_id: c.serviceId,
        template_id: c.templateId,
        user_id: c.publicKey,
        // The private key. This is the field that makes a non-browser send
        // legitimate, and the reason the account's "API requests from
        // non-browser applications" setting has to be allowed.
        accessToken: c.privateKey,
        template_params: paramsFor(mail)
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (err) {
    // Timeout, DNS, EmailJS down. Worth another attempt later, so the recipient is
    // left unmarked and the next batch picks them up.
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Could not reach EmailJS.',
      retryable: true
    };
  }

  if (res.ok) return { ok: true };

  // EmailJS answers with a plain-text reason, which is the only useful diagnostic
  // it gives — pass it through rather than inventing a friendlier one that hides
  // "The template ID not found" or "Invalid grant".
  const body = (await res.text().catch(() => '')).slice(0, 300);
  return {
    ok: false,
    message: `EmailJS ${res.status}: ${body || 'no detail'}`,
    // 429 is the rate limit and 5xx is theirs, both worth retrying. A 400 or 403
    // is a configuration mistake and will fail identically forever.
    retryable: res.status === 429 || res.status >= 500
  };
}

/** Pause between sends, so a batch stays under the rate limit. */
export function spacing(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, SEND_SPACING_MS));
}
