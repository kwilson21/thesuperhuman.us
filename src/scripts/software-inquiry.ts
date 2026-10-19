import { setupBriefAutocomplete } from './brief-autocomplete';
import { clientSoftwareLabels, softwareBriefKickers, softwarePaths, timingLabels, updateLabels, validateSoftwareInquiry, type SoftwarePath } from '../lib/software-inquiry';
import { setupFormSubmission } from './form-submission';

// Each path's screens in order, by data-step. Website adds two screens after its first question.
const plans = { website: [0, 1, 7, 8, 3, 4, 5, 6], webapp: [0, 1, 2, 3, 4, 5, 6], workflow: [0, 1, 2, 3, 4, 5, 6] } as const;
const pathFields = { website: ['purpose', 'currentUrl', 'existing', 'updates'], webapp: ['appGoal', 'firstVersion'], workflow: ['today', 'firstResult'] } as const;
const questionLimits: Record<string, number> = { today: 2000, firstResult: 2000, purpose: 2000, appGoal: 1000, firstVersion: 1000 };

export function renderSoftwareReceipt(result: Record<string, unknown>, path?: string) {
  const brief = result.brief && typeof result.brief === 'object' && !Array.isArray(result.brief) ? result.brief as Record<string, string> : {};
  const firstName = brief.name?.trim().split(/\s+/)[0] || 'there';
  document.querySelector<HTMLElement>('[data-receipt-thanks]')!.textContent = `Thanks, ${firstName}. I'll read it myself and reply within two business days.`;
  document.querySelector<HTMLElement>('[data-intake-progress]')!.hidden = true;
  const kicker = document.querySelector<HTMLElement>('[data-brief-kicker]'); if (kicker) kicker.hidden = true;
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
  if (path === 'website') document.querySelector<HTMLElement>('[data-receipt-first-step]')!.textContent = "I'll look at what you have and reply with a fixed-price first milestone, or a question or two.";
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
  let step = typeof requestedPath === 'string' && Object.hasOwn(softwarePaths, requestedPath) ? 1 : 0, submissionId = crypto.randomUUID();
  const path = (): SoftwarePath => { const value = new FormData(form).get('path'); return typeof value === 'string' && Object.hasOwn(softwarePaths, value) ? value as SoftwarePath : 'workflow'; };
  const plan = (): readonly number[] => plans[path()];
  const last = () => plan().length - 1;
  const fields = () => ['path', ...pathFields[path()], 'timing', 'timingDate', 'budgetNote', 'name', 'email', 'company'];
  const payload = (trim = true) => Object.fromEntries(fields().map(key => [key, trim ? String(new FormData(form).get(key) ?? '').trim() : String(new FormData(form).get(key) ?? '')]));
  // The fields each data-step asks for, for validation and the review list.
  const sectionFields = (section: number): string[] => [['path'], [pathFields[path()][0]], [pathFields[path()][1]], ['timing', 'timingDate'], ['budgetNote'], ['name', 'email', 'company'], [], ['currentUrl', 'existing'], ['updates']][section] ?? [];
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
    steps.slice(1, 3).forEach(section => { const box = section.querySelector<HTMLTextAreaElement>('[data-answer]')!; if (box.name) answers[box.name] = box.value; });
    // Website answers stay saved while another path is selected.
    const kept = Object.fromEntries(['currentUrl', 'existing', 'updates'].map(key => [key, String(new FormData(form).get(key) ?? '')]));
    try { localStorage.setItem(storageKey, JSON.stringify({ answers: { ...payload(false), ...kept, ...answers }, step, submissionId })); } catch { /* Keep writing when storage is unavailable. */ }
  }
  function configureQuestions() {
    const questions = path() === 'website' ? [
      ['purpose', "What's the website for?", "Who it's for, and what you want visitors to do when they get there.", 'A site for my pottery studio. People should see upcoming classes and sign up without messaging me first.', 2000],
    ] : path() === 'webapp' ? [
      ['appGoal', 'What should the app let people do?', "Who it's for, and the one thing they'd come back for.", 'Let my students book and pay for lessons without emailing me.', 1000],
      ['firstVersion', 'Have a first version in mind?', "If you have a hunch, or a spreadsheet or prototype it should replace. Otherwise I'll propose one.", '', 1000],
    ] : [
      ['today', 'What happens today?', "Who does it, what's slow or error-prone, and what it costs you.", 'We track new clients in a shared spreadsheet. Three of us update it, and follow-ups slip through the cracks.', 2000],
      ['firstResult', 'Have a first result in mind?', "If you have a hunch. Otherwise I'll propose one.", '', 2000],
    ];
    const footnote = path() === 'website' ? 'Plain language is fine. We’ll work out the design and technical details together. Please leave out passwords and access details.' : 'Plain language is fine. We’ll work out the technical details together. Please leave out passwords, access details and real customer data.';
    questions.forEach(([key, title, hint, placeholder, max], i) => {
      const section = steps[i + 1], box = section.querySelector<HTMLTextAreaElement>('[data-answer]')!;
      box.name = String(key); box.maxLength = Number(max); box.placeholder = String(placeholder);
      section.querySelector('h1')!.textContent = String(title);
      section.querySelector('[data-answer-label]')!.textContent = String(title);
      section.querySelector('[data-question-hint]')!.textContent = String(hint);
      section.querySelector('[data-question-footnote]')!.textContent = footnote;
      const error = section.querySelector<HTMLElement>('[data-form-error]')!;
      error.dataset.formError = String(key); error.textContent = ''; error.hidden = true;
      // form-submission links an error to its box only when the box is named at setup. Link it now if the error already has an id.
      const described = box.getAttribute('aria-describedby') ?? '';
      if (error.id && !described.split(/\s+/).includes(error.id)) box.setAttribute('aria-describedby', [described, error.id].filter(Boolean).join(' '));
      box.removeAttribute('aria-invalid');
    });
  }
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (saved && saved.answers && typeof saved.answers === 'object') {
      const stored: Record<string, unknown> = { ...saved.answers };
      // Drafts from before the named paths used one "idea" path, which is now the web app brief. Its idea text is the app goal on any path.
      if (stored.path === 'idea') stored.path = 'webapp';
      if (typeof stored.idea === 'string' && typeof stored.appGoal !== 'string') stored.appGoal = stored.idea;
      const validPath = typeof stored.path === 'string' && Object.hasOwn(softwarePaths, stored.path);
      for (const [key, max] of Object.entries(questionLimits)) if (typeof stored[key] === 'string') answers[key] = (stored[key] as string).slice(0, max);
      for (const name of ['path', 'timing', 'updates']) form.querySelectorAll<HTMLInputElement>(`[name="${name}"]`).forEach(box => box.checked = box.value === (name === 'path' && requestedPath ? requestedPath : stored[name]));
      configureQuestions();
      for (const key of [...fields(), 'currentUrl', 'existing']) {
        const control = form.elements.namedItem(key), value = stored[key];
        if ((control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) && typeof value === 'string') control.value = value.slice(0, control.maxLength > 0 ? control.maxLength : 200);
      }
      if (validPath && (!requestedPath || requestedPath === stored.path) && Number.isInteger(saved.step) && saved.step >= 0 && saved.step <= last()) step = saved.step;
      if (typeof saved.submissionId === 'string' && /^[a-f0-9-]{36}$/i.test(saved.submissionId)) submissionId = saved.submissionId;
    }
  } catch { /* Ignore unavailable storage and invalid drafts. */ }
  configureQuestions();
  const suggestions = setupBriefAutocomplete(form, () => plan()[step] === 2 ? { path: path(), [pathFields[path()][0]]: payload()[pathFields[path()][0]] } : { path: path() });
  function renderSummary() {
    const list = form.querySelector<HTMLDListElement>('[data-review]')!;
    list.replaceChildren();
    const values = payload();
    const labels: Record<string, string> = { budgetNote: 'Budget', firstResult: 'First result', firstVersion: 'First version' };
    for (const [key, value] of Object.entries(values)) {
      if (!value || key === 'timingDate' && values.timing !== 'date') continue;
      const index = plan().findIndex(section => sectionFields(section).includes(key));
      const dt = document.createElement('dt'), dd = document.createElement('dd'), edit = document.createElement('button');
      dt.textContent = labels[key] ?? clientSoftwareLabels[key];
      dd.textContent = key === 'path' ? softwarePaths[value as SoftwarePath] : key === 'timing' ? timingLabels[value as keyof typeof timingLabels] : key === 'updates' ? updateLabels[value as keyof typeof updateLabels] : value;
      edit.type = 'button'; edit.textContent = 'Edit'; edit.setAttribute('aria-label', `Edit ${dt.textContent}`);
      edit.addEventListener('click', () => showStep(index)); dd.appendChild(document.createTextNode(' ')); dd.appendChild(edit); list.appendChild(dt); list.appendChild(dd);
    }
  }
  function showStep(index: number, focus = true) {
    suggestions.clear(); step = index;
    const section = plan()[index];
    steps.forEach((node, i) => node.hidden = i !== section);
    if (section === 1 || section === 2) suggestions.start();
    document.querySelectorAll<HTMLElement>('.intake-progress li').forEach((item, i) => {
      item.hidden = i >= plan().length;
      if (i === index) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
      item.querySelector<HTMLElement>('.sr-only')!.textContent = `Question ${i + 1} of ${plan().length}`;
    });
    const kicker = document.querySelector<HTMLElement>('[data-brief-kicker]');
    if (kicker) kicker.textContent = index === 0 ? 'Project brief' : softwareBriefKickers[path()];
    const timingHint = form.querySelector<HTMLElement>('[data-timing-hint]');
    if (timingHint) timingHint.hidden = path() !== 'website';
    form.querySelector<HTMLElement>('[data-send-reassurance]')!.hidden = index !== last();
    next.hidden = index === last(); submit.hidden = index !== last(); back.hidden = index === 0;
    status.textContent = sentElsewhere ? sentNotice : '';
    if (index === last()) renderSummary();
    if (focus) steps[section].querySelector<HTMLElement>('h1')!.focus();
    save();
  }
  function continueStep() {
    const input = payload();
    const result = validateSoftwareInquiry({ ...input, turnstileToken: 'pending', submissionId });
    const errors = result.ok ? {} : result.errors;
    const keys = sectionFields(plan()[step]);
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
    if (step < last()) showStep(step + 1);
  }
  form.addEventListener('input', save);
  // Only a pointer choice moves on by itself. Arrow keys step through the radio group, so keyboard and screen-reader users
  // reach every starting point and continue with Next, as they do after any other answer.
  let pointerChoice = false;
  form.addEventListener('pointerdown', () => { pointerChoice = true; });
  form.addEventListener('keydown', () => { pointerChoice = false; });
  form.addEventListener('change', event => {
    const control = event.target as HTMLInputElement;
    if (control.name === 'path') {
      steps.slice(1, 3).forEach(section => { const box = section.querySelector<HTMLTextAreaElement>('textarea')!; if (box.name) answers[box.name] = box.value; });
      configureQuestions();
      steps.slice(1, 3).forEach(section => { const box = section.querySelector<HTMLTextAreaElement>('textarea')!; if (box.name) box.value = answers[box.name] ?? ''; });
      if (pointerChoice) continueStep();
      else {
        const error = form.querySelector<HTMLElement>('[data-form-error="path"]')!; error.textContent = ''; error.hidden = true;
        form.querySelectorAll<HTMLInputElement>('[name="path"]').forEach(box => box.removeAttribute('aria-invalid'));
        showStep(step, false);
      }
      pointerChoice = false;
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
    steps[plan()[step]].querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach(control => control.value = '');
    continueStep();
  }));
  form.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && step < last()) { event.preventDefault(); continueStep(); } });
  window.addEventListener('storage', event => { if (event.key === sentKey) { if (noticeSentDraft()) save(); } });
  form.addEventListener('submit', event => {
    if (noticeSentDraft()) { event.preventDefault(); event.stopImmediatePropagation(); save(); return; }
    if (step !== last()) { event.preventDefault(); event.stopImmediatePropagation(); continueStep(); } });
  const disabledControls = new Map<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement, boolean>();
  setupFormSubmission({ form, endpoint: '/api/software-inquiry', success: document.getElementById('software-success')!,
    payload: () => ({ ...payload(), submissionId }),
    onSendingChange: sending => {
      if (sending) {
        form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>('input, textarea, button').forEach(control => {
          if (control === submit) return;
          disabledControls.set(control, control.disabled); control.disabled = true;
        });
      } else {
        disabledControls.forEach((disabled, control) => { control.disabled = disabled; });
        disabledControls.clear();
      }
    },
    onSuccess: result => {
      suggestions.clear();
      try {
        localStorage.setItem(sentKey, submissionId);
        const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
        if (saved?.submissionId === submissionId) localStorage.removeItem(storageKey);
      } catch { /* Storage is optional. */ }
      renderSoftwareReceipt(result, path());
    },
    onConflict: () => { submissionId = crypto.randomUUID(); save(); },
  });
  const observer = new MutationObserver(records => {
    const target = records.map(record => record.target as HTMLElement).find(node => node.getAttribute('aria-invalid') === 'true' && steps.some(section => section.hidden && section.contains(node)));
    if (!target) return;
    const position = plan().indexOf(steps.findIndex(section => section.contains(target)));
    if (position < 0) return;
    showStep(position, false); target.focus();
  });
  observer.observe(form, { attributes: true, subtree: true, attributeFilter: ['aria-invalid'] });
  showStep(step, false);
}
const form = document.querySelector<HTMLFormElement>('#software-inquiry');
if (form) setupSoftwareInquiry(form);
