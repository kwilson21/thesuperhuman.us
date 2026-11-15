/**
 * The message form on /contact. It stays closed until the visitor connects the message line, and
 * the Turnstile check loads only then, so visitors who choose another line never load it.
 */
export function setupContactMessage(panel: HTMLElement) {
	const turnstileContainer = panel.querySelector<HTMLElement>(
		"[data-contact-turnstile]",
	);

	const heading = panel.querySelector<HTMLElement>("[data-message-heading]");

	let turnstileLoad: Promise<void> | undefined;
	let turnstileWidget: string | undefined;

	function renderContactTurnstile() {
		const api = window.turnstile;

		if (turnstileWidget || !api || !turnstileContainer) return;
		turnstileWidget = api.render(turnstileContainer, {
			sitekey: turnstileContainer.dataset.sitekey!,
		});

		const error = panel.querySelector<HTMLElement>(
			'[data-form-error="turnstileToken"]',
		);

		if (error) {
			error.textContent = "";
			error.hidden = true;
		}
	}

	async function loadContactTurnstile(): Promise<void> {
		if (!turnstileContainer || turnstileWidget) return;

		const api = window.turnstile;

		if (api) {
			renderContactTurnstile();

			return;
		}

		if (turnstileLoad) return;
		turnstileLoad = new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.src =
				"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
			script.async = true;
			script.defer = true;
			script.onload = () => {
				try {
					if (!window.turnstile) throw new Error("Turnstile API unavailable");
					renderContactTurnstile();
					resolve();
				} catch (error) {
					turnstileLoad = undefined;
					reject(error);
				}
			};

			script.onerror = () => {
				turnstileLoad = undefined;
				reject(new Error("Turnstile failed to load"));
			};

			document.head.appendChild(script);
		});

		return turnstileLoad;
	}

	function open() {
		const wasHidden = panel.hidden;
		panel.hidden = false;
		void loadContactTurnstile().catch(() => {
			const error = panel.querySelector<HTMLElement>(
				'[data-form-error="turnstileToken"]',
			);

			if (error) {
				error.textContent =
					"The verification check did not load. Choose Send a message above to try again.";
				error.hidden = false;
			}
		});

		if (!wasHidden && document.activeElement === heading) return;

		const smooth = window.matchMedia(
			"(prefers-reduced-motion: no-preference)",
		).matches;

		panel.scrollIntoView({
			block: "start",
			behavior: smooth ? "smooth" : "auto",
		});
		heading?.focus({ preventScroll: true });
	}

	return { open };
}
