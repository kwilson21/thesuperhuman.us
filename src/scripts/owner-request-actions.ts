export function setupOwnerRequestActions() {
  const root = document.querySelector<HTMLElement>('[data-request-id]');
  const status = document.querySelector<HTMLElement>('[data-action-status]');
  const requestId = root?.dataset.requestId;
  if (!requestId || !status) return;
  async function update(payload: Record<string, unknown>) {
    const response = await fetch(`/api/owner/requests/${requestId}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!response.ok) { status!.textContent = 'That change was not saved. Refresh and try again.'; return; }
    location.reload();
  }
  document.querySelector<HTMLFormElement>('[data-request-note]')?.addEventListener('submit', event => {
    event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement); void update({ action: 'note', note: data.get('note') });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action === 'withdraw' && !confirm('Honor this withdrawal and close the request?')) return;
    void update({ action });
  }));
}
