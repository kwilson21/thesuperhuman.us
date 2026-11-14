const ENDPOINT = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * What a Turnstile check said: the visitor passed, the check refused the token, or the check could not give an answer
 * (the service was unreachable, timed out, answered a non-2xx status, or sent text that is not JSON).
 */
export type TurnstileOutcome = "passed" | "refused" | "unavailable";

function isPassedAnswer(value: unknown): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		"success" in value &&
		value.success === true
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

	return isPassedAnswer(data) ? "passed" : "refused";
}

export async function verifyTurnstile(
	token: string,
	secret: string,
	remoteIp: string,
): Promise<boolean> {
	return (await checkTurnstile(token, secret, remoteIp)) === "passed";
}
