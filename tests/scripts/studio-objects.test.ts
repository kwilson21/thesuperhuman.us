import { existsSync, readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { latestEssay } from "~/data/writing";
import { setupStudioObjects } from "~/scripts/studio-objects";

const hero = readFileSync("src/components/Hero.astro", "utf8");

afterEach(() => {
	vi.unstubAllGlobals();
});

/** The scene's data attributes, as the script reads and writes them. */
class SceneData {
	play?: string;
	labelsDismissed?: string;
}

/** A pointer entering or leaving a link, from a mouse unless `pointerType` says otherwise (Node has no PointerEvent). */
class Pointer extends Event {
	constructor(
		type: string,
		readonly pointerType = "mouse",
		readonly clientX = 0,
		readonly clientY = 0,
	) {
		super(type);
	}
}

/** The keyboard's Escape, as the document hears it (Node has no KeyboardEvent). */
class Key extends Event {
	constructor(readonly key: string) {
		super("keydown");
	}
}

/** A pageshow event for a page restored from the back-forward cache (Node has no PageTransitionEvent). */
class Restored extends Event {
	readonly persisted = true;

	constructor() {
		super("pageshow");
	}
}

/** The document as the script uses it: listeners, the focused element and two lookups. */
class StandInDocument extends EventTarget {
	activeElement: StudioLink | null = null;

	constructor(readonly querySelector: (selector: string) => object | null) {
		super();
	}
}

/**
 * One of the desk's links: an EventTarget, so the script's listeners run as they would on the page. `keyboardFocus` is
 * whether it matches :focus-visible.
 */
class StudioLink extends EventTarget {
	keyboardFocus = false;

	constructor(
		readonly dataset: {
			studioObject: string;
			hovered?: string;
			playsHere?: string;
		},
	) {
		super();
	}

	matches(selector: string) {
		return selector === ":focus-visible" && this.keyboardFocus;
	}

	focus = vi.fn();
}

/** The parts of a click the headphones' handler reads, with `defaultPrevented` for a click a handler already took. */
type ClickOptions = {
	button?: number;
	metaKey?: boolean;
	ctrlKey?: boolean;
	shiftKey?: boolean;
	altKey?: boolean;
	defaultPrevented?: boolean;
};

/** A click as the headphones' handler reads it (Node has no MouseEvent). */
class Click extends Event {
	button = 0;
	metaKey = false;
	ctrlKey = false;
	shiftKey = false;
	altKey = false;

	constructor({ defaultPrevented = false, ...keys }: ClickOptions) {
		super("click", { cancelable: true });
		Object.assign(this, keys);

		if (defaultPrevented) this.preventDefault();
	}
}

/**
 * The hero's scene with its four links, and Home's comparison player when `player` is set (`playing` is whether it is
 * already playing).
 */
function mount({
	player = true,
	playing = false,
	busy = false,
	fineHover = true,
	playsHere = true,
} = {}) {
	const links = new Map(
		["monitor", "headphones", "notebook", "controller"].map((id) => [
			id,
			new StudioLink({
				studioObject: id,
				playsHere: id === "headphones" && playsHere ? "true" : undefined,
			}),
		]),
	);

	const scene = Object.assign(new EventTarget(), {
		dataset: new SceneData(),
		getBoundingClientRect: vi.fn(),
		querySelectorAll: () => [...links.values()],
		querySelector: (selector: string) =>
			links.get(selector.match(/"(.+)"/)?.[1] ?? "") ?? null,
	});

	const button = {
		dataset: { playing: String(playing) },
		getAttribute: (name: string) =>
			name === "aria-busy" ? String(busy) : null,
		click: vi.fn(),
		focus: vi.fn(),
	};

	const comparison = {
		scrollIntoView: vi.fn(),
		querySelector: () => button,
	};

	// A mouse that hovers unless `fineHover` is off; reduced motion is off.
	vi.stubGlobal("matchMedia", (query: string) => ({
		matches: query === "(hover: hover) and (pointer: fine)" && fineHover,
	}));

	const page = new StandInDocument((selector: string) =>
		selector === "[data-studio-scene]"
			? scene
			: player && selector.startsWith(".music-proof-preview")
				? comparison
				: null,
	);

	const view = new EventTarget();

	vi.stubGlobal("document", page);
	vi.stubGlobal("window", view);
	setupStudioObjects();

	const link = (id: string) => links.get(id)!;

	return {
		scene,
		button,
		comparison,
		link,
		/** The pointer moves onto the object: pointerenter, then pointermove over it. */
		point: (id: string, pointerType = "mouse") => {
			link(id).dispatchEvent(new Pointer("pointerenter", pointerType));
			link(id).dispatchEvent(new Pointer("pointermove", pointerType));
		},
		/** The object arrives under a pointer at rest (a label appearing under it, or a scroll): no movement. */
		arriveUnder: (id: string) =>
			link(id).dispatchEvent(new Pointer("pointerenter")),
		leave: (id: string, pointerType = "mouse") =>
			link(id).dispatchEvent(new Pointer("pointerleave", pointerType)),
		escape: () => page.dispatchEvent(new Key("Escape")),
		/** The desk scrolls under a pointer resting at (x, y), which arrives over an object without moving. */
		scrollUnder: (x: number, y: number) => {
			scene.dispatchEvent(new Pointer("pointerover", "mouse", x, y));
			page.dispatchEvent(new Pointer("pointerover", "mouse", x, y));
		},
		/** The pointer moves to (x, y) over the desk; the event reaches the desk, then the document. */
		move: (x: number, y: number) => {
			scene.dispatchEvent(new Pointer("pointermove", "mouse", x, y));
			page.dispatchEvent(new Pointer("pointermove", "mouse", x, y));
		},
		/** The pointer moves to (x, y) elsewhere on the page. */
		moveOff: (x: number, y: number) =>
			page.dispatchEvent(new Pointer("pointermove", "mouse", x, y)),
		/** Any other key, which makes a link a mouse press focused match :focus-visible, as Chromium does. */
		press: (key: string) => {
			if (page.activeElement) page.activeElement.keyboardFocus = true;
			page.dispatchEvent(new Key(key));
		},
		/** The page comes back from the back-forward cache. */
		restore: () => view.dispatchEvent(new Restored()),
		/** Focus by keyboard (`keyboard`), which matches :focus-visible, or by a mouse press, which does not. */
		focus: (id: string, keyboard = true) => {
			page.activeElement = link(id);
			link(id).keyboardFocus = keyboard;
			link(id).dispatchEvent(new Event("focus"));
		},
		blur: (id: string) => {
			page.activeElement = null;
			link(id).keyboardFocus = false;
			link(id).dispatchEvent(new Event("blur"));
		},
		/** Clicks the link and answers whether the script kept the browser from following it. */
		click: (id: string, options: ClickOptions = {}) => {
			const event = new Click(options);

			link(id).dispatchEvent(event);

			return event.defaultPrevented;
		},
	};
}

it("plays the scene of the object pointed at, and rests when the pointer leaves", () => {
	const studio = mount();

	studio.point("monitor");
	expect(studio.scene.dataset.play).toBe("monitor");
	studio.point("headphones");
	expect(studio.scene.dataset.play).toBe("headphones");
	studio.leave("monitor");
	expect(studio.scene.dataset.play).toBe("headphones");
	studio.leave("headphones");
	expect(studio.scene.dataset.play).toBeUndefined();
});

it("keeps a focused object's scene while the pointer passes over and off it", () => {
	const studio = mount();

	studio.focus("notebook");
	expect(studio.scene.dataset.play).toBe("notebook");
	studio.leave("notebook");
	expect(studio.scene.dataset.play).toBe("notebook");
	studio.blur("notebook");
	expect(studio.scene.dataset.play).toBeUndefined();
});

it("rests a scene once the pointer leaves, even when a mouse press focused its link", () => {
	const studio = mount();

	studio.point("monitor");
	studio.focus("monitor", false);
	studio.leave("monitor");
	expect(studio.scene.dataset.play).toBeUndefined();
});

it("returns to the focused object's scene when the pointer passes over another and away", () => {
	const studio = mount();

	studio.focus("monitor");
	studio.point("headphones");
	expect(studio.scene.dataset.play).toBe("headphones");
	studio.leave("headphones");
	expect(studio.scene.dataset.play).toBe("monitor");
});

it("keeps the scene under the pointer when keyboard focus moves away", () => {
	const studio = mount();

	studio.point("monitor");
	studio.focus("monitor");
	studio.blur("monitor");
	expect(studio.scene.dataset.play).toBe("monitor");
});

it("plays no scene for a tap on a touch screen, or for a pointer that cannot hover", () => {
	const touch = mount();

	touch.point("headphones", "touch");
	expect(touch.scene.dataset.play).toBeUndefined();

	const coarse = mount({ fineHover: false });

	coarse.point("headphones");
	expect(coarse.scene.dataset.play).toBeUndefined();
});

it("hides a showing label on Escape until the pointer moves or an object is focused again", () => {
	const studio = mount();

	studio.escape();
	expect(studio.scene.dataset.labelsDismissed).toBeUndefined();
	studio.focus("notebook");
	studio.escape();
	expect(studio.scene.dataset.labelsDismissed).toBe("true");
	expect(studio.scene.dataset.play).toBe("notebook");
	studio.point("controller");
	studio.move(50, 50);
	expect(studio.scene.dataset.labelsDismissed).toBeUndefined();
});

it("plays the scene of a link a mouse press focused once a key shows its focus, and lets Escape hide its label", () => {
	const studio = mount();

	// A right-click or a press dragged off the link focuses it without a focus ring.
	studio.focus("notebook", false);
	expect(studio.scene.dataset.play).toBeUndefined();
	studio.press("Shift");
	expect(studio.scene.dataset.play).toBe("notebook");
	studio.escape();
	expect(studio.scene.dataset.labelsDismissed).toBe("true");
});

it("hides a label on Escape when it is the first key after a mouse press focused its link", () => {
	const studio = mount();

	studio.focus("notebook", false);
	studio.escape();
	expect(studio.scene.dataset.labelsDismissed).toBe("true");
});

it("keeps labels hidden after Escape until the pointer really moves, even when the hover passes to the object below", () => {
	const studio = mount();

	studio.move(100, 100);
	studio.point("notebook");
	studio.escape();
	expect(studio.scene.dataset.labelsDismissed).toBe("true");
	// Hiding the notebook's label hands the hover to the controller under it, with no movement.
	studio.leave("notebook");
	studio.point("controller");
	studio.move(100, 100);
	expect(studio.scene.dataset.labelsDismissed).toBe("true");
	studio.move(108, 100);
	expect(studio.scene.dataset.labelsDismissed).toBeUndefined();
});

it("keeps labels hidden after Escape when a scroll brought the desk under a resting pointer", () => {
	const studio = mount();

	studio.focus("notebook");
	studio.scrollUnder(300, 200);
	studio.point("notebook");
	studio.escape();
	// A one-pixel nudge hands the hover to the controller under the label; it is not a real move.
	studio.leave("notebook");
	studio.point("controller");
	studio.move(301, 200);
	expect(studio.scene.dataset.labelsDismissed).toBe("true");
	studio.move(310, 200);
	expect(studio.scene.dataset.labelsDismissed).toBeUndefined();
});

it("keeps labels hidden after Escape when a scroll then brings the desk under a pointer resting off it", () => {
	const studio = mount();

	studio.moveOff(900, 120);
	studio.focus("monitor");
	studio.escape();
	studio.scrollUnder(900, 120);
	studio.point("monitor");
	studio.move(901, 120);
	expect(studio.scene.dataset.labelsDismissed).toBe("true");
	studio.move(910, 120);
	expect(studio.scene.dataset.labelsDismissed).toBeUndefined();
});

it("lets a mouse click a label keyboard focus shows, and shows hover from the object the pointer moved onto", () => {
	expect(hero).toContain(
		".studio-object:focus-visible .studio-object-label { opacity: 1; pointer-events: auto; }",
	);
	expect(hero).toContain(
		".studio-object[data-hovered] .studio-object-label { opacity: 1; pointer-events: auto; }",
	);
	expect(hero).not.toContain(".studio-object:hover");
});

it("gives no hover to an object that arrives under a resting pointer, until the pointer moves", () => {
	const studio = mount();

	studio.focus("notebook");
	// The headphones' label appears under the mouse, or a scroll brings them under it.
	studio.arriveUnder("headphones");
	expect(studio.scene.dataset.play).toBe("notebook");
	expect(studio.link("headphones").dataset.hovered).toBeUndefined();
	studio.point("headphones");
	expect(studio.scene.dataset.play).toBe("headphones");
	expect(studio.link("headphones").dataset.hovered).toBe("true");
	studio.leave("headphones");
	expect(studio.link("headphones").dataset.hovered).toBeUndefined();
});

it("rests the scene when the page comes back from the back-forward cache", () => {
	const studio = mount();

	// A click followed the monitor's link, so the pointer never left it.
	studio.point("monitor");
	studio.restore();
	expect(studio.scene.dataset.play).toBeUndefined();
	studio.focus("notebook");
	expect(studio.scene.dataset.play).toBe("notebook");
});

it("plays Old News on Home from the headphones, without leaving the page", () => {
	const studio = mount();

	expect(studio.click("headphones")).toBe(true);
	expect(studio.comparison.scrollIntoView).toHaveBeenCalled();
	expect(studio.button.click).toHaveBeenCalledTimes(1);
	expect(studio.button.focus).toHaveBeenCalledWith({ preventScroll: true });
});

it("does not stop Old News when the headphones are clicked while it plays", () => {
	const studio = mount({ playing: true });

	expect(studio.click("headphones")).toBe(true);
	expect(studio.button.click).not.toHaveBeenCalled();
});

it("does not stop Old News while it is still getting ready to play", () => {
	const studio = mount({ busy: true });

	expect(studio.click("headphones")).toBe(true);
	expect(studio.button.click).not.toHaveBeenCalled();
	expect(studio.button.focus).toHaveBeenCalled();
});

it("leaves a click that opens a new tab or window, or that was already handled, to the browser", () => {
	const studio = mount();

	for (const options of [
		{ metaKey: true },
		{ ctrlKey: true },
		{ shiftKey: true },
		{ altKey: true },
		{ button: 1 },
	]) {
		expect(studio.click("headphones", options), JSON.stringify(options)).toBe(
			false,
		);
	}

	expect(studio.click("headphones", { defaultPrevented: true })).toBe(true);
	expect(studio.button.click).not.toHaveBeenCalled();
	expect(studio.comparison.scrollIntoView).not.toHaveBeenCalled();
});

it("follows the headphones' link when the comparison cannot play here", () => {
	const studio = mount({ player: false });

	expect(studio.click("headphones")).toBe(false);
	expect(studio.click("monitor")).toBe(false);
});

it("follows the headphones' link to a newer song that Home's comparison does not hold", () => {
	const studio = mount({ playsHere: false });

	expect(studio.click("headphones")).toBe(false);
	expect(studio.button.click).not.toHaveBeenCalled();
});

it("links each object to a page that exists, with its label as the link's name", () => {
	for (const [label, href, page] of [
		["What I’m building", "/building", "src/pages/building.astro"],
		[
			"Play Kaillera Next",
			"/building/kaillera-next",
			"src/pages/building/kaillera-next.astro",
		],
	]) {
		expect(hero).toContain(`label: "${label}",`);
		expect(hero).toContain(`href: "${href}",`);
		expect(existsSync(page), page).toBe(true);
	}

	// The notebook opens the latest essay, and the headphones the newest song (on Home, or its own page).
	expect(hero).toContain('label: "What I’m writing",');
	expect(hero).toContain("href: latestEssay.href,");
	expect(existsSync(`src/pages${latestEssay.href}.astro`)).toBe(true);
	expect(hero).toContain('label: "Hear a mix and master",');
	expect(hero).toContain('"/audio/portfolio" : `/music/${latestSong.slug}`');
	expect(existsSync("src/pages/audio/portfolio.astro")).toBe(true);
	expect(existsSync("src/pages/music/[slug].astro")).toBe(true);

	expect(hero).toContain(
		'<nav class="studio-objects" aria-label="Around the studio">',
	);
	// The link's text is its full label; the touch pin is a visual short form only, and a word of the label, so speech
	// input that names the pin reaches the link (WCAG 2.5.3).
	expect(hero).toContain(
		'<span class="studio-object-pin" aria-hidden="true">{object.short}</span>',
	);

	const objects = [...hero.matchAll(/label: "([^"]+)",\s+short: "([^"]+)"/g)];

	expect(objects).toHaveLength(4);

	for (const [, label, short] of objects) {
		expect(label.toLowerCase().split(/\W+/), label).toContain(
			short.toLowerCase(),
		);
	}
});

it("names each pin with a word from its label, so speech input can say what it sees", () => {
	for (const [label, short] of [
		["What I’m building", "Building"],
		["Hear a mix and master", "Hear"],
		["What I’m writing", "Writing"],
		["Play Kaillera Next", "Play"],
	]) {
		// Speech input matches words whatever their case.
		expect(label.toLowerCase()).toContain(short.toLowerCase());
		expect(hero).toContain(`label: "${label}",\n\t\tshort: "${short}",`);
	}
});
