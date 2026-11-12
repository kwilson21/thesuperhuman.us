export function setupHomeContact() {
	const contact = document.getElementById("contact")!;

	const message = contact.querySelector<HTMLDetailsElement>(
		".contact-disclosure",
	)!;

	const turnstileContainer = contact.querySelector<HTMLElement>(
		"[data-contact-turnstile]",
	);

	let turnstileLoad: Promise<void> | undefined;
	let turnstileWidget: string | undefined;

	function renderContactTurnstile() {
		const api = window.turnstile;

		if (turnstileWidget || !api || !turnstileContainer) return;
		turnstileWidget = api.render(turnstileContainer, {
			sitekey: turnstileContainer.dataset.sitekey!,
		});

		const error = contact.querySelector<HTMLElement>(
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

	function openContactForm() {
		void loadContactTurnstile().catch(() => {
			const error = contact.querySelector<HTMLElement>(
				'[data-form-error="turnstileToken"]',
			);

			if (error) {
				error.textContent =
					"The verification check did not load. Close and reopen this form to try again.";
				error.hidden = false;
			}
		});
	}

	message.addEventListener("toggle", () => {
		if (message.open) openContactForm();
	});

	function revealContact() {
		if (location.hash !== "#contact") return;
		message.open = true;
		openContactForm();
		contact.scrollIntoView({ block: "start" });
	}

	revealContact();
	window.addEventListener("hashchange", revealContact);
	// Clicking the same fragment again does not fire hashchange.
	document
		.querySelectorAll<HTMLAnchorElement>(
			'a[href="/#contact"], a[href="#contact"]',
		)
		.forEach((link) => {
			link.addEventListener("click", () => {
				message.open = true;
			});
		});
}
