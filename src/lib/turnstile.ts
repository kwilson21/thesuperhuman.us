const ENDPOINT = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * What a Turnstile check said: the visitor passed, the check refused the token, or the check could not give an answer
 * (the service was unreachable, timed out, answered a non-2xx status, or sent text that is not JSON).
 */
export type TurnstileOutcome = "passed" | "refused" | "unavailable";

function hasSuccessFlag(value: unknown): value is { success: unknown } {
	return typeof value === "object" && value !== null && "success" in value;
}

/**
 * Error codes that mean the fault is ours (a missing or wrong secret, or Cloudflare itself): the visitor did nothing wrong,
 * so the answer is "unavailable", not "complete the check again".
 */
const SERVICE_FAULT_CODES = [
	"internal-error",
	"missing-input-secret",
	"invalid-input-secret",
];

function reportsServiceFault(value: { success: unknown }): boolean {
	if (!("error-codes" in value)) return false;
	const codes = value["error-codes"];

	return (
		Array.isArray(codes) &&
		codes.some((code) => SERVICE_FAULT_CODES.includes(code))
	);
}

export async function checkTurnstile(
	token: string,
	secret: string,
	remoteIp: string,
): Promise<TurnstileOutcome> {
	let data: unknown;

	try {
		const body = new URLSearchParams();
		body.set("secret", secret);
		body.set("response", token);
		body.set("remoteip", remoteIp);

		const res = await fetch(ENDPOINT, {
			method: "POST",
			body,
			signal: AbortSignal.timeout(5000),
		});

		if (!res.ok) return "unavailable";
		data = await res.json();
	} catch {
		return "unavailable";
	}

	if (!hasSuccessFlag(data)) return "refused";
	if (data.success === true) return "passed";

	return reportsServiceFault(data) ? "unavailable" : "refused";
}

export async function verifyTurnstile(
	token: string,
	secret: string,
	remoteIp: string,
): Promise<boolean> {
	return (await checkTurnstile(token, secret, remoteIp)) === "passed";
}
