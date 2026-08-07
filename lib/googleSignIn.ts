/**
 * Loads Google Identity Services and renders its sign-in button.
 *
 * The script is third-party and fetched at runtime, which is a real dependency
 * and the reason `load()` reports failure rather than hanging: if GSI is blocked
 * — an extension, a campus filter, a bad network — the gate has to say so, since
 * there is no email fallback any more. A fallback would reopen exactly the hole
 * sign-in was added to close, so the honest failure mode is a message telling
 * the visitor what to unblock.
 *
 * Note this needs a Content-Security-Policy that allows accounts.google.com in
 * `script-src`, `frame-src` and `connect-src`; see deploy/Caddyfile. With a
 * stricter policy the button silently never appears.
 */
const SRC = 'https://accounts.google.com/gsi/client';

interface CredentialResponse {
  credential?: string;
}

interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: CredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    use_fedcm_for_prompt?: boolean;
  }): void;
  renderButton(parent: HTMLElement, options: Record<string, string | number>): void;
  disableAutoSelect(): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

let loader: Promise<GoogleAccountsId> | null = null;

export function loadGoogleSignIn(): Promise<GoogleAccountsId> {
  if (loader) return loader;
  loader = new Promise<GoogleAccountsId>((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google.accounts.id);

    // Reuse a tag already in flight rather than injecting a second one — React
    // in dev can mount this twice.
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
    const script = existing ?? document.createElement('script');
    const done = () => {
      const api = window.google?.accounts?.id;
      if (api) resolve(api);
      else reject(new Error('Google sign-in loaded but did not initialise'));
    };
    script.addEventListener('load', done);
    script.addEventListener('error', () => reject(new Error('Google sign-in failed to load')));
    if (!existing) {
      script.src = SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    } else if (window.google?.accounts?.id) {
      done();
    }
  }).catch(err => {
    // Let a later mount retry a transient network failure instead of caching it.
    loader = null;
    throw err;
  });
  return loader;
}
