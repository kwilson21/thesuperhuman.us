/** The client approves the published review or requests changes with notes. */
export function setupReviewResponse() {
  const form = document.querySelector<HTMLFormElement>('[data-review-response]');
  const status = form?.querySelector<HTMLElement>('[data-review-response-status]');
  const endpoint = form?.dataset.endpoint;
  if (!form || !status || !endpoint) return;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = (event as SubmitEvent).submitter as HTMLButtonElement | null;
    const decision = button?.value === 'changes' ? 'changes' : 'approved';
    const body = form.querySelector<HTMLTextAreaElement>('textarea[name="body"]')?.value.trim() ?? '';
    if (decision === 'changes' && !body) { status.textContent = 'Write the changes you would like first.'; return; }
    if (decision === 'approved' && !confirm('Approve this mix? Next come the remaining balance and your final files.')) return;
    form.querySelectorAll('button').forEach(item => { item.disabled = true; });
    status.textContent = '';
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'respond', decision, body }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (response.ok) { location.reload(); return; }
      status.textContent = result.error ?? 'Your answer could not be sent. Please try again.';
    } catch { status.textContent = 'Your answer could not be sent. Please try again.'; }
    form.querySelectorAll('button').forEach(item => { item.disabled = false; });
  });
}
