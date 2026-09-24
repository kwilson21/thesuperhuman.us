export function setupOwnerRequestActions() {
  const root = document.querySelector<HTMLElement>('[data-request-id]');
  const status = document.querySelector<HTMLElement>('[data-action-status]');
  const requestId = root?.dataset.requestId;
  if (!requestId || !status) return;
  // After Mark reviewed, land on the Accept panel. A reload restores the old scroll position over
  // the fragment, so scroll here, then drop the fragment so later reloads keep their place.
  if (location.hash === '#accept-project') {
    const accept = document.getElementById('accept-project');
    accept?.scrollIntoView({ block: 'start' });
    accept?.querySelector<HTMLInputElement>('input[name="dueDate"]')?.focus({ preventScroll: true });
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    history.scrollRestoration = 'auto';
  }
  async function update(payload: Record<string, unknown>) {
    try {
      const response = await fetch(`/api/owner/requests/${requestId}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!response.ok) { status!.textContent = 'That change was not saved. Refresh and try again.'; return; }
      // A reviewed request's next step is accepting the project, so reload onto that panel.
      if (payload.action === 'review') {
        history.scrollRestoration = 'manual';
        history.replaceState(null, '', `${location.pathname}${location.search}#accept-project`);
      }
      location.reload();
    } catch { status!.textContent = 'Connection lost. The change may not have been saved. Refresh before trying again.'; }
  }
  document.querySelector<HTMLFormElement>('[data-request-note]')?.addEventListener('submit', event => {
    event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement); void update({ action: 'note', note: data.get('note') });
  });
  // Scoped: project update forms also carry data-action, and must not post request status changes.
  document.querySelectorAll<HTMLButtonElement>('[data-request-actions] button[data-action]').forEach(button => button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action === 'withdraw' && !confirm('Honor this withdrawal and close the request?')) return;
    // Resolving before acceptance closes the provisional studio for good; reopening does not restore it.
    if (action === 'resolve' && button.closest<HTMLElement>('[data-open-studio]')
      && !confirm('Resolving closes this client’s studio access. Reopening the request will not restore it. Resolve anyway?')) return;
    void update({ action });
  }));
}
