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
			"/owner",
			"/work?secret=a",
			"https://evil.test/work",
			"javascript:alert(1)",
			"/",
			"/audio/foo.mp3",
			"//evil.test/work",
			"https://u:p@thesuperhuman.us/work",
		])
			expect(prefetchTarget(path, current)).toBeNull();
	});
	it("normalizes audio host routes without crossing origins or media boundaries", () => {
		const current = "https://audio.thesuperhuman.us/";
		expect(isPublicPrefetchSource(current)).toBe(true);
		expect(prefetchTarget("/portfolio#mixes", current)).toBe(
			"https://audio.thesuperhuman.us/portfolio",
		);
		expect(prefetchTarget("/music/old-news", current)).toBe(
			"https://audio.thesuperhuman.us/music/old-news",
		);

		for (const target of [
			"/about",
			"/start",
			"/file/mix",
			"/music/file/id/master",
			"https://thesuperhuman.us/work",
			"/music/not-published",
		])
			expect(prefetchTarget(target, current)).toBeNull();
	});
	it("discovers public content but not no-store, form, redirect, media or unknown targets", () => {
		const base = "https://thesuperhuman.us/about";

		for (const path of [
			"/",
			"/privacy",
			"/writing/ai-gives-you-speed",
			"/audio/",
			"/music/old-news",
		])
			expect(prefetchTarget(path, base)).not.toBeNull();

		for (const path of [
			"/software/start",
			"/audio/start",
			"/building/threadline",
			"/building/personal-website",
			"/services.html",
			"/music/hidden",
			"/new-unknown-page",
			"/og/home.mp4",
		])
			expect(prefetchTarget(path, base)).toBeNull();
		expect(prefetchTarget("/work#history", base)).toBe(
			"https://thesuperhuman.us/work",
		);
		expect(prefetchTarget("#resumes", base)).toBeNull();
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
