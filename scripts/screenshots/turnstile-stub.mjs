// A fake Turnstile API for screenshot scenarios. Only the script URL is intercepted: the widget gets a
// dummy response field, so forms validate and reach their send step without a real challenge.
export async function stubTurnstile(page) {
  await page.route('https://challenges.cloudflare.com/turnstile/**', route => route.fulfill({
    contentType: 'application/javascript',
    body: `(${(() => {
      const token = 'XXXX.DUMMY.TOKEN.XXXX', widgets = new Map();
      let nextId = 0;
      const complete = id => {
        const widget = widgets.get(id);
        if (!widget) return;
        if (widget.input) widget.input.value = token;
        widget.options.callback?.(token);
      };
      window.turnstile = {
        render(container, options = {}) {
          if (typeof container === 'string') container = document.querySelector(container);
          const id = 'screenshot-widget-' + ++nextId;
          let input;
          if (options['response-field'] !== false) {
            input = document.createElement('input');
            input.type = 'hidden'; input.name = options['response-field-name'] ?? 'cf-turnstile-response';
            container.appendChild(input);
          }
          widgets.set(id, { options, input });
          queueMicrotask(() => complete(id));
          return id;
        },
        reset(id) { for (const key of id ? [id] : widgets.keys()) queueMicrotask(() => complete(key)); },
        remove(id) { widgets.get(id)?.input?.remove(); widgets.delete(id); },
        getResponse(id) { return widgets.has(id ?? widgets.keys().next().value) ? token : ''; },
        execute(id) { queueMicrotask(() => complete(id)); },
        ready(callback) { queueMicrotask(callback); },
      };
      document.querySelectorAll('.cf-turnstile').forEach(container => window.turnstile.render(container));
      const onload = new URL(document.currentScript.src).searchParams.get('onload');
      if (onload) window[onload]?.();
    }).toString()})();`,
  }));
}
