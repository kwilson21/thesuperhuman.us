import { expect, it } from "vitest";
import { agreementRequest } from "~/lib/agreement-request";
import { fromThisSite } from "~/lib/same-origin";

const SITE = "https://thesuperhuman.us";

const post = (headers: Record<string, string>) =>
	new Request(`${SITE}/api/offer/tok/link`, {
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded",
			...headers,
		},
		body: "email=client%40example.test",
	});

it("accepts the site's origin, and Origin null only with Sec-Fetch-Site same-origin", () => {
	expect(fromThisSite(post({ origin: SITE }), SITE)).toBe(true);
	expect(
		fromThisSite(
			post({ origin: "null", "sec-fetch-site": "same-origin" }),
			SITE,
		),
	).toBe(true);

	const refused: Record<string, string>[] = [
		{},
		{ "sec-fetch-site": "same-origin" },
		{ origin: "null" },
		{ origin: "null", "sec-fetch-site": "cross-site" },
		{ origin: "null", "sec-fetch-site": "same-site" },
		{ origin: "null", "sec-fetch-site": "none" },
		{ origin: "https://evil.example", "sec-fetch-site": "same-origin" },
		{ origin: "https://audio.thesuperhuman.us", "sec-fetch-site": "same-site" },
	];

	for (const headers of refused)
		expect(fromThisSite(post(headers), SITE)).toBe(false);
});

it("lets an agreement route read a native form a no-referrer page posted, and refuses the rest", async () => {
	// The agreement pages send `Referrer-Policy: no-referrer`, so their no-script form posts carry `Origin: null`.
	expect(
		await agreementRequest(
			post({ origin: "null", "sec-fetch-site": "same-origin" }),
		),
	).toEqual({ email: "client@example.test" });

	const refused: Record<string, string>[] = [
		{ origin: "null" },
		{ origin: "null", "sec-fetch-site": "cross-site" },
		{ origin: "https://evil.example" },
	];

	for (const headers of refused) {
		const answer = await agreementRequest(post(headers));

		expect(answer).toBeInstanceOf(Response);

		if (answer instanceof Response) expect(answer.status).toBe(403);
	}
});
