/**
 * The Get in touch switchboard (Switchboard.astro). Every line is a link, so the board works
 * without this script. With it, the visitor's own plug hangs from the "You" jack: it reaches
 * toward a line on a fine pointer's hover or on keyboard focus, seats in the jack on a click or
 * tap, and can be picked up and dropped on a jack. A seated line lights its lamp, and the board
 * says where it is putting the visitor through before the page changes. With reduced motion the
 * plug moves without animating and the page changes at once. Every motion settles within a second.
 */

type Point = { x: number; y: number };

type Target =
	| { kind: "rest" }
	| { kind: "reach"; link: HTMLAnchorElement }
	| { kind: "seated"; link: HTMLAnchorElement }
	| { kind: "drag"; point: Point; near: HTMLAnchorElement | null };

export type SwitchboardOptions = {
	/** Called when the message line is connected; the page opens its form instead of navigating. */
	onMessage?: () => void;
};

export type Switchboard = { connect: (id: string) => void };

// A slightly under-damped spring: the plug overshoots a touch and settles in well under a second.
const STIFFNESS = 320;
const DAMPING = 26;
const LIFTED = 1.14;
// Long enough to see the lamp strike, short enough not to feel like a wait.
const PUT_THROUGH_MS = 560;
// How close a dragged plug must come to a jack to seat in it.
const SNAP = 44;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

export function setupSwitchboard(
	root: HTMLElement,
	options: SwitchboardOptions = {},
): Switchboard | null {
	const board = root.querySelector<HTMLElement>("[data-board]");
	const svg = root.querySelector<SVGSVGElement>("[data-cable-layer]");
	const cable = root.querySelector<SVGPathElement>("[data-cable]");
	const cableShadow = root.querySelector<SVGPathElement>("[data-cable-shadow]");
	const plug = root.querySelector<SVGGElement>("[data-plug]");
	const plugShadow = root.querySelector<SVGCircleElement>("[data-plug-shadow]");
	const fixed = root.querySelector<SVGGElement>("[data-plug-fixed]");
	const youJack = root.querySelector<HTMLElement>("[data-you-jack]");
	const handle = root.querySelector<HTMLElement>("[data-plug-handle]");
	const hint = root.querySelector<HTMLElement>("[data-switchboard-hint]");
	const links = [...root.querySelectorAll<HTMLAnchorElement>("a[data-line]")];

	if (
		!board ||
		!svg ||
		!cable ||
		!cableShadow ||
		!plug ||
		!plugShadow ||
		!fixed ||
		!youJack ||
		!handle ||
		!links.length
	)
		return null;

	const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
	const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
	const restingHint = () =>
		finePointer.matches
			? "Click a line, or drag your plug onto one."
			: "Tap a line, or drag your plug onto one.";

	let target: Target = { kind: "rest" };
	let connecting = false;
	let frame = 0;
	let last = 0;
	let boardBox = board.getBoundingClientRect();
	const position: Point = { x: 0, y: 0 };
	const velocity: Point = { x: 0, y: 0 };
	let scale = 1;
	let scaleVelocity = 0;
	let measured = false;

	const jackOf = (link: HTMLAnchorElement) =>
		link.querySelector<HTMLElement>("[data-jack]")!;

	function centre(element: Element): Point {
		const box = element.getBoundingClientRect();

		return {
			x: box.left + box.width / 2 - boardBox.left,
			y: box.top + box.height / 2 - boardBox.top,
		};
	}

	const layout = () =>
		getComputedStyle(root).getPropertyValue("--sb-layout").trim() === "column"
			? "column"
			: "row";

	// Where the free plug lies when nothing is chosen: under your jack on a wide board, beside it on a narrow one.
	function restPoint(): Point {
		const you = centre(youJack!);

		return layout() === "row"
			? { x: you.x + 20, y: you.y + 62 }
			: { x: you.x + 92, y: you.y + 2 };
	}

	function goal(): { point: Point; scale: number } {
		switch (target.kind) {
			case "rest":
				return { point: restPoint(), scale: 1 };
			case "reach": {
				const jack = centre(jackOf(target.link));

				return { point: { x: jack.x - 4, y: jack.y - 7 }, scale: LIFTED };
			}
			case "seated":
				return { point: centre(jackOf(target.link)), scale: 1 };
			case "drag":
				if (target.near) {
					const jack = centre(jackOf(target.near));

					return { point: { x: jack.x - 3, y: jack.y - 5 }, scale: LIFTED };
				}

				return { point: target.point, scale: LIFTED };
		}
	}

	// The cable leaves each plug toward the viewer and falls: on a wide board it hangs in a curve
	// below the jacks; on a narrow one it runs down the left of the jacks, bowed outward.
	function cablePath(from: Point, to: Point) {
		const dx = to.x - from.x;
		const dy = to.y - from.y;

		if (layout() === "row" || Math.abs(dy) < 36) {
			const sag = clamp(Math.hypot(dx, dy) * 0.22, 30, 112);

			return `M ${from.x} ${from.y} C ${from.x + dx * 0.12} ${from.y + sag}, ${to.x - dx * 0.12} ${to.y + sag}, ${to.x} ${to.y}`;
		}

		// It may swing past the board's left edge into the page gutter; content past a left edge never scrolls.
		const bow = Math.max(0, Math.min(Math.abs(dy) * 0.12, from.x + 12));

		return `M ${from.x} ${from.y} C ${from.x - bow} ${from.y + dy * 0.35}, ${to.x - bow} ${to.y - dy * 0.35}, ${to.x} ${to.y}`;
	}

	function draw() {
		const from = centre(youJack!);
		const path = cablePath(from, position);
		const lift = clamp((scale - 1) / (LIFTED - 1), 0, 1.4);
		cable!.setAttribute("d", path);
		cableShadow!.setAttribute("d", path);
		cableShadow!.setAttribute("transform", "translate(1.5 3)");
		fixed!.setAttribute("transform", `translate(${from.x} ${from.y})`);
		plug!.setAttribute(
			"transform",
			`translate(${position.x} ${position.y}) scale(${scale})`,
		);
		plugShadow!.setAttribute(
			"transform",
			`translate(${position.x + 2 + lift * 4} ${position.y + 3 + lift * 8}) scale(${scale})`,
		);
		handle!.style.translate = `${position.x}px ${position.y}px`;
	}

	function settle() {
		boardBox = board!.getBoundingClientRect();
		const { point, scale: goalScale } = goal();
		position.x = point.x;
		position.y = point.y;
		velocity.x = velocity.y = scaleVelocity = 0;
		scale = goalScale;
		draw();
	}

	function step(time: number) {
		const dt = Math.min((time - last) / 1000, 1 / 30);
		last = time;
		boardBox = board!.getBoundingClientRect();
		const { point, scale: goalScale } = goal();
		velocity.x +=
			(STIFFNESS * (point.x - position.x) - DAMPING * velocity.x) * dt;
		velocity.y +=
			(STIFFNESS * (point.y - position.y) - DAMPING * velocity.y) * dt;
		scaleVelocity +=
			(STIFFNESS * (goalScale - scale) - DAMPING * scaleVelocity) * dt;
		position.x += velocity.x * dt;
		position.y += velocity.y * dt;
		scale += scaleVelocity * dt;
		draw();
		const resting =
			Math.hypot(point.x - position.x, point.y - position.y) < 0.3 &&
			Math.hypot(velocity.x, velocity.y) < 2 &&
			Math.abs(goalScale - scale) < 0.002 &&
			Math.abs(scaleVelocity) < 0.02;

		if (resting) {
			frame = 0;
			settle();

			return;
		}

		frame = requestAnimationFrame(step);
	}

	function move() {
		if (!measured) return;

		if (reduced.matches) {
			settle();

			return;
		}

		if (frame) return;
		last = performance.now();
		frame = requestAnimationFrame(step);
	}

	function setTarget(next: Target) {
		target = next;
		move();
	}

	function lightOnly(link: HTMLAnchorElement | null) {
		for (const each of links) {
			each.classList.toggle("is-lit", each === link);
			each.classList.remove("is-near");
		}
	}

	function connect(link: HTMLAnchorElement) {
		if (connecting) return;
		lightOnly(link);
		setTarget({ kind: "seated", link });

		if (hint) hint.textContent = link.dataset.connecting ?? "";

		if (link.dataset.line === "message" && options.onMessage) {
			options.onMessage();

			return;
		}

		connecting = true;
		root.setAttribute("aria-busy", "true");
		window.setTimeout(
			() => window.location.assign(link.href),
			reduced.matches ? 0 : PUT_THROUGH_MS,
		);
	}

	function seatedLink() {
		return target.kind === "seated" ? target.link : null;
	}

	function reset() {
		connecting = false;
		root.removeAttribute("aria-busy");
		lightOnly(null);
		target = { kind: "rest" };

		if (hint) hint.textContent = restingHint();
		settle();
	}

	for (const link of links) {
		link.addEventListener("click", (event) => {
			if (
				event.defaultPrevented ||
				event.button !== 0 ||
				event.metaKey ||
				event.ctrlKey ||
				event.shiftKey ||
				event.altKey
			)
				return;
			event.preventDefault();
			connect(link);
		});
		link.addEventListener("pointerenter", (event) => {
			if (
				event.pointerType !== "touch" &&
				finePointer.matches &&
				!connecting &&
				!seatedLink() &&
				target.kind !== "drag"
			)
				setTarget({ kind: "reach", link });
		});
		link.addEventListener("focus", () => {
			if (!connecting && !seatedLink() && target.kind !== "drag")
				setTarget({ kind: "reach", link });
		});
		link.addEventListener("blur", () => {
			if (target.kind === "reach" && target.link === link)
				setTarget({ kind: "rest" });
		});
	}

	board.addEventListener("pointerleave", () => {
		if (target.kind === "reach" && document.activeElement !== target.link)
			setTarget({ kind: "rest" });
	});

	// Picking up the plug: it follows the pointer and snaps over the nearest jack in reach.
	function local(event: PointerEvent): Point {
		boardBox = board!.getBoundingClientRect();

		return {
			x: event.clientX - boardBox.left,
			y: event.clientY - boardBox.top,
		};
	}

	function nearest(point: Point) {
		let best: HTMLAnchorElement | null = null;
		let distance = SNAP;

		for (const link of links) {
			const jack = centre(jackOf(link));
			const gap = Math.hypot(jack.x - point.x, jack.y - point.y);

			if (gap < distance) {
				distance = gap;
				best = link;
			}
		}

		return best;
	}

	handle.addEventListener("pointerdown", (event) => {
		if (connecting || event.button !== 0) return;
		event.preventDefault();
		handle.setPointerCapture(event.pointerId);
		root.classList.add("is-dragging");
		lightOnly(null);
		setTarget({ kind: "drag", point: local(event), near: null });
	});
	handle.addEventListener("pointermove", (event) => {
		if (target.kind !== "drag") return;
		const point = local(event);
		const near = nearest(point);

		for (const link of links) link.classList.toggle("is-near", link === near);
		setTarget({ kind: "drag", point, near });
	});

	function drop() {
		if (target.kind !== "drag") return;
		root.classList.remove("is-dragging");
		const near = target.near;

		if (near) connect(near);
		else {
			lightOnly(null);
			setTarget({ kind: "rest" });
		}
	}

	handle.addEventListener("pointerup", drop);
	handle.addEventListener("pointercancel", () => {
		if (target.kind !== "drag") return;
		root.classList.remove("is-dragging");
		lightOnly(null);
		setTarget({ kind: "rest" });
	});

	function measure() {
		const box = board!.getBoundingClientRect();
		svg!.setAttribute(
			"viewBox",
			`0 0 ${Math.max(1, box.width)} ${Math.max(1, box.height)}`,
		);

		if (target.kind !== "drag") settle();
	}

	root.classList.add("is-wired");

	if (hint) {
		hint.textContent = restingHint();
		hint.hidden = false;
	}

	measured = true;
	measure();
	new ResizeObserver(measure).observe(board);
	finePointer.addEventListener("change", () => {
		if (!connecting && hint && !seatedLink()) hint.textContent = restingHint();
	});
	// Back and forward restore the page as it was left; put the plug back and the lamps out.
	window.addEventListener("pageshow", (event) => {
		if (event.persisted) reset();
	});

	return {
		connect(id: string) {
			const link = links.find((each) => each.dataset.line === id);

			if (link) connect(link);
		},
	};
}
