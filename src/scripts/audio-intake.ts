import { audioOffers, directionFields, describePreferences, validateIntake, type IntakeService, type Direction, type IntakeInput } from '../lib/audio-intake';
import { setupFormSubmission } from './form-submission';

const form = document.querySelector<HTMLFormElement>('#song-intake');
if (form) {
  const steps = [...form.querySelectorAll<HTMLElement>('[data-step]')];
  const next = form.querySelector<HTMLButtonElement>('[data-next]')!;
  const back = form.querySelector<HTMLButtonElement>('[data-back]')!;
  const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
  const status = form.querySelector<HTMLElement>('[data-form-status]')!;
  let step = 0;
  const payload = (data: FormData): Omit<IntakeInput, 'turnstileToken' | 'permission'> & {permission: boolean} => {
    const service = String(data.get('service')) as IntakeService;
    const direction = String(data.get('direction')) as Direction;
    const preferences = direction === 'preferences' ? Object.fromEntries(directionFields(service).map(field => [field.id, String(data.get(`pref-${service}-${field.id}`) ?? 'decide')])) : {};
    return { service, direction, preferences, title: String(data.get('title') ?? '').trim(), fileLink: String(data.get('fileLink') ?? '').trim(), preserve: String(data.get('preserve') ?? '').trim(), referenceUrl: String(data.get('referenceUrl') ?? '').trim(), referenceNote: String(data.get('referenceNote') ?? '').trim(), name: String(data.get('name') ?? '').trim(), email: String(data.get('email') ?? '').trim(), permission: data.get('permission') === 'on' };
  };
  function renderService() {
    const data = new FormData(form!);
    const service = String(data.get('service')) as IntakeService;
    const offer = audioOffers[service];
    form!.querySelector('[data-offer-name]')!.textContent = offer.name;
    form!.querySelector('[data-offer-description]')!.textContent = offer.description;
    form!.querySelector('[data-offer-scope]')!.textContent = offer.scope;
    form!.querySelector('[data-files-heading]')!.textContent = service === 'mastering' ? 'Finished stereo mix' : service === 'custom' ? 'Your files (optional)' : 'Beat + vocal tracks';
    form!.querySelector('[data-title-label]')!.textContent = service === 'custom' ? 'Song or project title' : 'Song title (working title)';
    form!.querySelector<HTMLInputElement>('[name=fileLink]')!.required = service !== 'custom';
    form!.querySelector<HTMLTextAreaElement>('[name=referenceNote]')!.required = service === 'custom';
    form!.querySelector('[data-files-needed]')!.textContent = offer.files;
    form!.querySelector('[data-preparation]')!.textContent = offer.preparation;
    form!.querySelector('[data-note-label]')!.textContent = service === 'custom' ? 'Tell me about your project' : 'Notes about your direction (optional)';
    form!.querySelectorAll<HTMLElement>('[data-service-preferences]').forEach(group => group.hidden = group.dataset.servicePreferences !== service);
    const direction = data.get('direction');
    form!.querySelector<HTMLElement>('[data-preferences]')!.hidden = direction !== 'preferences';
    form!.querySelector('[data-reference-summary]')!.textContent = service === 'custom' ? 'Tell me about your project' : 'Add a reference or note (optional)';
    if (service === 'custom' || direction === 'specific') form!.querySelector<HTMLDetailsElement>('[data-reference-fields]')!.open = true;
  }
  function renderReview() {
    const input = payload(new FormData(form!));
    const offer = audioOffers[input.service];
    const selected = describePreferences(input.service, input.preferences);
    const rows = [
      ['Service', `${offer.name}${offer.price ? ` · from $${offer.price} USD` : ' · custom quote'}`],
      ['Song / project', input.title], ['Files', input.fileLink || 'No files yet; custom inquiry'],
      ['Creative direction', input.direction === 'judgment' ? 'Use your judgment.' : input.direction === 'preferences' ? [...selected, 'Other choices: use your judgment.'].join('\n') : 'Specific direction shared below; other choices left to your judgment.'],
      ['Reference', input.referenceUrl], ['Notes', input.referenceNote], ['Preserve / avoid', input.preserve],
    ];
    const list = form!.querySelector<HTMLDListElement>('[data-review]')!;
    list.replaceChildren();
    for (const [label, value] of rows) {
      if (!value) continue;
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = label; dd.textContent = value; list.appendChild(dt); list.appendChild(dd);
    }
  }
  function showStep(index: number, focus = true) {
    step = index;
    steps.forEach((section, i) => section.hidden = i !== index);
    document.querySelectorAll('.intake-progress li').forEach((item,i) => i === index ? item.setAttribute('aria-current','step') : item.removeAttribute('aria-current'));
    next.hidden = index === 2; submit.hidden = index !== 2; back.hidden = index === 0;
    if (index === 2) renderReview();
    next.textContent = index === 1 ? 'Review request' : 'Continue';
    if (focus) steps[index].querySelector<HTMLElement>('h1')!.focus();
  }
  function validateStep(): boolean {
    const input = payload(new FormData(form!));
    // Contact details and captcha are only required on the final step.
    const validation = validateIntake({ ...input, name: 'Preview', email: 'preview@example.com', permission: true, turnstileToken: 'pending' });
    const fields = step === 0 ? ['service'] : ['title','fileLink','referenceUrl','referenceNote','preserve','preferences'];
    const errors: Record<string, string> = validation.ok ? {} : validation.errors;
    let first: HTMLElement | null = null;
    for (const field of fields) {
      const error = form!.querySelector<HTMLElement>(`[data-form-error="${field}"]`);
      const control = form!.elements.namedItem(field);
      if (error) { error.textContent = errors[field] ?? ''; error.hidden = !errors[field]; }
      if (control instanceof HTMLElement) {
        control.toggleAttribute('aria-invalid', Boolean(errors[field]));
        if (errors[field]) { control.closest('details')?.setAttribute('open', ''); control.setAttribute('aria-invalid','true'); first ??= control; }
      }
    }
    if (fields.some(field => errors[field])) { status.textContent = 'Please check the highlighted fields.'; (first ?? status).focus(); return false; }
    status.textContent = ''; return true;
  }
  form.addEventListener('change', renderService);
  next.addEventListener('click', () => { if (validateStep()) showStep(step + 1); });
  back.addEventListener('click', () => showStep(Math.max(0, step - 1)));
  form.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach(button => button.addEventListener('click', () => showStep(Number(button.dataset.edit))));
  form.addEventListener('submit', event => { if (step !== 2) { event.preventDefault(); event.stopImmediatePropagation(); if (validateStep()) showStep(step + 1); } });
  setupFormSubmission({ form, endpoint: '/api/audio-intake', payload, success: document.getElementById('intake-success')! });
  // Reveal the earlier step when server validation identifies one of its fields.
  const observer = new MutationObserver(() => {
    const errorStep = steps.findIndex(section => section.hidden && section.querySelector('[aria-invalid="true"]'));
    form!.querySelectorAll<HTMLElement>('[aria-invalid="true"]').forEach(control => control.closest('details')?.setAttribute('open', ''));
    if (errorStep >= 0) { showStep(errorStep, false); steps[errorStep].querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }
  });
  observer.observe(form, { attributes: true, subtree: true, attributeFilter: ['aria-invalid'] });
  const requestedService = new URLSearchParams(location.search).get('service');
  if (requestedService && Object.hasOwn(audioOffers, requestedService)) { const radio = form.querySelector<HTMLInputElement>(`input[name="service"][value="${requestedService}"]`); if(radio) radio.checked = true; }
  renderService(); showStep(0, false);
}
