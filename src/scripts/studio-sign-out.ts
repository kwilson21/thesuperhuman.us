export function setupStudioSignOut() {
	document
		.querySelector("#studio-sign-out")
		?.addEventListener("click", async () => {
			const status = document.querySelector<HTMLElement>(
				"#studio-sign-out-status",
			);

			try {
				const response = await fetch("/api/studio/sign-out", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: "{}",
				});

				// SAFETY: src/pages/api/studio/sign-out.ts answers with JSON: { ok: true } on success and { ok: false, localSignedOut: true } with status 503 when the database is missing or revocation fails. Only its plain-text 404 ("Not found", sent when the client portal is off) is not JSON, and json() then throws into the catch below. localSignedOut is optional and read only on the non-ok path.
				const result = (await response.json()) as { localSignedOut?: boolean };

				if (response.ok) {
					location.assign("/studio/sign-in");

					return;
				}

				if (result.localSignedOut) {
					location.assign("/studio/sign-in?signout=partial");

					return;
				}
			} catch {
				/* Display the same retry message below. */
			}

			if (status) status.textContent = "Could not sign out. Please try again.";
		});
}
