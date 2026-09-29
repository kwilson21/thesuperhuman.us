import { approverLabels, budgetLabels, softwareLabels, softwarePaths, timingLabels, validateSoftwareInquiry } from '../lib/software-inquiry';
import { setupFormSubmission } from './form-submission';

const form = document.querySelector<HTMLFormElement>('#software-inquiry');
if (form) {
  const steps = [...form.querySelectorAll<HTMLElement>('[data-step]')];
  const next = form.querySelector<HTMLButtonElement>('[data-next]')!;
  const back = form.querySelector<HTMLButtonElement>('[data-back]')!;
  const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
  const status = form.querySelector<HTMLElement>('[data-form-status]')!;
  let step = 0;
  let submissionId = crypto.randomUUID();
  const keys = Object.keys(softwareLabels) as (keyof typeof softwareLabels)[];
  const payload = (data: FormData) => Object.fromEntries(keys.map(key => [key, String(data.get(key) ?? '').trim()]));
  const labelled = (input: Record<string, string>) => ({
    ...input,
    path: softwarePaths[input.path as keyof typeof softwarePaths] ?? input.path,
    timing: timingLabels[input.timing as keyof typeof timingLabels] ?? input.timing,
    budgetStatus: budgetLabels[input.budgetStatus as keyof typeof budgetLabels] ?? input.budgetStatus,
    approver: approverLabels[input.approver as keyof typeof approverLabels] ?? input.approver,
    approverRole: input.approver === 'other' ? input.approverRole : '',
  });
  function renderRows(list: HTMLDListElement, values: Record<string, string>) {
    list.replaceChildren();
    for (const key of keys) {
      if (key === 'approverRole' && values.approver !== approverLabels.other) continue;
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = softwareLabels[key];
      dd.textContent = values[key] || 'Not provided';
      list.appendChild(dt); list.appendChild(dd);
    }
  }
  function showStep(index: number, focus = true) {
    step = index;
    steps.forEach((section, i) => section.hidden = i !== index);
    document.querySelectorAll('.intake-progress li').forEach((item, i) => i === index ? item.setAttribute('aria-current', 'step') : item.removeAttribute('aria-current'));
    next.hidden = index === 2; submit.hidden = index !== 2; back.hidden = index === 0;
    next.textContent = index === 1 ? 'Review brief' : 'Continue';
    if (index === 2) renderRows(form!.querySelector('[data-review]')!, labelled(payload(new FormData(form!))));
    if (focus) steps[index].querySelector<HTMLElement>('h1')!.focus();
  }
  function validateStep() {
    const input = payload(new FormData(form!));
    const result = validateSoftwareInquiry({ ...input, name: step === 0 ? 'Preview' : input.name, email: step === 0 ? 'preview@example.com' : input.email, turnstileToken: 'pending', submissionId });
    const errors: Record<string, string> = result.ok ? {} : result.errors;
    const fields = step === 0 ? ['path', 'today', 'audience', 'firstResult'] : ['name', 'email', 'company', 'timing', 'timingReason', 'budgetStatus', 'budgetNote', 'approver', 'approverRole'];
    let first: HTMLElement | null = null;
    for (const field of fields) {
      const error = form!.querySelector<HTMLElement>(`[data-form-error="${field}"]`);
      const control = form!.elements.namedItem(field);
      const message = errors[field];
      if (error) { error.textContent = message ?? ''; error.hidden = !message; }
      if (control instanceof HTMLElement) {
        if (message) control.setAttribute('aria-invalid', 'true');
        else control.removeAttribute('aria-invalid');
        if (message) first ??= control;
      }
    }
    if (first) { status.textContent = 'Please check the highlighted fields.'; first.focus(); return false; }
    status.textContent = ''; return true;
  }
  function approverRole() {
    const other = new FormData(form!).get('approver') === 'other';
    form!.querySelector<HTMLElement>('[data-approver-role]')!.hidden = !other;
  }
  form.addEventListener('change', approverRole);
  next.addEventListener('click', () => { if (validateStep()) showStep(step + 1); });
  back.addEventListener('click', () => showStep(Math.max(0, step - 1)));
  form.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach(button => button.addEventListener('click', () => showStep(Number(button.dataset.edit))));
  form.addEventListener('submit', event => { if (step !== 2) { event.preventDefault(); event.stopImmediatePropagation(); if (validateStep()) showStep(step + 1); } });
  setupFormSubmission({
    form, endpoint: '/api/software-inquiry', success: document.getElementById('software-success')!,
    payload: data => ({ ...payload(data), submissionId }),
    onSuccess: result => renderRows(document.querySelector('[data-receipt]')!, result.brief && typeof result.brief === 'object' && !Array.isArray(result.brief) ? result.brief as Record<string, string> : {}),
    onConflict: () => { submissionId = crypto.randomUUID(); },
  });
  const observer = new MutationObserver(() => {
    const errorStep = steps.findIndex(section => section.hidden && section.querySelector('[aria-invalid="true"]'));
    if (errorStep >= 0) { showStep(errorStep, false); steps[errorStep].querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }
  });
  observer.observe(form, { attributes: true, subtree: true, attributeFilter: ['aria-invalid'] });
  document.querySelector<HTMLButtonElement>('[data-print]')?.addEventListener('click', () => window.print());
  approverRole(); showStep(0, false);
}
