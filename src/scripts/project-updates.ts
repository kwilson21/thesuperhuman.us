export function setupProjectUpdates() {
  document.querySelectorAll<HTMLElement>('[data-audio-project-updates]').forEach(root => {
    const endpoint = root.dataset.endpoint;
    if (!endpoint) return;
    root.querySelectorAll<HTMLFormElement>('[data-project-update-form]').forEach(form => {
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
        const status = form.querySelector<HTMLElement>('[data-update-status]');
        if (!status) return;
        const fields = Object.fromEntries(new FormData(form).entries());
        if (button) button.disabled = true;
        try {
          const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: form.dataset.action, ...fields }) });
          const result = await response.json() as { error?: string };
          if (response.ok) { location.reload(); return; }
          status.textContent = result.error ?? 'Could not save the update. Please try again.';
        } catch { status.textContent = 'Could not save the update. Please try again.'; }
        finally { if (button) button.disabled = false; }
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-retry-update]').forEach(button => {
      button.addEventListener('click', async () => {
        const updateId = Number(button.dataset.retryUpdate);
        if (!Number.isInteger(updateId)) return;
        button.disabled = true;
        try {
          const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'retry_email', updateId, confirmedNotSent: button.dataset.confirmedNotSent === 'true' }) });
          if (response.ok) { location.reload(); return; }
        } catch { /* Restore the button so the owner can try again. */ }
        button.disabled = false;
        button.textContent = 'Could not retry. Try again.';
      });
    });
  });
}
