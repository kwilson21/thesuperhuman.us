import { feedChange } from "~/lib/project-story";
import type { ProjectFeed } from "~/lib/publication/read";

export function setupProjectUpdatesFeed() {
	document
		.querySelectorAll<HTMLElement>("[data-project-updates]")
		.forEach((root) => {
			// SAFETY: data-snapshot is JSON.stringify(feed) from src/components/ProjectUpdates.astro (line 97) when notices show. When the attribute is absent, the "null" fallback parses to null, which the type allows.
			let previous = JSON.parse(
				root.dataset.snapshot || "null",
			) as ProjectFeed | null;

			let cleared = false;
			const notice = root.querySelector<HTMLElement>("[data-notice]")!;

			function clearPublished() {
				if (cleared) return;
				const content = root.querySelector("[data-update-content]")!;

				const curated = root.querySelector<HTMLTemplateElement>(
					"[data-curated-fallback]",
				);

				// The fallback is an expanded, script-free reading view of repository-owned work.
				content.replaceChildren(
					...(curated ? [curated.content.cloneNode(true)] : []),
				);
				delete root.dataset.snapshot;
				cleared = true;
			}

			async function poll() {
				try {
					const response = await fetch(
						`/api/work-feed?project=${encodeURIComponent(root.dataset.project!)}`,
						{ cache: "no-store", signal: AbortSignal.timeout(10000) },
					);

					if (response.status === 404) {
						clearPublished();
						previous = null;
						notice.hidden = false;
						notice.querySelector("span")!.textContent =
							"This project’s published updates have been removed.";

						return;
					}

					if (!response.ok) throw new Error("Feed unavailable");
					const next = (await response.json()) as ProjectFeed;

					if (
						next.projectId !== root.dataset.project ||
						!Array.isArray(next.history) ||
						!Number.isSafeInteger(next.revision)
					)
						return;
					const change = previous ? feedChange(previous, next) : "new";

					if (change === "replace") {
						clearPublished();
					}

					if (change === "new" || change === "replace") {
						notice.hidden = false;
						notice.querySelector("span")!.textContent =
							change === "replace"
								? "Published work has been corrected or withdrawn. The earlier version has been cleared."
								: "New project updates are ready when you are.";
					}
				} catch {
					notice.hidden = false;
					notice.querySelector("span")!.textContent =
						cleared || !previous
							? "Live updates are temporarily unavailable."
							: "Live updates are unavailable. Showing the last loaded version.";
				} finally {
					setTimeout(poll, 15000);
				}
			}

			setTimeout(poll, 15000);
		});
}
