/** Shared interaction states; each form retains its own payload and server rules. */
export function setupFormSubmission({ form, endpoint, payload, success }: {
  form: HTMLFormElement;
  endpoint: string;
  payload: (data: FormData) => Record<string, unknown>;
  success: HTMLElement;
}) {
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const status = form.querySelector<HTMLElement>('[data-form-status]')!;
  const errors = [...form.querySelectorAll<HTMLElement>('[data-form-error]')];
  const controlsFor = (name: string) => [...form.elements].filter((element): element is HTMLElement => element instanceof HTMLElement && element.getAttribute('name') === name);
  const label = button.textContent;
  let pending = false;
  button.disabled = form.dataset.available !== 'true';

  for (const error of errors) {
    error.id = `${form.id}-${error.dataset.formError}-error`;
    for (const control of controlsFor(error.dataset.formError!)) {
      const description = control.getAttribute('aria-describedby');
      control.setAttribute('aria-describedby', [description, error.id].filter(Boolean).join(' '));
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || button.disabled) return;
    pending = true;
    button.disabled = true;
    button.textContent = 'Sending…';
    form.setAttribute('aria-busy', 'true');
    errors.forEach(error => { error.textContent = ''; error.hidden = true; });
    form.querySelectorAll('[aria-invalid]').forEach(control => control.removeAttribute('aria-invalid'));
    status.textContent = 'Sending…';

    try {
      const data = new FormData(form);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload(data), turnstileToken: String(data.get('cf-turnstile-response') ?? '') }),
        signal: AbortSignal.timeout(30_000),
      });
      const result = await response.json() as { ok?: boolean; errors?: Record<string, string>; error?: string };
      if (response.ok && result.ok === true) {
        form.hidden = true;
        success.hidden = false;
        success.focus();
        return;
      }
      let firstInvalid: HTMLElement | undefined;
      const generalErrors: string[] = [];
      for (const [field, message] of Object.entries(result.errors ?? {})) {
        const error = errors.find(element => element.dataset.formError === field);
        if (error) { error.textContent = message; error.hidden = false; }
        const controls = controlsFor(field);
        controls.forEach(control => control.setAttribute('aria-invalid', 'true'));
        firstInvalid ??= controls[0];
        if (!controls.length) generalErrors.push(message);
      }
      status.textContent = generalErrors.join(' ') || result.error || (firstInvalid ? 'Please check the highlighted fields.' : 'We couldn’t confirm your message was sent. Try again or use email.');
      (firstInvalid ?? status).focus();
    } catch {
      status.textContent = 'We couldn’t confirm your message was sent. Your text is still here. Try again or use email.';
      status.focus();
    } finally {
      pending = false;
      button.disabled = form.dataset.available !== 'true';
      button.textContent = label;
      form.removeAttribute('aria-busy');
      // A token may have been consumed even when the response was lost.
      const turnstile = (window as Window & { turnstile?: { reset: () => void } }).turnstile;
      try { turnstile?.reset(); } catch { /* Verification can still be loading. */ }
    }
  });
}
