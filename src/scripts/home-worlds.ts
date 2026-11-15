// Home's scenes on top of the shared motion layer (scroll-scenes.ts): the studio plays
// once on arrival and again when the visitor comes back to it or points at it (the picture
// itself stays still), the waveform edge follows scroll, and the capacity figure counts up
// when it reveals.
import {
	barsPath,
	capacityCells,
	easeOutCubic,
	formatFigure,
	parseFigure,
	musicFrame,
	signalFrame,
	waveformPeaks,
} from "~/lib/home-motion";
import {
	COMPARISON_SIGNAL,
	ComparisonSignal,
} from "~/scripts/comparison-signal";
import { runMotion, scenePlayer } from "~/scripts/scroll-scenes";

runMotion(({ signal, finePointer, onScene, onReveal, cleanup }) => {
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

		if (finePointer) {
			let frame = 0;
			let inside = false;
			studio.addEventListener(
				"pointermove",
				(event) => {
					cancelAnimationFrame(frame);
					frame = requestAnimationFrame(() => {
						const box = scene.getBoundingClientRect();

						const over =
							event.clientX > box.left + box.width * 0.3 &&
							event.clientX < box.right &&
							event.clientY > box.top &&
							event.clientY < box.bottom;

						// Replays when the pointer arrives over the studio, not continuously while it stays.
						if (over && !inside) player.play();
						inside = over;
					});
				},
				{ signal },
			);
			studio.addEventListener(
				"pointerleave",
				() => {
					inside = false;
				},
				{ signal },
			);
			cleanup(() => cancelAnimationFrame(frame));
		}
	}

	// Sound: the waveform edge is redrawn from its scroll progress, and while the A/B comparison plays, from the music:
	// the edge rises and falls with its level, and the horizon sun glows with it. Both come to rest when it stops.
	const signalEdge = document.querySelector<HTMLElement>(
		'[data-scene="signal"]',
	);

	if (signalEdge) {
		const bars = Number(signalEdge.dataset.bars);
		const width = Number(signalEdge.dataset.width);
		const mid = Number(signalEdge.dataset.mid);

		// Old News's real waveform when the page gives it, as the resting frame was drawn.
		const given = (signalEdge.dataset.peaks ?? "")
			.split(",")
			.filter(Boolean)
			.map(Number);

		const peaks =
			given.length === bars && given.every(Number.isFinite)
				? given
				: waveformPeaks(bars);

		const up = signalEdge.querySelector('[data-signal="up"]');
		const down = signalEdge.querySelector('[data-signal="down"]');

		const rest = {
			up: up?.getAttribute("d") ?? "",
			down: down?.getAttribute("d") ?? "",
		};

		const draw = (heights: number[]) => {
			up?.setAttribute(
				"d",
				barsPath(heights, { width, mid, depth: mid, direction: "up" }),
			);
			down?.setAttribute(
				"d",
				barsPath(heights, { width, mid, depth: mid, direction: "down" }),
			);
		};

		const horizon = document.querySelector<HTMLElement>(".horizon");

		// The last scroll progress, the music's level smoothed, and whether music is driving the edge now.
		let progress = 0.5,
			level = 0,
			playing = false,
			onScreen = false;

		// Off screen, the edge is left alone while the music plays; the sun still follows it.
		const edgeWatch = new IntersectionObserver(
			(entries) => (onScreen = entries[entries.length - 1].isIntersecting),
		);

		edgeWatch.observe(signalEdge);

		onScene(signalEdge, (scrolled) => {
			progress = scrolled;

			if (!playing) draw(signalFrame(peaks, progress));
		});

		document.addEventListener(
			COMPARISON_SIGNAL,
			(event) => {
				if (!(event instanceof ComparisonSignal)) return;

				// Stopped: the edge goes back to its scroll frame and the sun to its own light.
				if (!event.playing) {
					playing = false;
					level = 0;
					draw(signalFrame(peaks, progress));
					horizon?.style.removeProperty("--glow");

					return;
				}

				playing = true;
				// Quick to rise and slower to fall, as a meter's needle.
				level += (event.level - level) * (event.level > level ? 0.5 : 0.12);
				horizon?.style.setProperty("--glow", level.toFixed(3));

				if (onScreen) draw(musicFrame(peaks, level, performance.now() / 1000));
			},
			{ signal },
		);
		cleanup(() => {
			edgeWatch.disconnect();
			up?.setAttribute("d", rest.up);
			down?.setAttribute("d", rest.down);
			horizon?.style.removeProperty("--glow");
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
