import { setupBriefAutocomplete } from './brief-autocomplete';
import { softwareLabels, softwarePaths, timingLabels, validateSoftwareInquiry } from '../lib/software-inquiry';
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

export function setupSoftwareInquiry(form: HTMLFormElement) {
  const steps = [...form.querySelectorAll<HTMLElement>('[data-step]')];
  const next = form.querySelector<HTMLButtonElement>('[data-next]')!;
  const back = form.querySelector<HTMLButtonElement>('[data-back]')!;
  const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
  const status = form.querySelector<HTMLElement>('[data-form-status]')!;
  const storageKey = 'software-brief-draft';
  const sentKey = 'software-brief-sent';
  const requestedPath = new FormData(form).get('path');
  const answers: Record<string, string> = {};
  let sentElsewhere = false;
  const sentNotice = 'This brief was already sent from another tab. Your changes here will be sent as a new brief.';
  let step = requestedPath === 'idea' || requestedPath === 'workflow' ? 1 : 0, submissionId = crypto.randomUUID();
  const path = () => new FormData(form).get('path') === 'idea' ? 'idea' : 'workflow';
  const fields = () => ['path', path() === 'idea' ? 'idea' : 'today', path() === 'idea' ? 'firstVersion' : 'firstResult', 'timing', 'timingDate', 'budgetNote', 'name', 'email', 'company'];
  const payload = (trim = true) => Object.fromEntries(fields().map(key => [key, trim ? String(new FormData(form).get(key) ?? '').trim() : String(new FormData(form).get(key) ?? '')]));
  function noticeSentDraft() {
    // Keep the identity stable until the in-flight response has been handled.
    if (form.getAttribute('aria-busy') === 'true') return false;
    try {
      if (localStorage.getItem(sentKey) !== submissionId) return false;
      submissionId = crypto.randomUUID(); sentElsewhere = true; status.textContent = sentNotice;
      return true;
    } catch { return false; }
  }
  function save() {
    noticeSentDraft();
    steps.slice(1, 3).forEach(section => { const box = section.querySelector<HTMLTextAreaElement>('[data-answer]')!; answers[box.name] = box.value; });
    try { localStorage.setItem(storageKey, JSON.stringify({ answers: { ...payload(false), ...answers }, step, submissionId })); } catch { /* Keep writing when storage is unavailable. */ }
  }
  function configureQuestions() {
    const idea = path() === 'idea';
    const questions = idea ? [
      ['idea', "What's the idea?", "Who it's for and what they'd do with it.", 'A simple way for my clients to book and pay for lessons without emailing me.', 1000],
      ['firstVersion', 'Have a first version in mind?', "If you have a hunch. Otherwise I'll propose one.", '', 1000],
    ] : [
      ['today', 'What happens today?', "Who does it, what's slow or error-prone, and what it costs you.", 'We track new clients in a shared spreadsheet. Three of us update it, and follow-ups slip through the cracks.', 2000],
      ['firstResult', 'Have a first result in mind?', "If you have a hunch. Otherwise I'll propose one.", '', 2000],
    ];
    questions.forEach(([key, title, hint, placeholder, max], i) => {
      const section = steps[i + 1], box = section.querySelector<HTMLTextAreaElement>('[data-answer]')!;
      box.name = String(key); box.maxLength = Number(max); box.placeholder = String(placeholder);
      section.querySelector('h1')!.textContent = String(title);
      section.querySelector('[data-answer-label]')!.textContent = String(title);
      section.querySelector('[data-question-hint]')!.textContent = String(hint);
      const error = section.querySelector<HTMLElement>('[data-form-error]')!;
      error.dataset.formError = String(key); error.textContent = ''; error.hidden = true;
      box.removeAttribute('aria-invalid');
    });
  }
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (saved && saved.answers && typeof saved.answers === 'object') {
      for (const key of ['today', 'firstResult', 'idea', 'firstVersion']) if (typeof saved.answers[key] === 'string') answers[key] = saved.answers[key].slice(0, ['idea', 'firstVersion'].includes(key) ? 1000 : 2000);
      for (const name of ['path', 'timing']) form.querySelectorAll<HTMLInputElement>(`[name="${name}"]`).forEach(box => box.checked = box.value === (name === 'path' && requestedPath ? requestedPath : saved.answers[name]));
      configureQuestions();
      for (const key of fields()) {
        const control = form.elements.namedItem(key);
        if ((control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) && typeof saved.answers[key] === 'string') control.value = saved.answers[key].slice(0, control.maxLength > 0 ? control.maxLength : 200);
      }
      if ((!requestedPath || requestedPath === saved.answers.path) && Number.isInteger(saved.step) && saved.step >= 0 && saved.step <= 6) step = saved.step;
      if (typeof saved.submissionId === 'string' && /^[a-f0-9-]{36}$/i.test(saved.submissionId)) submissionId = saved.submissionId;
    }
  } catch { /* Ignore unavailable storage and invalid drafts. */ }
  configureQuestions();
  const suggestions = setupBriefAutocomplete(form, () => step === 2 ? { path: path(), [path() === 'idea' ? 'idea' : 'today']: payload()[path() === 'idea' ? 'idea' : 'today'] } : { path: path() });
  function renderSummary() {
    const list = form.querySelector<HTMLDListElement>('[data-review]')!;
    list.replaceChildren();
    const values = payload();
    for (const [key, value] of Object.entries(values)) {
      if (!value || key === 'timingDate' && values.timing !== 'date') continue;
      const index = key === 'path' ? 0 : ['today', 'idea'].includes(key) ? 1 : ['firstResult', 'firstVersion'].includes(key) ? 2 : ['timing', 'timingDate'].includes(key) ? 3 : key === 'budgetNote' ? 4 : 5;
      const dt = document.createElement('dt'), dd = document.createElement('dd'), edit = document.createElement('button');
      dt.textContent = key === 'budgetNote' ? 'Budget' : key === 'firstResult' ? 'First result' : key === 'firstVersion' ? 'First version' : softwareLabels[key as keyof typeof softwareLabels];
      dd.textContent = key === 'path' ? softwarePaths[value as keyof typeof softwarePaths] : key === 'timing' ? timingLabels[value as keyof typeof timingLabels] : value;
      edit.type = 'button'; edit.textContent = 'Edit'; edit.setAttribute('aria-label', `Edit ${dt.textContent}`);
      edit.addEventListener('click', () => showStep(index)); dd.appendChild(document.createTextNode(' ')); dd.appendChild(edit); list.appendChild(dt); list.appendChild(dd);
    }
  }
  function showStep(index: number, focus = true) {
    suggestions.clear(); step = index;
    steps.forEach((section, i) => section.hidden = i !== index);
    if (index === 1 || index === 2) suggestions.start();
    document.querySelectorAll('.intake-progress li').forEach((item, i) => i === index ? item.setAttribute('aria-current', 'step') : item.removeAttribute('aria-current'));
    form.querySelector<HTMLElement>('[data-send-reassurance]')!.hidden = index !== 6;
    next.hidden = index === 6; submit.hidden = index !== 6; back.hidden = index === 0;
    status.textContent = sentElsewhere ? sentNotice : '';
    if (index === 6) renderSummary();
    if (focus) steps[index].querySelector<HTMLElement>('h1')!.focus();
    save();
  }
  function continueStep() {
    const input = payload();
    const result = validateSoftwareInquiry({ ...input, turnstileToken: 'pending', submissionId });
    const errors = result.ok ? {} : result.errors;
    const keys = step === 0 ? ['path'] : step === 1 ? [path() === 'idea' ? 'idea' : 'today'] : step === 2 ? [path() === 'idea' ? 'firstVersion' : 'firstResult'] : step === 3 ? ['timing', 'timingDate'] : step === 4 ? ['budgetNote'] : ['name', 'email', 'company'];
    if (step === 0 && !new FormData(form).get('path')) errors.path = 'Choose a starting point.';
    let first: HTMLElement | undefined;
    for (const key of keys) {
      const control = [...form.elements].find(node => node.getAttribute('name') === key) as HTMLInputElement | HTMLTextAreaElement | undefined;
      const message = errors[key] || (control && !control.checkValidity() ? 'Please check this answer.' : '');
      const error = form.querySelector<HTMLElement>(`[data-form-error="${key}"]`);
      if (error) { error.textContent = message; error.hidden = !message; }
      if (control) { if (message) { control.setAttribute('aria-invalid', 'true'); first ??= control; } else control.removeAttribute('aria-invalid'); }
    }
    if (first) { status.textContent = 'Please check the highlighted fields.'; first.focus(); return; }
    if (step < 6) showStep(step + 1);
  }
  form.addEventListener('input', save);
  form.addEventListener('change', event => {
    const control = event.target as HTMLInputElement;
    if (control.name === 'path') {
      steps.slice(1, 3).forEach(section => { const box = section.querySelector<HTMLTextAreaElement>('textarea')!; answers[box.name] = box.value; });
      configureQuestions();
      steps.slice(1, 3).forEach(section => { const box = section.querySelector<HTMLTextAreaElement>('textarea')!; box.value = answers[box.name] ?? ''; });
      continueStep();
    }
    if (control.name === 'timing') {
      form.querySelector<HTMLElement>('[data-date-field]')!.hidden = control.value !== 'date';
      if (control.value !== 'date') {
        const date = form.elements.namedItem('timingDate') as HTMLInputElement;
        date.value = ''; date.removeAttribute('aria-invalid');
        const error = form.querySelector<HTMLElement>('[data-form-error="timingDate"]')!;
        error.textContent = ''; error.hidden = true;
        status.textContent = sentElsewhere ? sentNotice : '';
      }
    }
    save();
  });
  form.querySelector<HTMLElement>('[data-date-field]')!.hidden = payload().timing !== 'date';
  next.addEventListener('click', continueStep);
  back.addEventListener('click', () => showStep(Math.max(0, step - 1)));
  form.querySelectorAll<HTMLButtonElement>('[data-skip]').forEach(button => button.addEventListener('click', () => {
    steps[step].querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')!.value = ''; continueStep();
  }));
  form.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && step < 6) { event.preventDefault(); continueStep(); } });
  window.addEventListener('storage', event => { if (event.key === sentKey) { if (noticeSentDraft()) save(); } });
  form.addEventListener('submit', event => {
    if (noticeSentDraft()) { event.preventDefault(); event.stopImmediatePropagation(); save(); return; }
    if (step !== 6) { event.preventDefault(); event.stopImmediatePropagation(); continueStep(); } });
  setupFormSubmission({ form, endpoint: '/api/software-inquiry', success: document.getElementById('software-success')!,
    payload: () => ({ ...payload(), submissionId }),
    onSuccess: result => {
      suggestions.clear();
      try {
        localStorage.setItem(sentKey, submissionId);
        const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
        if (saved?.submissionId === submissionId) localStorage.removeItem(storageKey);
      } catch { /* Storage is optional. */ }
      renderSoftwareReceipt(result);
    },
    onConflict: () => { submissionId = crypto.randomUUID(); save(); },
  });
  const observer = new MutationObserver(records => {
    const target = records.map(record => record.target as HTMLElement).find(node => node.getAttribute('aria-invalid') === 'true' && steps.some(section => section.hidden && section.contains(node)));
    if (target) { showStep(steps.findIndex(section => section.contains(target)), false); target.focus(); }
  });
  observer.observe(form, { attributes: true, subtree: true, attributeFilter: ['aria-invalid'] });
  showStep(step, false);
}
const form = document.querySelector<HTMLFormElement>('#software-inquiry');
if (form) setupSoftwareInquiry(form);
