// What the contact form and the resume request form routes read from a request before any rule runs: where it came
// from, and its JSON body. Both answer as the routes always did (a 403 `Forbidden`, a 400 `Invalid JSON`).

const ALLOWED_ORIGINS = [
	"https://thesuperhuman.us",
	"https://www.thesuperhuman.us",
];

/** The site itself, its www host and its Cloudflare Pages preview deployments. */
export function isAllowedOrigin(origin: string | null): boolean {
	if (!origin) return false;

	if (ALLOWED_ORIGINS.includes(origin)) return true;

	return /^https:\/\/[a-z0-9-]+\.thesuperhuman-us\.pages\.dev$/.test(origin);
}

/** The request's body parsed as JSON, whatever it holds (an object, `null`, text, a number); or that it is not JSON. */
export async function readJsonBody(
	request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false }> {
	try {
		return { ok: true, body: await request.json() };
	} catch {
		return { ok: false };
	}
}

export const forbidden = () =>
	Response.json({ ok: false, error: "Forbidden" }, { status: 403 });

export const invalidJson = () =>
	Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
