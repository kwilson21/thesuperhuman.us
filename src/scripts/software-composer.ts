import { evidenceTypes, softwareDate } from '~/lib/software-projects';
export function setupSoftwareComposer() {
  const root = document.querySelector<HTMLElement>('[data-software-composer]'); if (!root) return;
  const form = root.querySelector<HTMLFormElement>('[data-update-form]')!, preview = root.querySelector<HTMLElement>('.client-preview')!;
  const status = root.querySelector<HTMLElement>('[data-composer-status]')!, file = form.querySelector<HTMLInputElement>('[name=visual]')!;
  const email = form.querySelector<HTMLInputElement>('[name=email_client]')!, alt = form.querySelector<HTMLInputElement>('[name=visual_alt]')!;
  let emailChosen = Boolean(root.dataset.id), hasVisual = Boolean(preview.querySelector<HTMLImageElement>('[data-preview-image]')?.getAttribute('src'));
  let objectUrl: string | undefined, busy = false;
  const value = (key: string) => (form.elements.namedItem(key) as HTMLInputElement).value;
  const text = (selector: string, content: string) => { const element = preview.querySelector(selector); if (element) element.textContent = content; };
  function render() {
    const evidence = value('evidence_type') as keyof typeof evidenceTypes;
    text('[data-preview-kicker]', [evidenceTypes[evidence], value('artifact_version'), evidence === 'concept' ? 'Not implemented' : ''].filter(Boolean).join(' · '));
    text('[data-preview-title]', value('title') || 'Untitled update'); preview.querySelector('[data-preview-title]')?.classList.toggle('rail-muted', !value('title')); text('[data-preview-caption]', evidence === 'concept' ? 'Illustrative concept' : value('artifact_version'));
    const image = preview.querySelector<HTMLImageElement>('[data-preview-image]')!; image.alt = alt.value;
    for (const key of ['what_changed','checks_limitations','client_request','next_step']) {
      text(`[data-preview-text=${key}]`, value(key)); preview.querySelector<HTMLElement>(`[data-preview-section=${key}]`)!.hidden = !value(key);
    }
    let href = ''; try { const url = new URL(value('preview_url')); if (url.protocol === 'https:' && !url.username && !url.password) href = url.href; } catch { /* No preview until the URL is valid. */ }
    const link = preview.querySelector<HTMLAnchorElement>('[data-preview-link]')!; if (href) link.href = href; else link.removeAttribute('href');
    preview.querySelector<HTMLElement>('[data-preview-link-row]')!.hidden = !href;
    const date = preview.querySelector<HTMLElement>('[data-preview-date]')!; date.hidden = !value('next_update_on'); text('[data-preview-date] span', value('next_update_on') ? softwareDate(value('next_update_on')) : '');
    if (!emailChosen) email.checked = Boolean(value('client_request').trim());
    alt.required = hasVisual || Boolean(file.files?.length);
  }
  form.addEventListener('input', render); email.addEventListener('change', () => { emailChosen = true; });
  file.addEventListener('change', () => {
    const image = file.files?.[0]; if (!image) return;
    if (image.size > 5 * 1024 * 1024 || !['image/png','image/jpeg','image/webp'].includes(image.type)) { status.textContent = 'Choose a PNG, JPEG or WebP of 5 MB or less.'; file.value = ''; return; }
    const name = form.querySelector('[data-visual-name]'); if (name) name.textContent = image.name;
    if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = URL.createObjectURL(image);
    preview.querySelector<HTMLImageElement>('[data-preview-image]')!.src = objectUrl;
    preview.querySelector<HTMLElement>('[data-preview-figure]')!.hidden = false; render();
  });
  async function save(share: boolean) {
    if (busy || (share && !form.reportValidity())) return;
    if ((file.files?.length || hasVisual) && !alt.value.trim()) { status.textContent = 'Describe the visual for the client.'; alt.focus(); return; }
    if (share && !confirm('Share this update on the client’s project page?')) return;
    busy = true; form.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.disabled = true);
    try {
      const update = { ...Object.fromEntries(new FormData(form)), milestone_index: Number(value('milestone_index')), email_client: email.checked }; delete (update as Record<string, unknown>).visual;
      async function write(action: 'draft' | 'share') {
        const response = await fetch(root!.dataset.endpoint!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, update, expectedUpdatedAt: root!.dataset.updatedAt || null, confirmed: action === 'share' }) });
        const result = await response.json() as { id: string; updatedAt: string; error?: string };
        if (!response.ok) throw new Error(result.error ?? 'Could not save the update.');
        root!.dataset.id = result.id; root!.dataset.updatedAt = result.updatedAt;
      }
      // Save the description and claim a draft id before putting a private image.
      if (file.files?.[0]) {
        await write('draft');
        const response = await fetch(`${root!.dataset.endpoint}/${root!.dataset.id}/visual`, { method: 'PUT', headers: { 'content-type': file.files[0].type, 'if-unmodified-since': root!.dataset.updatedAt! }, body: file.files[0] });
        const result = await response.json() as { updatedAt: string; error?: string; cleanupPending?: boolean };
        if (!response.ok) throw new Error(result.error ?? 'Could not upload the visual.');
        root!.dataset.updatedAt = result.updatedAt; hasVisual = true; file.value = '';
        if (result.cleanupPending) { status.textContent = result.error!; return; }
      }
      await write(share ? 'share' : 'draft');
      if (share) { location.assign(root!.dataset.endpoint!.replace('/api','').replace('/updates','')); return; }
      status.textContent = 'Draft saved. Not shared.';
    } catch (error) { status.textContent = error instanceof Error ? error.message : 'Could not save. Please try again.'; }
    finally { busy = false; form.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.disabled = false); }
  }
  form.addEventListener('submit', event => { event.preventDefault(); void save(true); });
  root.querySelector('[data-save-draft]')?.addEventListener('click', () => { void save(false); }); render();
}
