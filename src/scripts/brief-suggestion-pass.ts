type Turnstile = {
  ready(callback: () => void): void;
  render(container: HTMLElement, options: Record<string, unknown>): string;
  remove(id: string): void;
};
export function setupSuggestionPass(form: HTMLFormElement) {
  let pending: Promise<boolean> | undefined;
  return () => pending ??= new Promise<boolean>(resolve => {
    const sitekey = form.dataset.suggestionSitekey;
    if (!sitekey) { resolve(false); return; }
    let finished = false, widget: string | undefined;
    const container = document.createElement('div');
    // Keep even an interactive challenge out of the visible and keyboard flow.
    Object.assign(container.style, { position: 'fixed', visibility: 'hidden', pointerEvents: 'none' });
    container.setAttribute('inert', ''); container.setAttribute('aria-hidden', 'true');
    document.body.appendChild(container);
    const turnstile = () => (window as Window & { turnstile?: Turnstile }).turnstile;
    const finish = (ok: boolean) => {
      if (finished) return;
      finished = true; clearTimeout(timeout);
      try { if (widget) turnstile()?.remove(widget); } catch { /* The container is removed below too. */ }
      container.remove(); resolve(ok);
    };
    const timeout = setTimeout(() => finish(false), 10000);
    const render = () => {
      if (finished) return;
      const api = turnstile();
      if (!api) { finish(false); return; }
      api.ready(() => {
        if (finished) return;
        try {
          widget = api.render(container, {
            sitekey, appearance: 'interaction-only', 'response-field': false,
            retry: 'never', 'refresh-expired': 'never',
            'before-interactive-callback': () => finish(false),
            'error-callback': () => finish(false),
            'unsupported-callback': () => finish(false),
            callback: async (token: string) => {
              if (finished) return;
              try {
                const response = await fetch('/api/software/brief/pass', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }), signal: AbortSignal.timeout(6000) });
                const result = await response.json() as { ok?: boolean };
                finish(response.ok && result.ok === true);
              } catch { finish(false); }
            },
          });
          if (finished && widget) api.remove(widget);
        } catch { finish(false); }
      });
    };
    if (turnstile()) render();
    else document.querySelector<HTMLScriptElement>('script[src^="https://challenges.cloudflare.com/turnstile/"]')?.addEventListener('load', render, { once: true });
  });
}
