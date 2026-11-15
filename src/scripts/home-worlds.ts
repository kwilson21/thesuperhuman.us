// Home's scenes on top of the shared motion layer (scroll-scenes.ts): the studio plays
// once on arrival and again when the visitor comes back to it (the picture itself stays
// still; pointing at one object plays that object's scene, in studio-objects.ts), the
// waveform edge follows scroll, and the capacity figure counts up when it reveals.
import {
	barsPath,
	capacityCells,
	easeOutCubic,
	formatFigure,
	parseFigure,
	signalFrame,
	waveformPeaks,
} from "~/lib/home-motion";
import { runMotion, scenePlayer } from "~/scripts/scroll-scenes";

runMotion(({ onScene, onReveal, cleanup }) => {
	// Studio: the three short scenes rest within five seconds and never loop.
	const studio = document.querySelector<HTMLElement>("[data-studio]");
	const scene = studio?.querySelector<HTMLElement>("[data-studio-scene]");

	if (studio && scene) {
		const player = scenePlayer(scene, 4800);
		player.play();
		let away = false;

		const heroWatch = new IntersectionObserver((entries) => {
			const entry = entries[entries.length - 1];

			if (!entry.isIntersecting) away = true;
			else if (away) {
				away = false;
				player.play();
			}
		});

		heroWatch.observe(studio);
		cleanup(() => {
			heroWatch.disconnect();
			player.stop();
		});
	}

	// Sound: the waveform edge is redrawn from its scroll progress.
	const signalEdge = document.querySelector<HTMLElement>(
		'[data-scene="signal"]',
	);

	if (signalEdge) {
		const bars = Number(signalEdge.dataset.bars);
		const width = Number(signalEdge.dataset.width);
		const mid = Number(signalEdge.dataset.mid);
		const peaks = waveformPeaks(bars);
		const up = signalEdge.querySelector('[data-signal="up"]');
		const down = signalEdge.querySelector('[data-signal="down"]');

		const rest = {
			up: up?.getAttribute("d") ?? "",
			down: down?.getAttribute("d") ?? "",
		};

		onScene(signalEdge, (progress) => {
			const heights = signalFrame(peaks, progress);
			up?.setAttribute(
				"d",
				barsPath(heights, { width, mid, depth: mid, direction: "up" }),
			);
			down?.setAttribute(
				"d",
				barsPath(heights, { width, mid, depth: mid, direction: "down" }),
			);
		});
		cleanup(() => {
			up?.setAttribute("d", rest.up);
			down?.setAttribute("d", rest.down);
		});
	}

	// Capacity: the figure counts from the old capacity to the new one as its cells light.
	document.querySelectorAll<HTMLElement>("[data-count]").forEach((element) => {
		const from = parseFigure(element.dataset.countFrom ?? "");
		const to = parseFigure(element.dataset.count ?? "");
		const display = element.querySelector<HTMLElement>("[data-count-display]");
		const cells = element.querySelector<HTMLElement>("[data-count-cells]");

		if (!from || !to || !display) return;
		const total = capacityCells(from, to);
		// In-between numbers are plain; the "+" belongs to the final figure only.
		const counting = { ...to, suffix: "" };
		let frame = 0;

		// Below the fold it waits, hidden (it is a [data-reveal] block), at the old capacity, so
		// the count never visibly jumps back or shows no change.
		if (element.getBoundingClientRect().top >= innerHeight) {
			display.textContent = formatFigure(counting, from.value);
			cells?.style.setProperty("--lit", "1");
		}

		onReveal(element, () => {
			const began = performance.now();

			const tick = (now: number) => {
				const t = easeOutCubic((now - began) / 1600);
				const value = from.value + (to.value - from.value) * t;
				display.textContent =
					t < 1 ? formatFigure(counting, value) : formatFigure(to);
				cells?.style.setProperty(
					"--lit",
					String(Math.max(1, Math.round((value / to.value) * total))),
				);

				if (t < 1) frame = requestAnimationFrame(tick);
			};

			display.textContent = formatFigure(counting, from.value);
			cells?.style.setProperty("--lit", "1");
			frame = requestAnimationFrame(tick);
		});
		cleanup(() => {
			cancelAnimationFrame(frame);
			display.textContent = formatFigure(to);
			cells?.style.removeProperty("--lit");
		});
	});
});
