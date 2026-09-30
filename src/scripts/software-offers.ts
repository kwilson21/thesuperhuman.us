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
    let parsed: unknown;
    try { parsed = await response.json(); }
    catch { throw new Error(response.status === 401 || response.status === 403 ? 'Your owner session ended. Reload the page to sign in again.' : 'Something went wrong. Nothing was saved. Try again.'); }
    const result = parsed as { message?: string; errors?: Record<string,string>; version: number; updatedAt: string; sentAt?: string; link: string; emailSent: boolean; uncertain?: boolean; copySent?: boolean };
    if (!response.ok) {
      if (response.status === 409 && (body as { action?: string }).action === 'draft' && 'updatedAt' in result) {
        const editor = document.querySelector<HTMLElement>('[data-software-editor]');
        if (editor) editor.dataset.updated = result.updatedAt ?? '';
      }
      const form = document.querySelector<HTMLElement>('[data-offer-form]');
      const messages = Object.entries(result.errors ?? {}).map(([path, message]) => {
        const parts = path.split('.');
        const milestone = parts[0] === 'milestones' && /^\d+$/.test(parts[1] ?? '');
        const scope = milestone ? document.querySelectorAll<HTMLElement>('[data-milestone]')[Number(parts[1])] : form;
        const field = parts.at(-1)!;
        const names: Record<string, string> = { name: 'milestoneName', feeCents: 'fee', label: 'checkpointLabel', cancellationPercent: 'checkpointPercent', lowCents: 'rangeLow', highCents: 'rangeHigh' };
        const key = milestone ? parts[2] === 'checkpoint' ? parts[3] : parts[2] : field;
        const labels: Record<string, string> = { outcome: 'Outcome', summary: 'Summary', milestones: 'Milestones', name: 'name', deliverables: 'deliverables', acceptance: 'acceptance examples', feeCents: 'fee', label: 'checkpoint label', cancellationPercent: 'checkpoint percent', clientInputs: 'What you need from them', exclusions: 'Outside this offer', timing: 'Timing', paymentMode: 'Payment mode', lowCents: 'Range low', highCents: 'Range high' };
        scope?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(`[name="${names[key] ?? key}"]`).forEach(input => input.setAttribute('aria-invalid', 'true'));
        return `${milestone ? `Milestone ${Number(parts[1]) + 1} ` : ''}${labels[key] ?? 'Offer'}: ${message}`;
      });
      throw new Error(result.message ?? (messages.join('\n') || 'Could not save. Try again.'));
    }
    return result;
  };
  const editableForms = [...document.querySelectorAll<HTMLFormElement>('[data-software-action], [data-request-note]')];
  editableForms.forEach(form => form.addEventListener('input', () => {
    form.dataset.dirty = 'true';
    form.dataset.revision = String(Number(form.dataset.revision ?? 0) + 1);
  }));
  let reloading = false;
  const hasUnsavedChanges = () => editableForms.some(form => form.dataset.dirty === 'true')
    || document.querySelector<HTMLElement>('[data-software-editor]')?.dataset.dirty === 'true';
  const reload = (status: HTMLElement, submitted?: HTMLFormElement) => {
    if (hasUnsavedChanges() && !confirm('You have unsaved changes in another section. Continue and lose them?')) return;
    reloading = true;
    sessionValue(`software-flash:${submitted?.dataset.endpoint ?? document.querySelector<HTMLElement>('[data-software-editor]')?.dataset.endpoint}`, status.textContent);
    location.reload();
  };
  window.addEventListener('beforeunload', event => {
    if (!reloading && hasUnsavedChanges()) event.preventDefault();
  });
  document.querySelectorAll<HTMLFormElement>('[data-software-action]').forEach(form => {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const requestPage = document.querySelector<HTMLElement>('[data-request-id]');
      if (requestPage?.dataset.offerSending === 'true') return;
      const action = form.dataset.softwareAction!, data = new FormData(form), status = form.querySelector<HTMLElement>('[data-software-status]')!;
      if (action === 'decline' && !confirm('Send this message and decline the inquiry?')) return;
      const button = form.querySelector<HTMLButtonElement>('button')!; button.disabled = true;
      const revision = form.dataset.revision;
      try {
        const result = await post(form.dataset.endpoint!, { action, ...Object.fromEntries(data), expectedRequestUpdatedAt: requestPage?.dataset.requestUpdated });
        if (action === 'fit' && requestPage) requestPage.dataset.requestUpdated = result.updatedAt;
        status.textContent = result.copySent === false ? 'Sent to the client. The owner copy didn’t send.' : action === 'fit' ? 'Fit review saved.' : 'Sent.';
        if (form.dataset.revision === revision) form.dataset.dirty = 'false';
        reload(status, form);
      } catch (error) { status.textContent = (error as Error).message; }
      finally { button.disabled = false; }
    });
  });
  const root = document.querySelector<HTMLElement>('[data-software-editor]');
  if (!root) return;
  const status = root.querySelector<HTMLElement>('[data-software-status]')!;
  const endpoint = root.dataset.endpoint!;
  const flashKey = `software-flash:${endpoint}`;
  const flash = sessionValue(flashKey);
  if (flash) { status.textContent = flash; sessionValue(flashKey, null); }
  let link = '';
  let changed = false;
  const linkInput = root.querySelector<HTMLInputElement>('[data-client-link]')!;
  linkInput.addEventListener('focus', () => linkInput.select());
  root.querySelector('[data-copy-link]')!.addEventListener('click', async () => {
    try { if (!link || root.dataset.revoked === 'true') { status.textContent = 'The client link is in your copy of the offer email. To issue a new one, revoke this link and send again.'; return; } await navigator.clipboard.writeText(link); status.textContent = 'Client link copied.'; }
    catch { status.textContent = 'Clipboard unavailable. Select and copy the link in the Client link field.'; }
  });
  root.querySelector<HTMLButtonElement>('[data-revoke-link]')!.addEventListener('click', async event => {
    if (!confirm('Revoke the client link? Anyone using it will lose access.')) return;
    const button = event.currentTarget as HTMLButtonElement; button.disabled = true; root.setAttribute('inert', ''); root.setAttribute('aria-busy', 'true'); root.dataset.busy = 'true';
    try { await post(endpoint, { action: 'revoke' }); link = ''; root.dataset.revoked = 'true'; linkInput.value = ''; status.textContent = 'Client link revoked.'; reload(status); }
    catch (error) { status.textContent = (error as Error).message; }
    finally { button.disabled = false; root.removeAttribute('inert'); root.removeAttribute('aria-busy'); root.dataset.busy = 'false'; }
  });
  if (!root.querySelector('[data-offer-form]')) return;
  const form = root.querySelector<HTMLFormElement>('[data-offer-form]')!, list = root.querySelector<HTMLElement>('[data-milestones]')!;
  const send = root.querySelector<HTMLButtonElement>('[data-send-offer]')!, preview = root.querySelector<HTMLAnchorElement>('[data-preview-offer]')!;
  let saved = Boolean(root.dataset.updated), inputRevision = 0;
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
    list.querySelectorAll<HTMLElement>('[data-milestone]').forEach((row, index) => {
      row.querySelector('legend')!.textContent = `Milestone ${index + 1}`;
      row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[name]').forEach(input => {
        input.id = `milestone-${index + 1}-${input.name}`;
        if (input.hasAttribute('aria-describedby')) input.setAttribute('aria-describedby', `${input.id}-hint`);
      });
      row.querySelectorAll<HTMLElement>('[data-hint]').forEach(hint => { hint.id = `milestone-${index + 1}-${hint.dataset.hint}-hint`; });
      const active = checked(row, 'hasCheckpoint'), block = row.querySelector<HTMLElement>('[data-checkpoint]')!;
      block.hidden = !active;
      block.querySelectorAll<HTMLInputElement>('input').forEach(input => { input.disabled = !active; input.required = active; });
    });
    const rangeActive = checked(form, 'hasRange'), range = root.querySelector<HTMLElement>('[data-range]')!; range.hidden = !rangeActive; range.querySelectorAll<HTMLInputElement>('input').forEach(input => { input.disabled = !rangeActive; input.required = rangeActive; });
    send.disabled = changed || !(saved || (root.dataset.sentVersion && root.dataset.revoked === 'true'));
    preview.hidden = !saved || changed;
  };
  form.addEventListener('input', event => {
    const input = event.target as HTMLInputElement;
    input?.removeAttribute('aria-invalid');
    if (input?.type === 'radio') form.querySelectorAll<HTMLInputElement>(`[name="${input.name}"]`).forEach(radio => radio.removeAttribute('aria-invalid'));
    changed = true; inputRevision++; updateControls();
  });
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
    const requestPage = document.querySelector<HTMLElement>('[data-request-id]') ?? root;
    requestPage.setAttribute('inert', ''); requestPage.dataset.offerSending = 'true';
    send.disabled = true; root.setAttribute('inert', ''); root.setAttribute('aria-busy', 'true'); root.dataset.busy = 'true';
    try { const result = await post(endpoint, { action: 'send', version, expectedUpdatedAt: saved ? root.dataset.updated : root.dataset.sentUpdated });
      link = result.link; linkInput.value = link; root.querySelector<HTMLElement>('[data-client-link-field]')!.hidden = false;
      status.textContent = result.uncertain ? `Offer v${version} is saved as sent. The email service didn’t confirm delivery. Check Resend before sending the link yourself.` : result.emailSent ? `Offer v${version} sent.${result.copySent ? '' : ' The owner copy didn’t send.'}` : `Offer v${version} is saved as sent, but the email didn’t go out. Copy the link and send it yourself.`;
      root.dataset.sentDate = new Date(result.sentAt ?? new Date().toISOString()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
      saved = false; root.dataset.updated = ''; root.dataset.sentVersion = String(version); root.dataset.sentUpdated = result.updatedAt; root.dataset.revoked = 'false';
      root.querySelector<HTMLElement>('[data-link-actions]')!.hidden = false; root.querySelector<HTMLElement>('[data-copy-link]')!.hidden = false; root.querySelector<HTMLButtonElement>('[data-revoke-link]')!.disabled = false;
      root.querySelector<HTMLElement>('[data-link-state]')!.textContent = ''; root.querySelector<HTMLElement>('[data-offer-state]')!.textContent = `v${version} sent ${root.dataset.sentDate} · no changes since`; updateControls();
      const versions = root.querySelector<HTMLElement>('[data-offer-versions]')!, versionList = root.querySelector<HTMLElement>('[data-version-list]')!;
      versions.hidden = false;
      versionList.querySelectorAll<HTMLElement>('[data-version-status]').forEach(value => { if (value.textContent === 'sent') value.textContent = 'superseded'; });
      let entry = versionList.querySelector<HTMLElement>(`[data-version="${version}"]`);
      if (!entry) {
        entry = document.createElement('li'); entry.dataset.version = String(version);
        const anchor = document.createElement('a'); anchor.href = `${root.dataset.preview}?version=${version}`; anchor.target = '_blank'; anchor.rel = 'noopener'; anchor.textContent = `Offer v${version}`;
        entry.appendChild(anchor); entry.appendChild(document.createTextNode(` · ${root.dataset.sentDate} · `));
        const state = document.createElement('span'); state.dataset.versionStatus = ''; entry.appendChild(state); versionList.insertBefore(entry, versionList.firstChild);
      }
      entry.querySelector<HTMLElement>('[data-version-status]')!.textContent = 'sent';
      root.removeAttribute('inert'); root.removeAttribute('aria-busy'); root.dataset.busy = 'false';
    } catch (error) { status.textContent = (error as Error).message; root.removeAttribute('inert'); root.removeAttribute('aria-busy'); root.dataset.busy = 'false'; updateControls(); }
    finally { requestPage.removeAttribute('inert'); requestPage.dataset.offerSending = 'false'; }
  });
  updateControls();
}
