/** The Next step link jumps to the control it names, highlights it and focuses it. */
export function setupNextStep() {
  const link = document.querySelector<HTMLAnchorElement>('[data-next-step-link]');
  link?.addEventListener('click', event => {
    const target = document.getElementById(link.hash.slice(1));
    if (!target) return;
    event.preventDefault();
    // A heading stands for its whole section; a form or button is highlighted itself.
    const highlight = target.matches('h2, h3') ? target.closest('section') ?? target : target;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    highlight.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    const focus = target.matches('button, input, select, textarea') ? target
      : target.querySelector<HTMLElement>('[data-next-step-focus]')
        ?? target.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select, button');
    focus?.focus({ preventScroll: true });
    document.querySelectorAll('.next-step-target').forEach(element => element.classList.remove('next-step-target'));
    highlight.classList.add('next-step-target');
    setTimeout(() => highlight.classList.remove('next-step-target'), 4000);
  });
}
