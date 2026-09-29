import type { OfferTerms } from '~/lib/software-offers';
export function setupSoftwareOffers() {
  const sessionValue = (key: string, value?: string | null) => {
    try {
      if (value === undefined) return sessionStorage.getItem(key);
      if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value);
      return value;
    } catch { /* The link remains usable in this page when browser storage is disabled. */ }
    return null;
  };
  const post = async (endpoint: string, body: unknown) => {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json() as { message?: string; errors?: Record<string,string>; version: number; updatedAt: string; link: string; emailSent: boolean; copySent?: boolean };
    if (!response.ok) throw new Error(result.message ?? (Object.entries(result.errors ?? {}).map(([key, message]) => `${key}: ${message}`).join('\n') || 'Could not save. Try again.'));
    return result;
  };
  document.querySelectorAll<HTMLFormElement>('[data-software-action]').forEach(form => {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const action = form.dataset.softwareAction!, data = new FormData(form), status = form.querySelector<HTMLElement>('[data-software-status]')!;
      if (action === 'decline' && !confirm('Send this message and decline the inquiry?')) return;
      const button = form.querySelector<HTMLButtonElement>('button')!; button.disabled = true;
      try {
        const result = await post(form.dataset.endpoint!, { action, ...Object.fromEntries(data) });
        status.textContent = result.copySent === false ? 'Sent to the client. The owner copy didn’t send.' : action === 'fit' ? 'Fit review saved.' : 'Sent.';
        const editor = document.querySelector<HTMLElement>('[data-software-editor]');
        if (editor?.dataset.dirty === 'true' || editor?.dataset.busy === 'true') status.textContent += ' Your offer edits are kept. Reload after saving to refresh activity.';
        else { sessionValue(`software-flash:${form.dataset.endpoint}`, status.textContent); location.reload(); }
      } catch (error) { status.textContent = (error as Error).message; }
      finally { button.disabled = false; }
    });
  });
  const root = document.querySelector<HTMLElement>('[data-software-editor]');
  if (!root) return;
  const form = root.querySelector<HTMLFormElement>('[data-offer-form]')!, list = root.querySelector<HTMLElement>('[data-milestones]')!;
  const status = root.querySelector<HTMLElement>('[data-software-status]')!, send = root.querySelector<HTMLButtonElement>('[data-send-offer]')!, preview = root.querySelector<HTMLAnchorElement>('[data-preview-offer]')!;
  const endpoint = root.dataset.endpoint!;
  const flashKey = `software-flash:${endpoint}`;
  const flash = sessionValue(flashKey);
  if (flash) { status.textContent = flash; sessionValue(flashKey, null); }
  let saved = Boolean(root.dataset.updated), changed = false, inputRevision = 0;
  let link = sessionValue(`software-link:${endpoint}`) ?? '';
  const get = (element: HTMLElement, name: string) => element.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!.value.trim();
  const checked = (element: HTMLElement, name: string) => element.querySelector<HTMLInputElement>(`[name="${name}"]`)!.checked;
  const lines = (value: string) => value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const amount = (value: string) => value ? Math.round(Number(value) * 100) : NaN;
  const terms = (): OfferTerms => ({
    outcome: get(form, 'outcome'), summary: get(form, 'summary'),
    milestones: [...list.querySelectorAll<HTMLElement>('[data-milestone]')].map(row => ({ name: get(row, 'milestoneName'), deliverables: lines(get(row, 'deliverables')), acceptance: lines(get(row, 'acceptance')), feeCents: amount(get(row, 'fee')),
      ...(checked(row, 'hasCheckpoint') ? { checkpoint: { label: get(row, 'checkpointLabel'), cancellationPercent: Number(get(row, 'checkpointPercent')) } } : {}) })),
    clientInputs: get(form, 'clientInputs'), exclusions: get(form, 'exclusions'), timing: get(form, 'timing'),
    paymentMode: form.querySelector<HTMLInputElement>('[name="paymentMode"]:checked')!.value as OfferTerms['paymentMode'],
    ...(checked(form, 'hasRange') ? { projectRange: { lowCents: amount(get(form, 'rangeLow')), highCents: amount(get(form, 'rangeHigh')) } } : {}),
  });
  const updateControls = () => {
    root.dataset.dirty = String(changed);
    root.querySelector<HTMLButtonElement>('[data-add-milestone]')!.disabled = list.children.length >= 3;
    list.querySelectorAll<HTMLButtonElement>('[data-remove-milestone]').forEach(button => { button.disabled = list.children.length <= 1; });
    list.querySelectorAll<HTMLElement>('[data-milestone]').forEach(row => { const active = checked(row, 'hasCheckpoint'), block = row.querySelector<HTMLElement>('[data-checkpoint]')!; block.hidden = !active; block.querySelectorAll<HTMLInputElement>('input').forEach(input => { input.disabled = !active; input.required = active; }); });
    const rangeActive = checked(form, 'hasRange'), range = root.querySelector<HTMLElement>('[data-range]')!; range.hidden = !rangeActive; range.querySelectorAll<HTMLInputElement>('input').forEach(input => { input.disabled = !rangeActive; input.required = rangeActive; });
    send.disabled = changed || !(saved || (root.dataset.sentVersion && root.dataset.revoked === 'true'));
    preview.hidden = !saved || changed;
  };
  form.addEventListener('input', () => { changed = true; inputRevision++; updateControls(); });
  form.addEventListener('change', updateControls);
  root.querySelector('[data-add-milestone]')!.addEventListener('click', () => {
    if (list.children.length >= 3) return;
    list.appendChild(root.querySelector<HTMLTemplateElement>('[data-milestone-template]')!.content.cloneNode(true)); changed = true; inputRevision++; updateControls();
  });
  list.addEventListener('click', event => { const button = (event.target as HTMLElement).closest('[data-remove-milestone]'); if (button && list.children.length > 1) { button.closest('[data-milestone]')!.remove(); changed = true; inputRevision++; updateControls(); } });
  form.addEventListener('submit', async event => {
    event.preventDefault(); const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!; button.disabled = true;
    const revision = inputRevision;
    try { const result = await post(endpoint, { action: 'draft', terms: terms(), expectedUpdatedAt: root.dataset.updated || null });
      root.dataset.updated = result.updatedAt; root.dataset.version = String(result.version); saved = true; changed = inputRevision !== revision;
      root.querySelector<HTMLElement>('[data-offer-state]')!.textContent = root.dataset.sentVersion ? `v${root.dataset.sentVersion} sent ${root.dataset.sentDate} · Draft v${result.version} in progress` : `Draft v${result.version} · Not sent`; status.textContent = changed ? 'Draft saved. Your newer edits still need saving.' : 'Draft saved. Nothing has been sent.'; updateControls();
    } catch (error) { status.textContent = (error as Error).message; } finally { button.disabled = false; }
  });
  send.addEventListener('click', async () => {
    if (changed || send.disabled) return;
    const version = Number(saved ? root.dataset.version : root.dataset.sentVersion);
    if (!confirm(`Send offer v${version} to ${root.dataset.email}?`)) return;
    send.disabled = true; root.setAttribute('inert', ''); root.setAttribute('aria-busy', 'true'); root.dataset.busy = 'true';
    try { const result = await post(endpoint, { action: 'send', version, expectedUpdatedAt: saved ? root.dataset.updated : root.dataset.sentUpdated });
      link = result.link; const persistedLink = sessionValue(`software-link:${endpoint}`, link);
      status.textContent = result.emailSent ? `Offer v${version} sent.${result.copySent ? '' : ' The owner copy didn’t send.'}` : `Offer v${version} is saved as sent, but the email didn’t go out. Copy the link and send it yourself.`;
      saved = false; root.dataset.updated = ''; root.dataset.sentVersion = String(version); root.dataset.sentUpdated = result.updatedAt; root.dataset.revoked = 'false';
      root.querySelector<HTMLElement>('[data-link-actions]')!.hidden = false; root.querySelector<HTMLButtonElement>('[data-revoke-link]')!.disabled = false;
      root.querySelector<HTMLElement>('[data-link-state]')!.textContent = ''; root.querySelector<HTMLElement>('[data-offer-state]')!.textContent = `v${version} sent · no changes since`; updateControls();
      if (persistedLink) { sessionValue(flashKey, status.textContent); location.reload(); }
      else { root.removeAttribute('inert'); root.removeAttribute('aria-busy'); root.dataset.busy = 'false'; status.textContent += ' Copy the link before reloading; browser storage is unavailable.'; }
    } catch (error) { status.textContent = (error as Error).message; root.removeAttribute('inert'); root.removeAttribute('aria-busy'); root.dataset.busy = 'false'; updateControls(); }
  });
  root.querySelector('[data-copy-link]')!.addEventListener('click', async () => {
    try { if (!link || root.dataset.revoked === 'true') { status.textContent = 'The link is only available in the browser that sent it. Revoke and send again to issue a new link.'; return; } await navigator.clipboard.writeText(link); status.textContent = 'Client link copied.'; }
    catch { status.textContent = 'Clipboard unavailable. Try again in a secure browser.'; }
  });
  root.querySelector<HTMLButtonElement>('[data-revoke-link]')!.addEventListener('click', async event => {
    if (!confirm('Revoke the client link? Anyone using it will lose access.')) return;
    if (changed && !confirm('Revoking reloads this page and discards unsaved offer edits. Continue?')) return;
    const button = event.currentTarget as HTMLButtonElement; button.disabled = true; root.setAttribute('inert', ''); root.setAttribute('aria-busy', 'true'); root.dataset.busy = 'true';
    try { await post(endpoint, { action: 'revoke' }); sessionValue(`software-link:${endpoint}`, null); location.reload(); }
    catch (error) { status.textContent = (error as Error).message; button.disabled = false; root.removeAttribute('inert'); root.removeAttribute('aria-busy'); root.dataset.busy = 'false'; }
  });
  updateControls();
}
