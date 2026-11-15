import { describe, expect, it } from "vitest";
import {
	isPublicPrefetchSource,
	prefetchTarget,
	reservePrefetch,
} from "../../src/lib/navigation-prefetch";

const current = "https://thesuperhuman.us/?prefetch=foresight";

describe("public navigation trial", () => {
	it("enables only reviewed public source pages by default", () => {
		for (const path of ["/", "/work", "/building/tally", "/services"]) {
			expect(isPublicPrefetchSource(`https://thesuperhuman.us${path}`)).toBe(
				true,
			);
		}

		for (const path of [
			"/owner",
			"/studio",
			"/software/start",
			"/api/contact",
			"/work/private",
			"/offer/token",
		]) {
			expect(isPublicPrefetchSource(`https://thesuperhuman.us${path}`)).toBe(
				false,
			);
		}
	});
	it("excludes rewritten audio and unreviewed hosts while supporting local QA", () => {
		for (const host of [
			"thesuperhuman.us",
			"www.thesuperhuman.us",
			"localhost:5186",
			"127.0.0.1:5186",
			"[::1]:5186",
		]) {
			expect(isPublicPrefetchSource(`http://${host}/`)).toBe(true);
		}

		for (const source of [
			"https://audio.thesuperhuman.us/",
			"https://audio.thesuperhuman.us/services",
			"https://other.thesuperhuman.us/work",
			"https://unreviewed.example/",
			"file:///work",
		]) {
			expect(isPublicPrefetchSource(source)).toBe(false);
		}
	});

	it("accepts only reviewed same-origin static URLs", () => {
		expect(prefetchTarget("/work", current)).toBe(
			"https://thesuperhuman.us/work",
		);

		for (const path of [
			"/api/contact",
			"/software/start",
			"/owner",
			"/work?secret=a",
			"/work#x",
			"https://evil.test/work",
			"javascript:alert(1)",
			"/",
			"/audio/foo.mp3",
			"//evil.test/work",
			"https://u:p@thesuperhuman.us/work",
		])
			expect(prefetchTarget(path, current)).toBeNull();
	});
	it("reserves synchronously, deduplicates and caps even repeated predictions", () => {
		const seen = new Set<string>();

		for (let i = 0; i < 20; i++)
			reservePrefetch(`https://thesuperhuman.us/${i}`, seen, true);
		expect(seen.size).toBe(3);
		expect(reservePrefetch([...seen][0], seen, true)).toBe(false);
	});
	it("does not consume budget offline, constrained or with an unsafe URL", () => {
		const seen = new Set<string>();
		expect(reservePrefetch(null, seen, true)).toBe(false);
		expect(reservePrefetch("/work", seen, false)).toBe(false);
		expect(seen.size).toBe(0);
	});
});
