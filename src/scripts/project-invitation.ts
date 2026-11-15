export function setupProjectInvitation(selector = "[data-project-invitation]") {
	const root = document.querySelector<HTMLElement>(selector);

	const button = root?.querySelector<HTMLButtonElement>(
		"[data-send-project-invitation]",
	);

	const status = root?.querySelector<HTMLElement>("[data-invitation-status]");
	const endpoint = root?.dataset.endpoint;

	if (!button || !status || !endpoint) return;

	const isInvitation = selector === "[data-project-invitation]";

	const failure = isInvitation
		? "Could not queue the invitation. Please try again."
		: "Could not send the brief copy. Please try again.";

	button.addEventListener("click", async () => {
		button.disabled = true;
		status.textContent = isInvitation
			? "Sending the sign-in link…"
			: "Sending the brief copy…";

		try {
			const response = await fetch(endpoint, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					action: "send",
					confirmedNotSent: button.dataset.confirmedNotSent === "true",
				}),
			});

			// A brief copy that answers 500 may already have asked the mail provider, which records what it learned on the request. The page shows that record and offers only the buttons it allows, as it does after a success.
			if (response.ok || (!isInvitation && response.status === 500)) {
				location.reload();

				return;
			}

			// SAFETY: this calls src/pages/api/owner/projects/[id]/invitation.ts. Its replies are JSON except a plain-text "Not found" 404 sent when the client portal is off, which makes json() throw into the catch below. error is optional because some failures carry it (musicRequest's JSON errors among them) and others are a bare { ok: false }, so a missing one falls back to the local message. It is read only after the response.ok check has returned.
			const result = (await response.json()) as { error?: string };
			status.textContent = result.error ?? failure;
		} catch {
			// A brief copy request that gave no readable answer (the fetch failed, or an edge page that is not JSON came back) may have reached the server and claimed the copy. The page shows the recorded status and only the buttons it allows, as after a 500, so a second click cannot send a second copy.
			if (!isInvitation) {
				location.reload();

				return;
			}

			status.textContent = failure;
		}

		button.disabled = false;
	});
}
