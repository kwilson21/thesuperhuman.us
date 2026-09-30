import { evidenceTypes, softwareDate } from '~/lib/software-projects';
import { addBusinessDays } from '~/lib/business-days';
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
    const kind = value('kind'), milestone = value('milestone_index'), delivery = kind === 'delivery_review', handoff = kind === 'handoff';
    const field = (name:string) => form.elements.namedItem(name) as HTMLInputElement;
    form.querySelector<HTMLElement>('[data-kind-hint]')!.textContent = kind === 'direction_review' ? 'Ask the client to confirm a design direction. It doesn’t accept working software.' : delivery ? 'Share a named version with evidence for every acceptance check. The client accepts it or names what’s unmet.' : handoff ? 'Share the delivered files after the milestone is paid in full.' : 'Share progress and the next step.';
    field('artifact_version').required = kind.endsWith('_review');
    field('artifact_version').placeholder = kind === 'direction_review' ? 'Direction v1' : delivery ? 'Delivery v1' : 'Prototype v1';
    form.querySelector<HTMLElement>('[data-delivery-fields]')!.hidden = !delivery;
    form.querySelectorAll<HTMLFieldSetElement>('[data-criteria-group]').forEach(group=>{
      group.hidden = group.dataset.criteriaGroup !== milestone; group.disabled = !delivery || group.hidden;
      group.querySelectorAll<HTMLTextAreaElement>('textarea').forEach(input=>input.required=delivery && !group.hidden);
    });
    field('review_window_days').disabled = !delivery;
    const handoffFields = form.querySelector<HTMLElement>('[data-handoff-fields]')!;
    handoffFields.hidden = !handoff;
    const accepted = JSON.parse(handoffFields.dataset.accepted!) as boolean[];
    form.querySelector<HTMLOptionElement>('[name=kind] option[value=handoff]')!.disabled = !accepted[Number(milestone)];
    form.querySelector<HTMLElement>('[data-handoff-unavailable]')!.hidden = !handoff || accepted[Number(milestone)];
    field('paid_confirmed').required = handoff;
    form.querySelectorAll<HTMLInputElement>('[name=link_label],[name=link_url]').forEach(input=>{
      input.disabled = !handoff || input.closest<HTMLElement>('[data-handoff-link]')!.hidden;
      input.required = handoff && !input.disabled;
    });
    field('checks_limitations').required = handoff; field('next_step').required = handoff;
    field('next_step').placeholder = handoff ? 'Corrections within the correction period. Anything new is a separate milestone.' : '';
    form.querySelector('[data-changed-label]')!.textContent = handoff ? 'What’s delivered' : 'What changed';
    form.querySelector('[data-limitations-label]')!.textContent = handoff ? 'Limitations and what’s outside scope' : 'Checks and limitations';
    form.querySelector('[data-next-label]')!.textContent = handoff ? 'Support boundary' : 'Next step';
    const reviewDate = preview.querySelector<HTMLElement>('[data-preview-review-date]')!;
    const days = Number(value('review_window_days'));
    reviewDate.hidden = !delivery || !Number.isInteger(days) || days < 5 || days > 30;
    reviewDate.textContent = reviewDate.hidden ? '' : `Please review by ${softwareDate(addBusinessDays(new Date().toISOString(),days))}.`;
    preview.querySelector<HTMLElement>('[data-preview-checks]')!.hidden = !delivery;
    const evidenceFields = form.querySelectorAll<HTMLTextAreaElement>(`[data-criteria-group="${milestone}"] textarea`);
    preview.querySelectorAll<HTMLElement>('[data-preview-criteria]').forEach(group=>{
      group.hidden = group.dataset.previewCriteria !== milestone;
      if (!group.hidden) group.querySelectorAll<HTMLElement>('[data-preview-evidence]').forEach((item,index)=>item.textContent=evidenceFields[index]?.value ?? '');
    });
    const linkRows=form.querySelectorAll<HTMLElement>('[data-handoff-link]');
    preview.querySelector<HTMLElement>('[data-preview-handoff]')!.hidden=!handoff;
    preview.querySelectorAll<HTMLElement>('[data-preview-handoff] li').forEach((row,index)=>{
      const label=linkRows[index].querySelector<HTMLInputElement>('[name=link_label]')!.value,url=linkRows[index].querySelector<HTMLInputElement>('[name=link_url]')!.value;
      let href='';try {const parsed=new URL(url);if(parsed.protocol==='https:' && !parsed.username && !parsed.password) href=parsed.href;} catch { }
      row.hidden=linkRows[index].hidden || !href;const anchor=row.querySelector('a')!;anchor.textContent=label;
      if(href) anchor.href=href;else anchor.removeAttribute('href');
    });
    const evidence = value('evidence_type') as keyof typeof evidenceTypes;
    text('[data-preview-kicker]', [handoff ? 'Handoff' : evidenceTypes[evidence], value('artifact_version'), !handoff && evidence === 'concept' ? 'Not implemented' : ''].filter(Boolean).join(' · '));
    text('[data-preview-title]', value('title') || 'Untitled update'); preview.querySelector('[data-preview-title]')?.classList.toggle('rail-muted', !value('title')); text('[data-preview-caption]', evidence === 'concept' ? 'Illustrative concept' : value('artifact_version'));
    const image = preview.querySelector<HTMLImageElement>('[data-preview-image]')!; image.alt = alt.value;
    for (const key of ['what_changed','checks_limitations','client_request','next_step']) {
      text(`[data-preview-text=${key}]`, value(key)); preview.querySelector<HTMLElement>(`[data-preview-section=${key}]`)!.hidden = !value(key);
    }
    let href = ''; try { const url = new URL(value('preview_url')); if (url.protocol === 'https:' && !url.username && !url.password) href = url.href; } catch { /* No preview until the URL is valid. */ }
    const link = preview.querySelector<HTMLAnchorElement>('[data-preview-link]')!; if (href) link.href = href; else link.removeAttribute('href');
    preview.querySelector<HTMLElement>('[data-preview-link-row]')!.hidden = !href;
    const date = preview.querySelector<HTMLElement>('[data-preview-date]')!; date.hidden = !value('next_update_on'); text('[data-preview-date] span', value('next_update_on') ? softwareDate(value('next_update_on')) : '');
    if (!emailChosen) email.checked = kind !== 'progress' || Boolean(value('client_request').trim());
    alt.required = hasVisual || Boolean(file.files?.length);
  }
  form.addEventListener('input', render); email.addEventListener('change', () => { emailChosen = true; });
  form.querySelector('[name=kind]')?.addEventListener('change',()=>{emailChosen=false;render();});
  form.querySelector('[data-add-link]')?.addEventListener('click',()=>{
    const next = form.querySelector<HTMLElement>('[data-handoff-link][hidden]'); if (next) next.hidden=false;
    form.querySelector<HTMLButtonElement>('[data-add-link]')!.disabled = !form.querySelector('[data-handoff-link][hidden]'); render();
  });
  const drop = file.closest<HTMLElement>('.drop');
  drop?.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('dragging'); });
  drop?.addEventListener('dragleave', () => drop.classList.remove('dragging'));
  drop?.addEventListener('drop', event => {
    event.preventDefault(); drop.classList.remove('dragging');
    if (event.dataTransfer?.files.length) { file.files = event.dataTransfer.files; file.dispatchEvent(new Event('change')); }
  });
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
      const data = new FormData(form);
      const labels = data.getAll('link_label'), urls = data.getAll('link_url');
      const update = { ...Object.fromEntries(data), milestone_index: Number(value('milestone_index')), email_client: email.checked,
        criteria:data.getAll('criteria'),review_window_days:Number(value('review_window_days')),paid_confirmed:data.has('paid_confirmed'),
        links:labels.map((label,index)=>({label:String(label),url:String(urls[index] ?? '')})).filter(link=>link.label || link.url) }; delete (update as Record<string, unknown>).visual;
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
