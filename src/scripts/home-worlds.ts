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
	musicFrame,
	signalFrame,
	waveformPeaks,
} from "~/lib/home-motion";
import { followComparison } from "~/scripts/home-signal";
import { runMotion, scenePlayer } from "~/scripts/scroll-scenes";

runMotion(({ signal, onScene, onReveal, cleanup }) => {
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

		// The sun's glow at a level while music plays (it follows at once), or none (it fades) once it stops.
		const glow = (level?: number) => {
			if (!horizon) return;

			if (level === undefined) {
				delete horizon.dataset.playing;
				horizon.style.removeProperty("--glow");

				return;
			}

			horizon.dataset.playing = "";
			horizon.style.setProperty("--glow", level.toFixed(3));
		};

		// The last scroll progress, and whether music is driving the edge now.
		let progress = 0.5,
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

		followComparison(
			document,
			{
				playing(level) {
					playing = true;
					glow(level);

					if (onScreen)
						draw(musicFrame(peaks, level, performance.now() / 1000));
				},
				// Stopped: the edge goes back to its scroll frame, and the sun's glow fades.
				stopped() {
					playing = false;
					draw(signalFrame(peaks, progress));
					glow();
				},
			},
			signal,
		);
		cleanup(() => {
			edgeWatch.disconnect();
			up?.setAttribute("d", rest.up);
			down?.setAttribute("d", rest.down);
			glow();
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
