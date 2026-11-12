import { expect, it, vi } from "vitest";
import { setupAgreementAttachments } from "~/scripts/software-offers";

it("blocks overlapping uploads and merges into the current attachment manifest", async () => {
	let click!: () => Promise<void>, finish!: (response: Response) => void;

	const upload = {
		disabled: false,
		addEventListener: (_: string, fn: typeof click) => {
			click = fn;
		},
	};

	const field = {
		value: JSON.stringify([{ key: "removed" }]),
		dispatchEvent: vi.fn(),
	};

	const nodes = new Map<string, object>([
		["[data-upload-attachment]", upload],
		['[name="agreement.attachments"]', field],
		["[data-attachment-file]", { files: [{ name: "sample.pdf" }] }],
		["[data-attachment-version]", { value: "v1" }],
		["[data-attachment-date]", { value: "2026-10-10" }],
		["[data-attachment-list]", { appendChild: vi.fn() }],
	]);

	const block = {
		dataset: { uploadEndpoint: "/upload" },
		addEventListener: vi.fn(),
		querySelector: (s: string) => nodes.get(s) ?? null,
		closest: () => ({ querySelector: () => ({ textContent: "" }) }),
	};

	vi.stubGlobal("document", {
		createElement: () => ({ dataset: {}, appendChild: vi.fn() }),
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					finish = resolve;
				}),
		),
	);
	// SAFETY: setupAgreementAttachments reads only dataset, addEventListener and querySelector from block, all supplied above, and it queries only selectors that nodes holds; querySelector is generic over the element type, so the fake's object-or-null return cannot be typed as an HTMLElement.
	setupAgreementAttachments(block as never);
	const pending = click();
	expect(upload.disabled).toBe(true);
	await click();
	expect(fetch).toHaveBeenCalledOnce();
	field.value = JSON.stringify([{ key: "latest" }]);
	finish(Response.json({ attachment: { key: "new", filename: "sample.pdf" } }));
	await pending;
	expect(JSON.parse(field.value).map((a: { key: string }) => a.key)).toEqual([
		"latest",
		"new",
	]);
	expect(upload.disabled).toBe(false);
	vi.unstubAllGlobals();
});
