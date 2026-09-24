export function setupProjectInvitation() {
  const root = document.querySelector<HTMLElement>('[data-project-invitation]');
  const button = root?.querySelector<HTMLButtonElement>('[data-send-project-invitation]');
  const status = root?.querySelector<HTMLElement>('[data-invitation-status]');
  const endpoint = root?.dataset.endpoint;
  if (!button || !status || !endpoint) return;
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = 'Sending the sign-in link…';
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'send', confirmedNotSent: button.dataset.confirmedNotSent === 'true' }) });
      if (response.ok) { location.reload(); return; }
      const result = await response.json() as { error?: string };
      status.textContent = result.error ?? 'Could not queue the invitation. Please try again.';
    } catch { status.textContent = 'Could not queue the invitation. Please try again.'; }
    button.disabled = false;
  });
}
