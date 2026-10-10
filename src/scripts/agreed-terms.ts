// Reading controls only. Agreement, signature and milestone decision forms are separate.
export function setupAgreedTerms(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-terms-reader]').forEach(reader => {
    if (reader.dataset.termsReady) return;
    const stages = [...reader.querySelectorAll<HTMLElement>('[data-terms-stage]')];
    const buttons = [...reader.querySelectorAll<HTMLButtonElement>('[data-terms-stage-button]')];
    const back = reader.querySelector<HTMLButtonElement>('[data-terms-back]')!;
    const next = reader.querySelector<HTMLButtonElement>('[data-terms-next]')!;
    const full = reader.querySelector<HTMLButtonElement>('[data-terms-full]')!;
    const fullHeading = reader.querySelector<HTMLElement>('[data-terms-full-heading]')!;
    const progress = reader.querySelector<HTMLElement>('[data-terms-progress]')!;
    if (!stages.length || buttons.length !== stages.length || !back || !next || !full || !fullHeading || !progress) return;
    let current = 0, all = false;
    const summary = reader.querySelector<HTMLElement>('.terms-summary');
    function summaryOffset() {
      if (!summary) return 0;
      const height = summary.getBoundingClientRect().height;
      // A long name or enlarged text must leave room to read the current stage.
      summary.style.position = height > window.innerHeight / 3 ? 'static' : '';
      return summary.style.position === 'static' ? 0 : height;
    }
    window.addEventListener('resize', summaryOffset);
    reader.closest('[data-agreed-terms]')?.addEventListener('toggle', summaryOffset);
    const disclosureStates = new Map<HTMLDetailsElement, boolean>();
    function render(moveFocus = true) {
      stages.forEach((stage, index) => { stage.hidden = !all && index !== current; });
      buttons.forEach((button, index) => {
        if (!all && index === current) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
      });
      back.disabled = current === 0;
      back.hidden = all;
      next.hidden = all || current === stages.length - 1;
      fullHeading.hidden = !all;
      full.textContent = all ? 'Back to guided review' : 'Review all terms';
      progress.textContent = all ? 'All agreed terms' : `Reading stage ${current + 1} of ${stages.length}: ${buttons[current].textContent!.trim()}`;
      const offset = summaryOffset();
      if (moveFocus) {
        const heading = all ? fullHeading : stages[current].querySelector<HTMLElement>('h2')!;
        // The saved outcome and enlarged text can make the sticky summary taller.
        heading.style.scrollMarginTop = `${offset + 16}px`;
        heading.focus({ preventScroll: true });
        heading.scrollIntoView({ block: 'start', behavior: 'instant' });
      }
    }
    function restoreDisclosures() {
      disclosureStates.forEach((open, details) => { details.open = open; });
      disclosureStates.clear();
    }
    function expandDisclosures() {
      reader.querySelectorAll<HTMLDetailsElement>('details').forEach(details => {
        if (!disclosureStates.has(details)) disclosureStates.set(details, details.open);
        details.open = true;
      });
    }
    buttons.forEach((button, index) => button.addEventListener('click', () => {
      if (all) restoreDisclosures();
      current = index; all = false; render();
    }));
    back.addEventListener('click', () => { if (current > 0) { current--; render(); } });
    next.addEventListener('click', () => { if (current < stages.length - 1) { current++; render(); } });
    full.addEventListener('click', () => {
      all = !all;
      if (all) expandDisclosures(); else restoreDisclosures();
      render();
    });
    // Printing includes every stage and disclosure without modifying saved agreements.
    const printStates = new Map<HTMLDetailsElement, boolean>();
    window.addEventListener('beforeprint', () => {
      const outer = reader.closest<HTMLDetailsElement>('[data-agreed-terms]');
      const details = [...reader.querySelectorAll<HTMLDetailsElement>('details'), ...(outer ? [outer] : [])];
      details.forEach(item => { printStates.set(item, item.open); item.open = true; });
    });
    window.addEventListener('afterprint', () => { printStates.forEach((open, item) => { item.open = open; }); printStates.clear(); });
    reader.querySelectorAll<HTMLElement>('[data-terms-controls]').forEach(control => { control.hidden = false; });
    reader.dataset.termsReady = 'true';
    render(false);
  });
}
