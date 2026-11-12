export function setupProjectTimeline() {
	document.querySelectorAll<HTMLElement>("[data-timeline]").forEach((root) => {
		const picks = [...root.querySelectorAll<HTMLButtonElement>("[data-pick]")];
		const panels = [...root.querySelectorAll<HTMLElement>("[data-panel]")];
		if (!picks.length) return;
		const controls = root.querySelector<HTMLElement>("[data-controls]")!;
		// Absent when there is only one entry: nothing to page between, so the row isn't rendered.
		const previous = root.querySelector<HTMLButtonElement>("[data-prev]");
		const next = root.querySelector<HTMLButtonElement>("[data-next]");
		const position = root.querySelector<HTMLElement>("[data-position]");
		const all = root.querySelector<HTMLButtonElement>("[data-all]");
		const pagePrev = root.querySelector<HTMLButtonElement>("[data-page-prev]");
		const pageNext = root.querySelector<HTMLButtonElement>("[data-page-next]");
		const pagePosition = root.querySelector<HTMLElement>(
			"[data-page-position]",
		);
		const pageSize = Number(root.dataset.pageSize) || picks.length;
		const pageCount = Math.max(1, Math.ceil(picks.length / pageSize));
		let selected = panels.findIndex(
			(panel) => "#" + panel.id === location.hash,
		);
		if (selected < 0 && root.dataset.selectedId)
			selected = panels.findIndex(
				(panel) => panel.id === root.dataset.selectedId,
			);
		if (selected < 0)
			selected = root.dataset.order === "oldest" ? panels.length - 1 : 0;
		let page = Math.floor(selected / pageSize);
		let showAll = false;
		function render(scroll = true) {
			page = Math.floor(selected / pageSize);
			picks.forEach(
				(pick, i) => (pick.hidden = Math.floor(i / pageSize) !== page),
			);
			if (pagePrev) pagePrev.disabled = page === 0;
			if (pageNext) pageNext.disabled = page === pageCount - 1;
			if (pagePosition)
				pagePosition.textContent = `Page ${page + 1} of ${pageCount}`;
			panels.forEach((panel, i) => (panel.hidden = !showAll && i !== selected));
			picks.forEach((pick, i) =>
				pick.setAttribute("aria-pressed", String(i === selected)),
			);
			if (previous) previous.disabled = selected === 0;
			if (next) next.disabled = selected === picks.length - 1;
			if (position) position.textContent = `${selected + 1} / ${picks.length}`;
			if (all) {
				all.setAttribute("aria-pressed", String(showAll));
				all.textContent = showAll ? "Show selected entry" : "Show all entries";
			}
			if (scroll) {
				const strip = picks[selected].parentElement!;
				strip.scrollLeft = picks[selected].offsetLeft - strip.offsetLeft;
			}
		}
		function choose(index: number) {
			selected = index;
			showAll = false;
			render();
		}
		picks.forEach((pick, i) => {
			pick.addEventListener("click", () => choose(i));
			pick.addEventListener("keydown", (event) => {
				const target =
					event.key === "Home"
						? 0
						: event.key === "End"
							? picks.length - 1
							: event.key === "ArrowRight" || event.key === "ArrowDown"
								? Math.min(i + 1, picks.length - 1)
								: event.key === "ArrowLeft" || event.key === "ArrowUp"
									? Math.max(i - 1, 0)
									: -1;
				if (target >= 0) {
					event.preventDefault();
					choose(target);
					picks[target].focus();
				}
			});
		});
		previous?.addEventListener("click", () =>
			choose(Math.max(0, selected - 1)),
		);
		next?.addEventListener("click", () =>
			choose(Math.min(picks.length - 1, selected + 1)),
		);
		// Paging moves the selection to the first entry of the new page, so the open panel always matches the list.
		pagePrev?.addEventListener("click", () => choose((page - 1) * pageSize));
		pageNext?.addEventListener("click", () => choose((page + 1) * pageSize));
		all?.addEventListener("click", () => {
			showAll = !showAll;
			render(false);
		});
		function followHash() {
			const index = panels.findIndex(
				(panel) => "#" + panel.id === location.hash,
			);
			if (index < 0) return;
			choose(index);
			panels[index].scrollIntoView({ block: "start" });
		}
		window.addEventListener("hashchange", followHash);
		controls.hidden = false;
		render();
		if (panels.some((panel) => "#" + panel.id === location.hash)) followHash();
		new ResizeObserver(() => render()).observe(root);
	});
}
