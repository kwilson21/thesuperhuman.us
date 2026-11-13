const ENDPOINT = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function hasSuccessFlag(value: unknown): value is { success: unknown } {
	return typeof value === "object" && value !== null && "success" in value;
}

export async function verifyTurnstile(
	token: string,
	secret: string,
	remoteIp: string,
): Promise<boolean> {
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

		if (!res.ok) return false;
		const data: unknown = await res.json();

		return hasSuccessFlag(data) && data.success === true;
	} catch {
		return false;
	}
}
