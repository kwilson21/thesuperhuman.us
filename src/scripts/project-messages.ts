export function setupProjectMessages() {
  document.querySelectorAll<HTMLElement>('[data-project-messages]').forEach(root => {
    const endpoint = root.dataset.endpoint;
    if (!endpoint) return;
    const form = root.querySelector<HTMLFormElement>('[data-project-message-form]');
    const status = root.querySelector<HTMLElement>('[data-project-message-status]');
    form?.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      const body = form.querySelector<HTMLTextAreaElement>('textarea[name="body"]')?.value;
      if (!body || !status) return;
      if (button) button.disabled = true;
      try {
        const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'send', body }) });
        const result = await response.json() as { error?: string };
        if (response.ok) { location.reload(); return; }
        status.textContent = result.error ?? 'Your message could not be sent. Please try again.';
      } catch { status.textContent = 'Your message could not be sent. Please try again.'; }
      finally { if (button) button.disabled = false; }
    });
    if (root.dataset.unread !== 'true') return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const messageId = Number((entry.target as HTMLElement).dataset.unreadMessage);
        if (!Number.isInteger(messageId)) continue;
        void fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'read', messageId }) }).catch(() => {});
      }
    });
    root.querySelectorAll<HTMLElement>('[data-unread-message]').forEach(message => observer.observe(message));
  });
}
