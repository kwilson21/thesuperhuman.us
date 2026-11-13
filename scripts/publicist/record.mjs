#!/usr/bin/env node
// Records a short, silent clip of one Tally flow on the public demo, for journal
// entries and social posts (docs/publicist/README.md, section 7). Demo data only:
// the run stops if the "Demo data" banner is missing.
//
//   node scripts/publicist/record.mjs <flow> [out-dir]
//
// Writes <flow>.mp4 (H.264, no audio) and <flow>.gif to out-dir (default: the
// current directory). Needs ffmpeg. Flows are listed in FLOWS below.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import {
	mkdtempSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const DEMO = "https://tally-demo.thesuperhuman.us";
const PHONE = {
	viewport: { width: 390, height: 844 },
	deviceScaleFactor: 2,
	isMobile: true,
	hasTouch: true,
};
const DESKTOP = {
	viewport: { width: 1280, height: 800 },
	deviceScaleFactor: 1,
};

const pause = (page, ms) => page.waitForTimeout(ms);

export const FLOWS = {
	// tally-apple-card-upload: Accounts, Add Apple Card, then the demo's made-up sample.
	"apple-card": {
		device: PHONE,
		async run(page) {
			await page.goto(`${DEMO}/accounts`);
			await pause(page, 1500);
			await page
				.getByRole("button", { name: "Add Apple Card" })
				.or(page.getByRole("link", { name: "Add Apple Card" }))
				.first()
				.click();
			await pause(page, 1800);
			await page.getByRole("button", { name: "Add the sample" }).click();
			await pause(page, 3000);
		},
	},
	// tally-shortcuts-and-money-input: ? opens the keys sheet, Escape closes it, j moves down the rows.
	keys: {
		device: DESKTOP,
		async run(page) {
			await page.goto(`${DEMO}/transactions`);
			await pause(page, 1500);
			await page.keyboard.press("Shift+Slash");
			await pause(page, 2500);
			await page.keyboard.press("Escape");
			await pause(page, 800);
			for (let i = 0; i < 4; i += 1) {
				await page.keyboard.press("j");
				await pause(page, 450);
			}
			await pause(page, 1200);
		},
	},
	// tally-what-tally-learned: a learned line, Forget, then Undo from the toast.
	learned: {
		device: PHONE,
		async run(page) {
			await page.goto(`${DEMO}/settings/learned`);
			await pause(page, 2000);
			await page
				.getByRole("button", { name: /^Forget/ })
				.first()
				.click();
			await pause(page, 1800);
			await page.getByRole("button", { name: "Undo" }).click();
			await pause(page, 2200);
		},
	},
	// tally-rules-ask-first: Organize files Costco as Groceries, then asks before making a rule; "Not now" makes none.
	"organize-ask": {
		device: PHONE,
		async run(page) {
			await page.goto(
				`${DEMO}/transactions/organize?skip=Banfield+Pet+Hospital`,
			);
			await pause(page, 1800);
			await page.getByText("Groceries", { exact: true }).first().click();
			await pause(page, 900);
			await page.getByRole("button", { name: "Save and next" }).click();
			await pause(page, 3200);
			await page.getByRole("button", { name: "Not now" }).click();
			await pause(page, 1500);
		},
	},
	// tally-bill-payments: Bills, Rent "Part paid: $600 of $1,200", then November on the bill's page.
	"bill-parts": {
		device: PHONE,
		async run(page) {
			await page.goto(`${DEMO}/bills`);
			await pause(page, 2000);
			await page.getByRole("link", { name: /^Rent Part paid/ }).click();
			await pause(page, 2500);
			await page
				.getByText(/Part paid: \$600 of \$1,200/)
				.first()
				.click();
			await pause(page, 3000);
		},
	},
	// tally-finding-your-way: the banner's Start here opens the short story, then More as a contents page.
	"start-here": {
		device: PHONE,
		async run(page) {
			await page.goto(`${DEMO}/`);
			await pause(page, 1500);
			await page.getByRole("link", { name: "Start here" }).first().click();
			await pause(page, 2500);
			for (let i = 0; i < 6; i += 1) {
				await page.evaluate(() =>
					window.scrollBy({ top: 110, behavior: "smooth" }),
				);
				await pause(page, 450);
			}
			await pause(page, 1500);
			await page
				.getByRole("link", { name: "More", exact: true })
				.last()
				.click();
			await pause(page, 2800);
		},
	},
	// tally-adjust-budgets: Adjust budgets on Home, + twice on Groceries (each tap saves at the next round $10), then − twice back.
	adjust: {
		device: PHONE,
		async run(page) {
			await page.goto(`${DEMO}/`);
			await pause(page, 1200);
			await page.evaluate(() =>
				window.scrollTo({ top: 520, behavior: "smooth" }),
			);
			await pause(page, 1200);
			await page.getByRole("link", { name: "Adjust budgets" }).click();
			await pause(page, 1500);
			const plus = page.locator("button", { hasText: "+" }).first();
			const minus = page.locator("button", { hasText: "−" }).first();
			await plus.click();
			await pause(page, 1300);
			await plus.click();
			await pause(page, 1500);
			await minus.click();
			await pause(page, 1300);
			await minus.click();
			await pause(page, 1800);
		},
	},
	// tally-exclusions: a transaction's Exclude from budget switch, saved, then counted again with the same switch.
	exclude: {
		device: PHONE,
		async run(page) {
			await page.goto(`${DEMO}/transactions`);
			await pause(page, 1500);
			const row = page
				.getByRole("link", { name: /^Blue Bottle Coffee/ })
				.first();
			await row.scrollIntoViewIfNeeded();
			await pause(page, 800);
			await row.click();
			await pause(page, 1800);
			await page
				.locator('label[for="edit-exclude"], #edit-exclude-label')
				.first()
				.click();
			await pause(page, 1200);
			await page.getByRole("button", { name: "Save", exact: true }).click();
			await pause(page, 2000);
			await page
				.getByRole("link", { name: /^Blue Bottle Coffee/ })
				.first()
				.scrollIntoViewIfNeeded();
			await pause(page, 1500);
			await page
				.getByRole("link", { name: /^Blue Bottle Coffee/ })
				.first()
				.click();
			await pause(page, 1500);
			await page
				.locator('label[for="edit-exclude"], #edit-exclude-label')
				.first()
				.click();
			await pause(page, 1000);
			await page.getByRole("button", { name: "Save", exact: true }).click();
			await pause(page, 2000);
		},
	},
	// tally-how-diagrams: How Tally works, scrolling through the Budget, Transactions and Excluding diagrams.
	"how-diagrams": {
		device: PHONE,
		async run(page) {
			await page.goto(`${DEMO}/how-it-works`);
			await pause(page, 1800);
			await page.evaluate(() =>
				document
					.getElementById("budget")
					?.scrollIntoView({ behavior: "smooth" }),
			);
			await pause(page, 2200);
			for (let i = 0; i < 12; i += 1) {
				await page.evaluate(() =>
					window.scrollBy({ top: 140, behavior: "smooth" }),
				);
				await pause(page, 650);
			}
			await pause(page, 1200);
		},
	},
};

async function record(name, outDir) {
	const flow = FLOWS[name];
	if (!flow)
		throw new Error(
			`Unknown flow "${name}". Flows: ${Object.keys(FLOWS).join(", ")}`,
		);
	const work = mkdtempSync(join(tmpdir(), "publicist-record-"));
	const browser = await chromium.launch(
		process.env.CHROMIUM_PATH
			? { executablePath: process.env.CHROMIUM_PATH }
			: {},
	);
	try {
		const context = await browser.newContext({
			...flow.device,
			reducedMotion: "no-preference",
			recordVideo: { dir: work, size: flow.device.viewport },
		});
		const page = await context.newPage();
		await flow.run(page);
		const banner = await page
			.getByText("Demo data. Nothing here is real.")
			.count();
		await context.close();
		if (!banner)
			throw new Error(
				'No "Demo data" banner on the last page; refusing to keep this clip.',
			);
		const webm = join(
			work,
			readdirSync(work).find((f) => f.endsWith(".webm")),
		);
		const mp4 = resolve(outDir, `${name}.mp4`);
		const gif = resolve(outDir, `${name}.gif`);
		execFileSync("ffmpeg", [
			"-y",
			"-loglevel",
			"error",
			"-i",
			webm,
			"-an",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-crf",
			"28",
			"-movflags",
			"+faststart",
			"-vf",
			"scale=trunc(iw/2)*2:trunc(ih/2)*2",
			mp4,
		]);
		execFileSync("ffmpeg", [
			"-y",
			"-loglevel",
			"error",
			"-i",
			webm,
			"-vf",
			"fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
			gif,
		]);
		for (const f of [mp4, gif])
			console.log(`${f} · ${(statSync(f).size / 1e6).toFixed(2)} MB`);
	} finally {
		await browser.close();
		rmSync(work, { recursive: true, force: true });
	}
}

const [name, outDir = "."] = process.argv.slice(2);
if (!name) {
	console.log(
		`Usage: node scripts/publicist/record.mjs <flow> [out-dir]\nFlows: ${Object.keys(FLOWS).join(", ")}`,
	);
	process.exit(1);
}
await record(name, outDir);
