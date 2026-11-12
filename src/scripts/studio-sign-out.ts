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
