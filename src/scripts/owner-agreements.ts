import { unchangedLabel, type DiffRow } from "~/lib/line-diff";

export function setupOwnerAgreements() {
	type Comparison = { label: string; rows: DiffRow[] } | null;

	// The preview and the version history both render through this, so the two views cannot drift.
	const renderComparison = (target: HTMLElement, compare: Comparison) => {
		if (!compare) {
			const note = document.createElement("p");
			note.textContent = "First version. Nothing to compare yet.";
			target.replaceChildren(note);

			return;
		}

		const heading = document.createElement("h3");
		heading.textContent = `Changes from ${compare.label}`;
		const diff = document.createElement("pre");
		diff.className = "template-diff";

		for (const row of compare.rows) {
			const line = document.createElement("span");

			if (row.kind === "unchanged") {
				line.className = "diff-unchanged";
				line.textContent = `${unchangedLabel(row.count)}\n`;
			} else {
				line.className = row.kind === "removed" ? "diff-removed" : "diff-added";
				line.textContent = `${row.kind === "removed" ? "-" : "+"} ${row.text}\n`;
			}

			diff.appendChild(line);
		}

		target.replaceChildren(heading, diff);
	};

	const retentionForm = document.querySelector<HTMLFormElement>(
		"[data-retention-preview]",
	)!;

	retentionForm.addEventListener("submit", async (event) => {
		event.preventDefault();

		const form = retentionForm,
			status = form.querySelector<HTMLElement>('[role="status"]')!;

		try {
			const response = await fetch("/api/owner/agreements", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ action: "retention-preview" }),
				}),
				// SAFETY: the agreements endpoint answers with JSON; error is read only after the !response.ok throw, and manifest only after it too.
				result = (await response.json()) as {
					error: string;
					manifest: unknown;
				};

			if (!response.ok) throw new Error(result.error);
			form.querySelector<HTMLElement>(
				"[data-retention-preview-output]",
			)!.textContent = JSON.stringify(result.manifest, null, 2);
			document.querySelector<HTMLTextAreaElement>('[name="manifest"]')!.value =
				JSON.stringify(result.manifest);
			status.textContent =
				"Review this exact manifest before applying cleanup.";
		} catch (error) {
			status.textContent =
				error instanceof Error ? error.message : String(error);
		}
	});

	for (const form of document.querySelectorAll<HTMLFormElement>(
		"[data-template-editor],[data-agreement-config]",
	))
		form.addEventListener("submit", async (event) => {
			event.preventDefault();

			const data = Object.fromEntries(new FormData(form)),
				// SAFETY: these forms (src/pages/owner/agreements.astro, lines 56 and 57) submit through one of their own buttons, so event.submitter is that button. This script never calls requestSubmit() without one.
				button = event.submitter as HTMLButtonElement;

			let payload;

			if (form.hasAttribute("data-agreement-config")) {
				const { action, expectedCurrentVersion, ...values } = data;
				payload = {
					action,
					expectedCurrentVersion: Number(expectedCurrentVersion),
					values: {
						...values,
						registered_agent_confirmed:
							data.registered_agent_confirmed === "on",
					},
				};
			} else
				payload = {
					...data,
					action: button.value,
					expectedCurrentVersion: Number(data.expectedCurrentVersion),
					confirmed: data.confirmed === "true",
				};
			const status = form.querySelector<HTMLElement>('[role="status"]')!;

			// Clear the last diff and show the region before the request, so the new diff is announced when it arrives.
			if (
				form.hasAttribute("data-template-editor") &&
				button.value === "preview"
			) {
				const diff = form.querySelector<HTMLElement>("[data-template-diff]");

				if (diff) {
					diff.replaceChildren();
					diff.hidden = false;
				}
			}

			try {
				// SAFETY: the agreements endpoint answers with JSON; error is read only after the !r.ok throw, and text and compare only after it, when the request succeeded.
				const r = await fetch(form.getAttribute("action")!, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(payload),
					}),
					result = (await r.json()) as {
						error: string;
						text?: string;
						compare?: Comparison;
					};

				if (!r.ok) throw new Error(result.error);

				if (result.text) {
					form.querySelector<HTMLElement>(
						"[data-template-preview]",
					)!.textContent = result.text;
					const diff = form.querySelector<HTMLElement>("[data-template-diff]")!;
					diff.hidden = false;
					renderComparison(diff, result.compare ?? null);
				} else location.reload();
			} catch (e) {
				status.textContent = e instanceof Error ? e.message : String(e);
			}
		});

	for (const button of document.querySelectorAll<HTMLButtonElement>(
		"[data-template-version]",
	))
		button.addEventListener("click", async () => {
			const output = button
				.closest("li")!
				.querySelector<HTMLElement>("[data-template-version-output]")!;

			try {
				const response = await fetch("/api/owner/agreements", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							action: "template-version",
							kind: button.dataset.kind,
							version: Number(button.dataset.version),
						}),
					}),
					// SAFETY: the agreements endpoint answers with JSON; error is read only after the !response.ok throw, and text and compare only after it too.
					result = (await response.json()) as {
						error: string;
						text?: string;
						compare?: Comparison;
					};

				if (!response.ok) throw new Error(result.error);

				if (button.dataset.view === "text") {
					const text = document.createElement("pre");
					text.className = "template-text";
					text.textContent = result.text ?? "";
					output.replaceChildren(text);
				} else renderComparison(output, result.compare ?? null);
			} catch (error) {
				const message = document.createElement("p");
				message.textContent =
					error instanceof Error ? error.message : String(error);
				output.replaceChildren(message);
			}

			// Focus moves to the new content, so a screen reader announces it without reading the whole output.
			// SAFETY: output always has a child here. renderComparison replaces its children with a note or a heading and a diff, the text view adds a pre, and the catch adds a p.
			const shown = output.firstElementChild as HTMLElement;
			shown.tabIndex = -1;
			shown.focus();
		});
}
