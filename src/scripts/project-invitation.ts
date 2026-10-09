export function setupProjectInvitation(selector = '[data-project-invitation]') {
  const root = document.querySelector<HTMLElement>(selector);
  const button = root?.querySelector<HTMLButtonElement>('[data-send-project-invitation]');
  const status = root?.querySelector<HTMLElement>('[data-invitation-status]');
  const endpoint = root?.dataset.endpoint;
  if (!button || !status || !endpoint) return;
  const failure = selector === '[data-project-invitation]' ? 'Could not queue the invitation. Please try again.' : 'Could not send the brief copy. Please try again.';
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = selector === '[data-project-invitation]' ? 'Sending the sign-in link…' : 'Sending the brief copy…';
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'send', confirmedNotSent: button.dataset.confirmedNotSent === 'true' }) });
      if (response.ok) { location.reload(); return; }
      const result = await response.json() as { error?: string };
      status.textContent = result.error ?? failure;
    } catch { status.textContent = failure; }
    button.disabled = false;
  });
}
