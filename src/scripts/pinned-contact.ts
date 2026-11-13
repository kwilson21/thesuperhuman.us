/** Shows the pinned Get in touch button and marks it at the end while the closing panel is on screen. */
export function setupPinnedContact(): void {
  const pinned = document.querySelector<HTMLElement>('[data-pinned-contact]');
  const panel = document.querySelector<HTMLElement>('.closing-panel');
  if (!pinned || !panel || typeof IntersectionObserver === 'undefined') return;
  pinned.removeAttribute('hidden');
  new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) pinned.setAttribute('data-at-end', '');
    else pinned.removeAttribute('data-at-end');
  }).observe(panel);
}
