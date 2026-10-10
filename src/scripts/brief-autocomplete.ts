import { setupSuggestionPass } from './brief-suggestion-pass';
export function setupBriefAutocomplete(form: HTMLFormElement, earlier: () => Record<string, string>) {
  const startPass = setupSuggestionPass(form);
  const resizeAnswers: (() => void)[] = [];
  const start = () => { resizeAnswers.forEach(resize => resize()); if (enabled) void startPass(); };
  let unavailable = false;
  let inputType = 'keyboard';
  const updateHints = () => form.querySelectorAll<HTMLElement>('[data-accept-hint]').forEach(hint => hint.textContent = inputType === 'touch' ? 'Tap to accept' : 'Tab to accept');
  form.addEventListener('pointerdown', event => { inputType = event.pointerType === 'touch' ? 'touch' : 'keyboard'; updateHints(); });
  let enabled = true, generation = 0, timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let renewedRetry: AbortController | undefined;
  try { enabled = localStorage.getItem('software-suggestions') !== 'off'; } catch { /* Storage is optional. */ }
  const toggles = [...form.querySelectorAll<HTMLButtonElement>('[data-suggestions-toggle]')];
  const updateToggles = () => {
    toggles.forEach(button => button.textContent = enabled ? 'Turn off' : 'Turn on');
    form.querySelectorAll<HTMLElement>('[data-suggestions-disclosure]').forEach(node => node.hidden = !enabled);
    form.querySelectorAll<HTMLElement>('[data-suggestions-off]').forEach(node => node.hidden = enabled);
  };
  const clear = () => {
    if (renewedRetry && controller === renewedRetry) unavailable = false;
    generation++; clearTimeout(timer); controller?.abort();
    form.querySelectorAll<HTMLElement>('[data-accept-hint]').forEach(hint => hint.hidden = true);
    form.querySelectorAll<HTMLElement>('[data-ghost-prefix], [data-ghost-text]').forEach(node => node.textContent = '');
    form.querySelectorAll<HTMLButtonElement>('[data-accept]').forEach(button => { button.hidden = true; button.dataset.suggestion = ''; });
  };
  toggles.forEach(button => button.addEventListener('click', () => {
    enabled = !enabled; clear(); updateToggles(); if (enabled && form.querySelector('[data-step="1"]:not([hidden]), [data-step="2"]:not([hidden])')) start();
    try { localStorage.setItem('software-suggestions', enabled ? 'on' : 'off'); } catch { /* Storage is optional. */ }
  }));
  form.querySelectorAll<HTMLTextAreaElement>('[data-answer]').forEach(box => {
    const section = box.closest<HTMLElement>('[data-step]')!;
    const control = section.querySelector<HTMLButtonElement>('[data-accept]')!;
    const prefix = section.querySelector<HTMLElement>('[data-ghost-prefix]')!;
    const ghost = section.querySelector<HTMLElement>('[data-ghost-text]')!;
    const overlay = prefix.parentElement!;
    const hint = section.querySelector<HTMLElement>('[data-accept-hint]')!;
    const atEnd = () => box.selectionStart === box.value.length && box.selectionEnd === box.value.length;
    const accept = () => {
      if (!control.dataset.suggestion || !atEnd()) return;
      box.value += control.dataset.suggestion;
      box.focus(); box.setSelectionRange(box.value.length, box.value.length);
      clear(); box.dispatchEvent(new Event('input', { bubbles: true }));
    };
    control.addEventListener('click', accept);
    ghost.addEventListener('pointerdown', event => event.preventDefault());
    ghost.addEventListener('click', accept);
    box.addEventListener('keydown', event => {
      if (!event.isComposing && event.key !== 'Unidentified' && event.keyCode !== 229) inputType = 'keyboard';
      updateHints();
      if (!event.isComposing && control.dataset.suggestion && atEnd() && (event.key === 'Tab' || event.key === 'ArrowRight') && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); accept(); }
      else if (event.key !== 'Tab') clear();
    });
    box.addEventListener('select', () => { if (!atEnd()) clear(); });
    box.addEventListener('click', () => { if (!atEnd()) clear(); });
    const resize = () => {
      if (section.hidden) return;
      box.style.height = '';
      const border = box.offsetHeight - box.clientHeight;
      box.style.height = `${Math.max(box.offsetHeight, box.scrollHeight + border, overlay.scrollHeight + border)}px`;
    };
    resizeAnswers.push(resize);
    window.addEventListener('resize', resize);
    box.addEventListener('input', event => {
      clear(); resize();
      if (!enabled || unavailable || (event as InputEvent).isComposing || !atEnd() || box.value.trim().split(/\s+/).length < 3) return;
      const text = box.value, current = generation;
      timer = setTimeout(async () => {
        const requestController = new AbortController();
        controller = requestController;
        try {
          if (!await startPass() || generation !== current || !enabled || section.hidden) return;
          const payload = { question: section.querySelector('h1')!.textContent, text, earlier: earlier() };
          if (JSON.stringify(payload).length > 2000) return;
          const suggest = () => fetch('/api/software/brief/suggest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.any([requestController.signal, AbortSignal.timeout(2000)]) });
          let response = await suggest();
          let result = await response.json() as { suggestion?: unknown; passRequired?: boolean };
          if (generation !== current || !enabled || section.hidden) return;
          if (result.passRequired === true) {
            unavailable = true;
            if (!await startPass(true)) return;
            if (generation !== current || !enabled || section.hidden) { unavailable = false; return; }
            renewedRetry = requestController;
            response = await suggest();
            result = await response.json() as typeof result;
            if (!response.ok || result.passRequired === true) return;
            unavailable = false;
          }
          if (!response.ok || generation !== current || !enabled || section.hidden || box.value !== text || !atEnd() || typeof result.suggestion !== 'string' || !result.suggestion.trim()) return;
          // The endpoint is bounded too; never let a malformed response overfill an answer.
          const suggestion = result.suggestion.slice(0, 100);
          if (box.value.length + suggestion.length > box.maxLength) return;
          prefix.textContent = text; ghost.textContent = suggestion;
          control.dataset.suggestion = suggestion; control.textContent = `Add suggestion: ${suggestion.trim()}`;
          updateHints(); hint.hidden = false;
          control.setAttribute('aria-label', `Add suggestion: ${suggestion.trim()}`); control.hidden = false;
          resize();
        } catch { /* Suggestions never interrupt writing. */ }
        finally { if (renewedRetry === requestController) renewedRetry = undefined; }
      }, 400);
    });
  });
  updateToggles();
  return { clear, start };
}
