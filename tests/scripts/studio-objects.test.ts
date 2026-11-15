import { existsSync, readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { setupStudioObjects } from "~/scripts/studio-objects";

const hero = readFileSync("src/components/Hero.astro", "utf8");

afterEach(() => {
	vi.unstubAllGlobals();
});

/** The scene's data attributes, as the script reads and writes them. */
class SceneData {
	play?: string;
}

/** One of the desk's links: an EventTarget, so the script's listeners run as they would on the page. */
class StudioLink extends EventTarget {
	constructor(readonly dataset: { studioObject: string }) {
		super();
	}

	focus = vi.fn();
}

/**
 * The hero's scene with its four links, and Home's comparison player when `player` is set (`playing` is whether it is
 * already playing).
 */
function mount({ player = true, playing = false } = {}) {
	const links = new Map(
		["monitor", "headphones", "notebook", "controller"].map((id) => [
			id,
			new StudioLink({ studioObject: id }),
		]),
	);

	const scene = {
		dataset: new SceneData(),
		getBoundingClientRect: vi.fn(),
		querySelectorAll: () => [...links.values()],
		querySelector: (selector: string) =>
			links.get(selector.match(/"(.+)"/)?.[1] ?? "") ?? null,
	};

	const button = {
		dataset: { playing: String(playing) },
		click: vi.fn(),
		focus: vi.fn(),
	};

	const comparison = {
		scrollIntoView: vi.fn(),
		querySelector: () => button,
	};

	let active: StudioLink | null = null;

	vi.stubGlobal("matchMedia", () => ({ matches: false }));
	vi.stubGlobal("document", {
		get activeElement() {
			return active;
		},
		querySelector: (selector: string) =>
			selector === "[data-studio-scene]"
				? scene
				: player && selector.startsWith(".music-proof-preview")
					? comparison
					: null,
	});
	setupStudioObjects();

	const link = (id: string) => links.get(id)!;

	return {
		scene,
		button,
		comparison,
		link,
		point: (id: string) => link(id).dispatchEvent(new Event("pointerenter")),
		leave: (id: string) => link(id).dispatchEvent(new Event("pointerleave")),
		focus: (id: string) => {
			active = link(id);
			link(id).dispatchEvent(new Event("focus"));
		},
		blur: (id: string) => {
			active = null;
			link(id).dispatchEvent(new Event("blur"));
		},
		click: (id: string) => {
			const event = new Event("click", { cancelable: true });
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

it("follows the headphones' link when the comparison cannot play here", () => {
	const studio = mount({ player: false });

	expect(studio.click("headphones")).toBe(false);
	expect(studio.click("monitor")).toBe(false);
});

it("links each object to a page that exists, with its label as the link's name", () => {
	for (const [label, href, page] of [
		["What I’m building", "/building", "src/pages/building.astro"],
		[
			"Hear a mix and master",
			"/audio/portfolio",
			"src/pages/audio/portfolio.astro",
		],
		[
			"What I’m writing",
			"/writing/ai-gives-you-speed",
			"src/pages/writing/ai-gives-you-speed.astro",
		],
		[
			"Kaillera Next, netplay for old games",
			"/building/kaillera-next",
			"src/pages/building/kaillera-next.astro",
		],
	]) {
		expect(hero).toContain(`label: "${label}",`);
		expect(hero).toContain(`href: "${href}",`);
		expect(existsSync(page), page).toBe(true);
	}

	expect(hero).toContain(
		'<nav class="studio-objects" aria-label="Around the studio">',
	);
	// The link's text is its full label; the touch pin is a visual short form only.
	expect(hero).toContain(
		'<span class="studio-object-pin" aria-hidden="true">{object.short}</span>',
	);
});
