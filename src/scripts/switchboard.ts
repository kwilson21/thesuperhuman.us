/**
 * The Get in touch switchboard (Switchboard.astro). Every line is a link, so the board works
 * without this script. With it, the visitor's own plug hangs from the "You" jack: it reaches
 * toward a line on a fine pointer's hover or on keyboard focus, seats in the jack on a click or
 * tap, and can be picked up and dropped on a jack. A seated line lights its lamp, and the board
 * says where it is putting the visitor through before the page changes. With reduced motion the
 * plug moves without animating and the page changes at once. The plug settles in about half a
 * second and the cable within three.
 */

type Point = { x: number; y: number };

// Where the plug is heading and how far it is lifted toward the viewer (1 is flat on the board).
type Goal = { point: Point; scale: number };

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

// A slightly under-damped spring: the plug overshoots a touch as it seats or drops and settles in
// about half a second. Reaching toward a line on hover or focus is quicker and critically damped, so
// the plug keeps up with a sweeping pointer and never overshoots.
const STIFFNESS = 420;
const DAMPING = 30;
const REACH_STIFFNESS = 700;
const REACH_DAMPING = 53;
const LIFTED = 1.14;

// Long enough to see the lamp strike, short enough not to feel like a wait.
const PUT_THROUGH_MS = 560;

// How close a dragged plug must come to a jack to seat in it.
const SNAP = 44;

// The cable is a chain of points under gravity, pinned at your jack and at the plug (Verlet
// integration with distance constraints, stepped at a fixed rate). Its length is the length of the
// resting curve between its two ends, so it hangs about as drawn, and it whips and sways as the plug
// moves. Friction settles it within a couple of seconds.
const LINKS = 16;
const ROPE_STEP = 1 / 120;
const ROPE_FRICTION = 0.98;
const ROPE_PASSES = 12;

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
	const youLabel = root.querySelector<HTMLElement>(".you-label");
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

	// The page renders both wordings of the hint and CSS shows the one for the pointer; a put-through
	// replaces them with its own sentence, and a reset puts them back.
	const restingHint = hint
		? [...hint.childNodes].map((node) => node.cloneNode(true))
		: [];

	const showRestingHint = () =>
		hint?.replaceChildren(...restingHint.map((node) => node.cloneNode(true)));

	let target: Target = { kind: "rest" };
	let connecting = false;
	let putThrough = 0;
	let frame = 0;
	let last = 0;
	let boardBox = board.getBoundingClientRect();
	const position: Point = { x: 0, y: 0 };
	const velocity: Point = { x: 0, y: 0 };
	let scale = 1;
	let scaleVelocity = 0;
	let measured = false;
	let rope: Point[] = [];
	let ropeBefore: Point[] = [];
	let ropeClock = 0;
	let ropeStirring = 0;

	// Where everything sits on the board, read only when the board's layout changes (measure), so the
	// animation frames never ask the page for layout.
	let layoutKind: "row" | "column" = "row";
	let youPoint: Point = { x: 0, y: 0 };
	let restAt: Point = { x: 0, y: 0 };
	const jackPoints = new Map<HTMLAnchorElement, Point>();

	const jackOf = (link: HTMLAnchorElement) =>
		link.querySelector<HTMLElement>("[data-jack]")!;

	const jackCentre = (link: HTMLAnchorElement) =>
		jackPoints.get(link) ?? { x: 0, y: 0 };

	function centre(element: Element): Point {
		const box = element.getBoundingClientRect();

		return {
			x: box.left + box.width / 2 - boardBox.left,
			y: box.top + box.height / 2 - boardBox.top,
		};
	}

	const layout = () => layoutKind;

	// Where the free plug lies when nothing is chosen: under your jack on a wide board, beside it on a
	// narrow one, past the "You" label at whatever size the text is.
	function restPoint(): Point {
		const you = youPoint;

		if (layout() === "row") return { x: you.x + 20, y: you.y + 62 };

		const label = youLabel?.getBoundingClientRect();
		const after = label ? label.right - boardBox.left + 32 : you.x + 92;

		return {
			x: Math.min(Math.max(you.x + 92, after), boardBox.width - 24),
			y: you.y + 2,
		};
	}

	// A lifted plug sits square over its jack; the larger plug and its shadow show the lift.
	function goal(): Goal {
		switch (target.kind) {
			case "rest":
				return { point: restAt, scale: 1 };
			case "reach":
				return { point: jackCentre(target.link), scale: LIFTED };
			case "seated":
				return { point: jackCentre(target.link), scale: 1 };
			case "drag":
				return {
					point: target.near ? jackCentre(target.near) : target.point,
					scale: LIFTED,
				};
		}
	}

	// The cable leaves each plug toward the viewer and falls: on a wide board it hangs in a curve
	// below the jacks; on a narrow one it runs down the left of the jacks, bowed outward.
	function sagCurve(from: Point, to: Point): [Point, Point] {
		const dx = to.x - from.x;
		const sag = clamp(Math.hypot(dx, to.y - from.y) * 0.22, 30, 112);

		return [
			{ x: from.x + dx * 0.12, y: from.y + sag },
			{ x: to.x - dx * 0.12, y: to.y + sag },
		];
	}

	// It may swing past the board's left edge into the page gutter; content past a left edge never scrolls.
	function bowCurve(from: Point, to: Point): [Point, Point] {
		const dy = to.y - from.y;
		const bow = Math.max(0, Math.min(Math.abs(dy) * 0.12, from.x + 12));

		return [
			{ x: from.x - bow, y: from.y + dy * 0.35 },
			{ x: to.x - bow, y: to.y - dy * 0.35 },
		];
	}

	function cableCurve(from: Point, to: Point): [Point, Point] {
		return layout() === "row" || Math.abs(to.y - from.y) < 36
			? sagCurve(from, to)
			: bowCurve(from, to);
	}

	function curveLength(from: Point, to: Point, [a, b]: [Point, Point]) {
		let length = 0;
		let previous = from;

		for (let index = 1; index <= LINKS; index++) {
			const t = index / LINKS;
			const u = 1 - t;

			const point = {
				x:
					u * u * u * from.x +
					3 * u * u * t * a.x +
					3 * u * t * t * b.x +
					t * t * t * to.x,
				y:
					u * u * u * from.y +
					3 * u * u * t * a.y +
					3 * u * t * t * b.y +
					t * t * t * to.y,
			};

			length += Math.hypot(point.x - previous.x, point.y - previous.y);
			previous = point;
		}

		return length;
	}

	// The cable's length for these two ends. On a narrow board it eases between the two resting shapes'
	// lengths as the plug moves away from your jack's row, so the cable never shortens with a jerk.
	function ropeLength(from: Point, to: Point) {
		const sagged = curveLength(from, to, sagCurve(from, to));

		if (layout() === "row") return sagged;
		const blend = clamp((Math.abs(to.y - from.y) - 16) / 48, 0, 1);

		return (
			sagged + (curveLength(from, to, bowCurve(from, to)) - sagged) * blend
		);
	}

	// The resting curve, as points along it.
	function restingRope(from: Point, to: Point): Point[] {
		const [a, b] = cableCurve(from, to);

		return Array.from({ length: LINKS + 1 }, (_, index) => {
			const t = index / LINKS;
			const u = 1 - t;

			return {
				x:
					u * u * u * from.x +
					3 * u * u * t * a.x +
					3 * u * t * t * b.x +
					t * t * t * to.x,
				y:
					u * u * u * from.y +
					3 * u * u * t * a.y +
					3 * u * t * t * b.y +
					t * t * t * to.y,
			};
		});
	}

	function layRope(points: Point[]) {
		rope = points.map((point) => ({ ...point }));
		ropeBefore = points.map((point) => ({ ...point }));
		ropeClock = 0;
		// Counts as moving until a step has measured it, so a frame too short for a step never ends the swing.
		ropeStirring = 1;
	}

	// Pulls toward the floor on a wide board; on a narrow one the board stands on its side, so the
	// cable also drifts out past the jacks' left edge rather than across them.
	function gravity(): Point {
		return layout() === "row" ? { x: 0, y: 1900 } : { x: -1500, y: 800 };
	}

	function swing(dt: number) {
		const from = youPoint;
		const link = ropeLength(from, position) / LINKS;
		const pull = gravity();
		ropeClock = Math.min(ropeClock + dt, ROPE_STEP * 8);

		if (ropeClock >= ROPE_STEP) ropeStirring = 0;

		while (ropeClock >= ROPE_STEP) {
			ropeClock -= ROPE_STEP;

			for (let index = 1; index < LINKS; index++) {
				const point = rope[index];
				const before = ropeBefore[index];
				const vx = (point.x - before.x) * ROPE_FRICTION;
				const vy = (point.y - before.y) * ROPE_FRICTION;
				before.x = point.x;
				before.y = point.y;
				point.x += vx + pull.x * ROPE_STEP * ROPE_STEP;
				point.y += vy + pull.y * ROPE_STEP * ROPE_STEP;
			}

			rope[0] = { ...from };
			rope[LINKS] = { ...position };

			for (let pass = 0; pass < ROPE_PASSES; pass++)
				for (let index = 0; index < LINKS; index++) {
					const a = rope[index];
					const b = rope[index + 1];
					const dx = b.x - a.x;
					const dy = b.y - a.y;
					const gap = Math.hypot(dx, dy) || 0.0001;
					const pullIn = (gap - link) / gap;
					const share = index === 0 || index === LINKS - 1 ? 1 : 0.5;

					if (index !== 0) {
						a.x += dx * pullIn * share;
						a.y += dy * pullIn * share;
					}

					if (index !== LINKS - 1) {
						b.x -= dx * pullIn * share;
						b.y -= dy * pullIn * share;
					}
				}

			// Never so far out past the board's left edge that the gutter loses it.
			for (const point of rope) point.x = Math.max(point.x, -14);

			// How far the cable moved in this step, once the links have pulled it back into shape: at
			// rest gravity and the links cancel out and this falls to nothing.
			for (let index = 1; index < LINKS; index++)
				ropeStirring = Math.max(
					ropeStirring,
					Math.hypot(
						rope[index].x - ropeBefore[index].x,
						rope[index].y - ropeBefore[index].y,
					),
				);
		}
	}

	// A smooth line through the chain: quadratic curves between the midpoints of its links.
	function ropePath() {
		let path = `M ${rope[0].x} ${rope[0].y}`;

		for (let index = 1; index < LINKS - 1; index++) {
			const point = rope[index];
			const next = rope[index + 1];
			path += ` Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`;
		}

		const end = rope[LINKS];
		path += ` Q ${rope[LINKS - 1].x} ${rope[LINKS - 1].y} ${end.x} ${end.y}`;

		return path;
	}

	function draw() {
		const from = youPoint;
		rope[0] = { ...from };
		rope[LINKS] = { ...position };
		const path = ropePath();
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

	// Until the board has been seen, the cable waits straight, ready to drop into its hang.
	let dropPending =
		!reduced.matches && typeof IntersectionObserver !== "undefined";

	function waitingRope(): Point[] {
		return Array.from({ length: LINKS + 1 }, (_, index) => ({
			x: youPoint.x + ((position.x - youPoint.x) * index) / LINKS,
			y:
				youPoint.y +
				((position.y - youPoint.y) * index) / LINKS -
				18 * Math.sin((Math.PI * index) / LINKS),
		}));
	}

	// Puts the plug where it belongs at once. The cable is laid afresh only when asked (or when there
	// is none yet); otherwise it keeps its shape and swings to its new ends.
	function settle(relay = true) {
		const { point, scale: goalScale } = goal();
		position.x = point.x;
		position.y = point.y;
		velocity.x = velocity.y = scaleVelocity = 0;
		scale = goalScale;

		if (relay || !rope.length)
			layRope(dropPending ? waitingRope() : restingRope(youPoint, position));
		draw();
	}

	function step(time: number) {
		const dt = Math.min((time - last) / 1000, 1 / 30);
		last = time;
		const { point, scale: goalScale } = goal();
		const reaching = target.kind === "reach";
		const stiffness = reaching ? REACH_STIFFNESS : STIFFNESS;
		const damping = reaching ? REACH_DAMPING : DAMPING;

		// A carried plug stays under the pointer; its speed is kept, so a plug let go mid-swing is thrown.
		if (target.kind === "drag" && !target.near && dt > 0) {
			velocity.x = clamp((point.x - position.x) / dt, -2400, 2400);
			velocity.y = clamp((point.y - position.y) / dt, -2400, 2400);
			position.x = point.x;
			position.y = point.y;
		} else {
			velocity.x +=
				(stiffness * (point.x - position.x) - damping * velocity.x) * dt;
			velocity.y +=
				(stiffness * (point.y - position.y) - damping * velocity.y) * dt;
			position.x += velocity.x * dt;
			position.y += velocity.y * dt;
		}

		scaleVelocity +=
			(stiffness * (goalScale - scale) - damping * scaleVelocity) * dt;
		scale += scaleVelocity * dt;
		swing(dt);
		draw();

		const resting =
			Math.hypot(point.x - position.x, point.y - position.y) < 0.3 &&
			Math.hypot(velocity.x, velocity.y) < 2 &&
			Math.abs(goalScale - scale) < 0.002 &&
			Math.abs(scaleVelocity) < 0.02 &&
			ropeStirring < 0.03;

		if (resting) {
			// The plug lands exactly; the cable keeps the shape it came to rest in.
			frame = 0;
			position.x = point.x;
			position.y = point.y;
			velocity.x = velocity.y = scaleVelocity = 0;
			scale = goalScale;
			draw();

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

	// While the plug reaches toward a line it hangs over that line's jack. A plain press there picks
	// the plug up; with a modifier key held the handle lets the click through to the link, and a middle
	// click opens the line in a new tab, as a link would.
	function setTarget(next: Target) {
		target = next;
		dropPending = false;
		root.classList.toggle("is-reaching", next.kind === "reach");
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
		putThrough = window.setTimeout(
			() => {
				// The board stays usable after this, so a stopped or failed load can be tried again.
				standDown();
				window.location.assign(link.href);
			},
			reduced.matches ? 0 : PUT_THROUGH_MS,
		);
	}

	function standDown() {
		window.clearTimeout(putThrough);
		putThrough = 0;
		connecting = false;
		root.removeAttribute("aria-busy");
	}

	function seatedLink() {
		return target.kind === "seated" ? target.link : null;
	}

	function reset() {
		standDown();
		lightOnly(null);
		target = { kind: "rest" };
		root.classList.remove("is-reaching");
		showRestingHint();
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

	// The plug is drawn inside the board, so one dragged past an edge never widens the page; which
	// jack is in reach is measured from the pointer itself.
	function inside(point: Point): Point {
		return {
			x: clamp(point.x, 18, boardBox.width - 18),
			y: clamp(point.y, 18, boardBox.height - 18),
		};
	}

	function nearest(point: Point) {
		let best: HTMLAnchorElement | null = null;
		let distance = SNAP;

		for (const link of links) {
			const jack = jackCentre(link);
			const gap = Math.hypot(jack.x - point.x, jack.y - point.y);

			if (gap < distance) {
				distance = gap;
				best = link;
			}
		}

		return best;
	}

	// The handle covers the jack the plug is over, so a press there that never moves still counts
	// as a press on that jack: the drop seats the plug in it.
	handle.addEventListener("pointerdown", (event) => {
		if (
			connecting ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		)
			return;
		event.preventDefault();
		handle.setPointerCapture(event.pointerId);
		root.classList.add("is-dragging");
		lightOnly(null);
		const point = local(event);
		const near = nearest(point);

		for (const link of links) link.classList.toggle("is-near", link === near);
		setTarget({ kind: "drag", point: inside(point), near });
	});
	handle.addEventListener("pointermove", (event) => {
		if (target.kind !== "drag") return;
		const point = local(event);
		const near = nearest(point);

		for (const link of links) link.classList.toggle("is-near", link === near);
		setTarget({ kind: "drag", point: inside(point), near });
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
		boardBox = board!.getBoundingClientRect();
		layoutKind =
			getComputedStyle(root).getPropertyValue("--sb-layout").trim() === "column"
				? "column"
				: "row";
		youPoint = centre(youJack!);

		for (const link of links) jackPoints.set(link, centre(jackOf(link)));
		restAt = restPoint();
		svg!.setAttribute(
			"viewBox",
			`0 0 ${Math.max(1, boardBox.width)} ${Math.max(1, boardBox.height)}`,
		);

		if (target.kind === "drag") return;
		const still = reduced.matches || dropPending || !rope.length;
		settle(still);

		// A change of layout moves the cable's ends; it swings to them rather than jumping.
		if (!still) {
			ropeStirring = 1;
			move();
		}
	}

	// A modifier key held over a reaching plug lets the click through to the link underneath.
	const modifying = (event: KeyboardEvent | MouseEvent) =>
		root.classList.toggle(
			"is-modifying",
			event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
		);

	window.addEventListener("keydown", modifying);
	window.addEventListener("keyup", modifying);
	board.addEventListener("pointermove", modifying);
	window.addEventListener("blur", () => root.classList.remove("is-modifying"));
	handle.addEventListener("auxclick", (event) => {
		if (event.button === 1 && target.kind === "reach")
			window.open(target.link.href, "_blank", "noopener");
	});

	root.classList.add("is-wired");
	measured = true;
	measure();
	new ResizeObserver(measure).observe(board);

	// The first time the board comes into view the cable drops from straight into its hang and sways
	// to rest, so it reads as a cable before anyone touches it.
	// It drops when your jack, not just the board's top edge, is well inside the window.
	if (dropPending) {
		const arrival = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				arrival.disconnect();

				if (!dropPending) return;
				dropPending = false;
				ropeStirring = 1;
				move();
			},
			{ rootMargin: "0px 0px -12% 0px", threshold: 1 },
		);

		arrival.observe(youJack);
	}

	// Back and forward restore the page as it was left; put the plug back and the lamps out. Leaving
	// first (Back during the pause, or another link) cancels the pending put-through.
	window.addEventListener("pagehide", standDown);
	window.addEventListener("pageshow", (event) => {
		if (event.persisted) reset();
	});
	// Only a plain click that leaves this page in this tab replaces the pending put-through; a link
	// opened in a new tab, a mail link or a download leaves the visitor here, still being put through.
	document.addEventListener("click", (event) => {
		const other =
			event.target instanceof Element ? event.target.closest("a[href]") : null;

		if (
			!putThrough ||
			!(other instanceof HTMLAnchorElement) ||
			links.includes(other) ||
			(other.hash !== "" &&
				other.href.split("#")[0] === window.location.href.split("#")[0]) ||
			event.defaultPrevented ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey ||
			(other.target && other.target !== "_self") ||
			other.hasAttribute("download") ||
			!/^https?:$/.test(other.protocol)
		)
			return;
		standDown();
	});

	return {
		connect(id: string) {
			const link = links.find((each) => each.dataset.line === id);

			if (link) connect(link);
		},
	};
}
