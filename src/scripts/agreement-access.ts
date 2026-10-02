export function setupAgreementAccess() {
  setupAgreementForms();
  const naming = document.querySelector<HTMLInputElement>('[name="naming"]');
  if (naming) {
    const update = () => {
      naming.disabled =
        document.querySelector<HTMLInputElement>('[name="portfolio"][value="allow"]')?.checked !==
        true;
      if (naming.disabled) naming.checked = false;
    };
    document
      .querySelectorAll<HTMLInputElement>('[name="portfolio"]')
      .forEach((input) => input.addEventListener('change', update));
    update();
  }
  const form = document.querySelector<HTMLFormElement>('[data-agreement-code]');
  if (!form) return;
  const status = document.querySelector<HTMLElement>('[role="status"]')!;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form),
      button = form.querySelector<HTMLButtonElement>('button')!;
    button.disabled = true;
    try {
      const res = await fetch(form.action, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: data.get('email') ?? undefined,
            turnstileToken: data.get('cf-turnstile-response') || data.get('turnstileToken'),
          }),
        }),
        result = (await res.json()) as { error: string; challenge_id: string; message: string };
      if (!res.ok) throw new Error(result.error);
      document.querySelector<HTMLInputElement>('[name="challenge_id"]')!.value =
        result.challenge_id;
      status.textContent = result.message;
      document.querySelector<HTMLInputElement>('[name="code"]')!.focus();
    } catch (error) {
      status.textContent = (error as Error).message;
    } finally {
      button.disabled = false;
    }
  });
}

function setupAgreementForms() {
  for (const form of document.querySelectorAll<HTMLFormElement>(
    '[data-agreement-flow],[data-agreement-refresh],[data-agreement-session]',
  ))
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form),
        status = document.querySelector<HTMLElement>('[role="status"]')!,
        button = form.querySelector<HTMLButtonElement>('button')!;
      const payload: Record<string, unknown> = { ...Object.fromEntries(data) };
      if (form.dataset.agreementFlow === 'review') {
        const { csrf_nonce, ...values } = payload;
        payload.values = {
          ...values,
          naming: data.has('naming'),
          business_engagement: data.has('business_engagement'),
        };
        for (const key of Object.keys(values)) delete payload[key];
        payload.csrf_nonce = csrf_nonce;
      }
      if (form.dataset.agreementFlow === 'sign') {
        payload.documents = JSON.parse(String(data.get('documents')));
        for (const key of ['consent', 'authority', 'intent']) payload[key] = data.has(key);
      }
      button.disabled = true;
      try {
        const response = await fetch(form.action, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }),
          result = (await response.json()) as { error: string; csrf_nonce?: string };
        if (!response.ok) {
          if (response.status === 401) {
            const refresh = document.querySelector<HTMLDetailsElement>('[data-reauth]');
            if (refresh) {
              refresh.hidden = false;
              refresh.open = true;
            }
          }
          throw new Error(result.error);
        }
        if (form.hasAttribute('data-agreement-refresh')) {
          document
            .querySelectorAll<HTMLInputElement>('[name="csrf_nonce"]')
            .forEach((input) => (input.value = result.csrf_nonce!));
          const reviewed = document.querySelector<HTMLInputElement>('[data-reviewed-client]');
          if (reviewed) {
            const preview = await fetch(form.action.replace('/session', '/review'), {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                csrf_nonce: result.csrf_nonce,
                values: JSON.parse(reviewed.value),
              }),
            });
            if (!preview.ok) throw new Error('Review your agreement details again.');
            location.href = location.pathname + '?review=1';
          } else {
            document.querySelector<HTMLDetailsElement>('[data-reauth]')!.hidden = true;
            status.textContent = 'Email verified again. Review a fresh preview before signing.';
          }
          return;
        }
        location.href =
          location.pathname + (form.dataset.agreementFlow === 'review' ? '?review=1' : '');
      } catch (error) {
        status.textContent = (error as Error).message;
        status.focus();
      } finally {
        button.disabled = false;
      }
    });
}
