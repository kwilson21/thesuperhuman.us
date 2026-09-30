import { hasUnsavedRequestChanges, markRequestPageClean } from './software-offers';
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
  const canDiscardChanges = (submitted?: HTMLElement) => root?.dataset.offerSending !== 'true' && (!hasUnsavedRequestChanges(submitted)
    || confirm('You have unsaved changes in another section. Continue and lose them?'));
  let updating = false;
  async function update(payload: Record<string, unknown>) {
    if (updating || root?.dataset.offerSending === 'true') return;
    updating = true;
    root!.setAttribute('inert', '');
    root!.setAttribute('aria-busy', 'true');
    let reloading = false;
    try {
      const response = await fetch(`/api/owner/requests/${requestId}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, expectedUpdatedAt: root?.dataset.requestUpdated }),
      });
      if (!response.ok) { status!.textContent = 'That change was not saved. Refresh and try again.'; return; }
      // A reviewed request's next step is accepting the project, so reload onto that panel.
      if (payload.action === 'review') {
        history.scrollRestoration = 'manual';
        history.replaceState(null, '', `${location.pathname}${location.search}#accept-project`);
      }
      markRequestPageClean();
      reloading = true;
      location.reload();
    } catch { status!.textContent = 'Connection lost. The change may not have been saved. Refresh before trying again.'; }
    finally {
      if (!reloading) {
        updating = false;
        root!.removeAttribute('inert');
        root!.removeAttribute('aria-busy');
      }
    }
  }
  document.querySelector<HTMLFormElement>('[data-request-note]')?.addEventListener('submit', event => {
    event.preventDefault(); if (!canDiscardChanges(event.currentTarget as HTMLFormElement)) return; const data = new FormData(event.currentTarget as HTMLFormElement); void update({ action: 'note', note: data.get('note') });
  });
  // Scoped: project update forms also carry data-action, and must not post request status changes.
  document.querySelectorAll<HTMLButtonElement>('[data-request-actions] button[data-action]').forEach(button => button.addEventListener('click', () => {
    if (!canDiscardChanges()) return;
    const action = button.dataset.action;
    if (action === 'withdraw' && !confirm('Honor this withdrawal and close the request?')) return;
    // Resolving before acceptance closes the provisional studio for good; reopening does not restore it.
    if (action === 'resolve' && button.closest<HTMLElement>('[data-open-studio]')
      && !confirm('Resolving closes this client’s studio access. Reopening the request will not restore it. Resolve anyway?')) return;
    void update({ action });
  }));
}
