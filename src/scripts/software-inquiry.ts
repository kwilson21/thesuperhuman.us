import { approverLabels, budgetLabels, softwareDetailKeys, softwareLabels, softwarePaths, softwareQuestions, timingLabels, validateSoftwareInquiry } from '../lib/software-inquiry';
import { setupFormSubmission } from './form-submission';

export function renderSoftwareReceipt(result: Record<string, unknown>) {
  const brief = result.brief && typeof result.brief === 'object' && !Array.isArray(result.brief) ? result.brief as Record<string, string> : {};
  const firstName = brief.name?.trim().split(/\s+/)[0] || 'there';
  document.querySelector<HTMLElement>('[data-receipt-thanks]')!.textContent = `Thanks, ${firstName}. I'll read it myself and reply within two business days.`;
  document.querySelector<HTMLElement>('[data-intake-progress]')!.hidden = true;
  const sent = result.clientCopyStatus === 'sent';
  const uncertain = result.clientCopyStatus === 'uncertain';
  document.querySelector<HTMLElement>('[data-copy-status]')!.textContent = sent
    ? `A copy is on its way to ${brief.email}.`
    : uncertain ? 'Your copy should arrive shortly.'
    : "I couldn't send your copy just now, but your brief is saved and I'll still reply.";
  document.querySelector<HTMLElement>('[data-copy-icon]')!.hidden = !sent && !uncertain;
  const note = document.querySelector<HTMLElement>('[data-copy-note]')!;
  note.hidden = !sent && !uncertain;
  note.textContent = uncertain ? "If it doesn't, your brief is still saved and I'll still reply." : "It has everything you wrote, so you don't need to save this page.";
}

const form = document.querySelector<HTMLFormElement>('#software-inquiry');
if (form) {
  const steps = [...form.querySelectorAll<HTMLElement>('[data-step]')];
  const next = form.querySelector<HTMLButtonElement>('[data-next]')!;
  const back = form.querySelector<HTMLButtonElement>('[data-back]')!;
  const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
  const status = form.querySelector<HTMLElement>('[data-form-status]')!;
  let step = 0;
  let submissionId = crypto.randomUUID();
  const path = () => {
    const value = new FormData(form!).get('path');
    return value === 'idea' || value === 'workflow' ? value : null;
  };
  const keys = (selected: ReturnType<typeof path> = path()) => ['path', ...(selected ? softwareQuestions[selected] : []), ...softwareDetailKeys];
  let nudged = false;
  const payload = (data: FormData) => Object.fromEntries(keys().map(key => [key, String(data.get(key) ?? '').trim()]));
  const labelled = (input: Record<string, string>) => ({
    ...input,
    path: softwarePaths[input.path as keyof typeof softwarePaths] ?? input.path,
    timing: timingLabels[input.timing as keyof typeof timingLabels] ?? input.timing,
    budgetStatus: budgetLabels[input.budgetStatus as keyof typeof budgetLabels] ?? input.budgetStatus,
    approver: approverLabels[input.approver as keyof typeof approverLabels] ?? input.approver,
    approverRole: input.approver === 'other' ? input.approverRole : '',
  });
  function renderRows(list: HTMLDListElement, values: Record<string, string>, selected: ReturnType<typeof path> = path()) {
    list.replaceChildren();
    for (const key of selected ? keys(selected) : ['path', ...softwareQuestions.workflow, ...softwareQuestions.idea, ...softwareDetailKeys].filter(key => key in values)) {
      if (selected && key === 'approverRole' && values.approver !== approverLabels.other) continue;
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = softwareLabels[key as keyof typeof softwareLabels];
      if (!values[key]) continue;
      dd.textContent = values[key];
      list.appendChild(dt); list.appendChild(dd);
    }
  }
  function showStep(index: number, focus = true) {
    step = index;
    steps.forEach((section, i) => section.hidden = i !== index);
    document.querySelectorAll('.intake-progress li').forEach((item, i) => i === index ? item.setAttribute('aria-current', 'step') : item.removeAttribute('aria-current'));
    form!.querySelector<HTMLElement>('[data-send-reassurance]')!.hidden = index !== 2;
    next.hidden = index === 2; submit.hidden = index !== 2; back.hidden = index === 0;
    next.textContent = index === 1 ? 'Review brief' : 'Continue';
    if (index === 2) renderRows(form!.querySelector('[data-review]')!, labelled(payload(new FormData(form!))));
    if (focus) steps[index].querySelector<HTMLElement>('h1')!.focus();
  }
  function validateStep() {
    delete status.dataset.nudge;
    const input = payload(new FormData(form!));
    const result = validateSoftwareInquiry({ ...input, name: step === 0 ? 'Preview' : input.name, email: step === 0 ? 'preview@example.com' : input.email, turnstileToken: 'pending', submissionId });
    const errors: Record<string, string> = result.ok ? {} : result.errors;
    const fields = step === 0 ? ['path', ...(path() ? softwareQuestions[path()!] : [])] : [...softwareDetailKeys];
    let first: HTMLElement | null = null;
    for (const field of fields) {
      const error = form!.querySelector<HTMLElement>(`[data-form-error="${field}"]`);
      const control = field === 'path' ? form!.querySelector<HTMLInputElement>('[name="path"]') : form!.elements.namedItem(field);
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
  function selectedQuestions() {
    const pathError = form!.querySelector<HTMLElement>('[data-form-error="path"]')!;
    pathError.textContent = '';
    pathError.hidden = true;
    form!.querySelectorAll<HTMLInputElement>('[name="path"]').forEach(radio => radio.removeAttribute('aria-invalid'));
    form!.querySelector<HTMLElement>('[data-choose-path]')!.hidden = path() !== null;
    form!.querySelectorAll<HTMLElement>('[data-questions]').forEach(group => {
      const active = group.dataset.questions === path();
      group.hidden = !active;
      group.querySelectorAll<HTMLTextAreaElement>('textarea').forEach(field => {
        field.disabled = !active;
        if (!active) field.removeAttribute('aria-invalid');
      });
      if (!active) group.querySelectorAll<HTMLElement>('[data-form-error]').forEach(error => { error.textContent = ''; error.hidden = true; });
    });
    nudged = false;
    delete status.dataset.nudge;
    status.textContent = '';
  }
  function continueStep() {
    if (!validateStep()) return;
    if (step === 0 && !nudged && (path() === 'workflow' ? ['today', 'firstResult'] : ['idea', 'firstVersion']).some(key => String(new FormData(form!).get(key) ?? '').trim().length < 40)) {
      nudged = true;
      status.dataset.nudge = '';
      status.textContent = 'A little more detail helps me reply with something useful. You can continue anyway.';
      return;
    }
    nudged = false;
    showStep(step + 1);
  }
  form.addEventListener('change', event => { approverRole(); if ((event.target as HTMLInputElement).name === 'path') selectedQuestions(); });
  next.addEventListener('click', continueStep);
  back.addEventListener('click', () => showStep(Math.max(0, step - 1)));
  form.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach(button => button.addEventListener('click', () => showStep(Number(button.dataset.edit))));
  form.addEventListener('submit', event => { if (step !== 2) { event.preventDefault(); event.stopImmediatePropagation(); continueStep(); } });
  setupFormSubmission({
    form, endpoint: '/api/software-inquiry', success: document.getElementById('software-success')!,
    payload: data => ({ ...payload(data), submissionId }),
    onSuccess: renderSoftwareReceipt,
    onConflict: () => { submissionId = crypto.randomUUID(); },
  });
  const observer = new MutationObserver(records => {
    const target = records.map(record => record.target as HTMLElement).find(node => node.getAttribute('aria-invalid') === 'true' && steps.some(section => section.hidden && section.contains(node)));
    const errorStep = target ? steps.findIndex(section => section.hidden && section.contains(target)) : -1;
    if (errorStep >= 0) { showStep(errorStep, false); target!.focus(); }
  });
  observer.observe(form, { attributes: true, subtree: true, attributeFilter: ['aria-invalid'] });
  approverRole(); selectedQuestions(); showStep(0, false);
}
