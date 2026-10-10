import { setupSuggestionPass } from './brief-suggestion-pass';
export function setupBriefAutocomplete(form: HTMLFormElement, earlier: () => Record<string, string>) {
  const startPass = setupSuggestionPass(form);
  const start = () => { if (enabled) void startPass(); };
  let enabled = true, generation = 0, timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  try { enabled = localStorage.getItem('software-suggestions') !== 'off'; } catch { /* Storage is optional. */ }
  const toggles = [...form.querySelectorAll<HTMLButtonElement>('[data-suggestions-toggle]')];
  const updateToggles = () => {
    toggles.forEach(button => button.textContent = enabled ? 'Turn off' : 'Turn on');
    form.querySelectorAll<HTMLElement>('[data-suggestions-disclosure]').forEach(node => node.hidden = !enabled);
    form.querySelectorAll<HTMLElement>('[data-suggestions-off]').forEach(node => node.hidden = enabled);
  };
  const clear = () => {
    generation++; clearTimeout(timer); controller?.abort();
    form.querySelectorAll<HTMLElement>('[data-ghost-prefix], [data-ghost-text]').forEach(node => node.textContent = '');
    form.querySelectorAll<HTMLButtonElement>('[data-accept]').forEach(button => { button.hidden = true; button.dataset.suggestion = ''; });
  };
  toggles.forEach(button => button.addEventListener('click', () => {
    enabled = !enabled; clear(); updateToggles(); if (enabled && form.querySelector('[data-step="1"]:not([hidden]), [data-step="2"]:not([hidden])')) start();
    try { localStorage.setItem('software-suggestions', enabled ? 'on' : 'off'); } catch { /* Storage is optional. */ }
  }));
  form.querySelectorAll<HTMLTextAreaElement>('[data-answer]').forEach(box => {
    const section = box.closest<HTMLElement>('[data-step]')!;
    const chip = section.querySelector<HTMLButtonElement>('[data-accept]')!;
    const prefix = section.querySelector<HTMLElement>('[data-ghost-prefix]')!;
    const ghost = section.querySelector<HTMLElement>('[data-ghost-text]')!;
    const overlay = prefix.parentElement!;
    const atEnd = () => box.selectionStart === box.value.length && box.selectionEnd === box.value.length;
    const accept = () => {
      if (!chip.dataset.suggestion || !atEnd()) return;
      box.value += chip.dataset.suggestion;
      box.focus(); box.setSelectionRange(box.value.length, box.value.length);
      clear(); box.dispatchEvent(new Event('input', { bubbles: true }));
    };
    chip.addEventListener('click', accept);
    box.addEventListener('keydown', event => {
      if (!event.isComposing && chip.dataset.suggestion && atEnd() && (event.key === 'Tab' || event.key === 'ArrowRight') && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); accept(); }
      else if (event.key !== 'Tab') clear();
    });
    box.addEventListener('select', () => { if (!atEnd()) clear(); });
    box.addEventListener('click', () => { if (!atEnd()) clear(); });
    box.addEventListener('scroll', () => { overlay.scrollTop = box.scrollTop; });
    box.addEventListener('input', event => {
      clear();
      if (!enabled || (event as InputEvent).isComposing || !atEnd() || box.value.trim().split(/\s+/).length < 3) return;
      const text = box.value, current = generation;
      timer = setTimeout(async () => {
        controller = new AbortController();
        try {
          if (!await startPass() || generation !== current || !enabled || section.hidden) return;
          const payload = { question: section.querySelector('h1')!.textContent, text, earlier: earlier() };
          if (JSON.stringify(payload).length > 2000) return;
          const response = await fetch('/api/software/brief/suggest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2000)]) });
          const result = await response.json() as { suggestion?: unknown };
          if (!response.ok || generation !== current || !enabled || section.hidden || box.value !== text || !atEnd() || typeof result.suggestion !== 'string' || !result.suggestion.trim()) return;
          // The endpoint is bounded too; never let a malformed response overfill an answer.
          const suggestion = result.suggestion.slice(0, 100);
          if (box.value.length + suggestion.length > box.maxLength) return;
          prefix.textContent = text; ghost.textContent = suggestion;
          chip.dataset.suggestion = suggestion; chip.textContent = `Use: "${suggestion.trim()}"`;
          chip.setAttribute('aria-label', `Add suggestion: ${suggestion.trim()}`); chip.hidden = false;
          overlay.scrollTop = box.scrollTop;
        } catch { /* Suggestions never interrupt writing. */ }
      }, 400);
    });
  });
  updateToggles();
  return { clear, start };
}
