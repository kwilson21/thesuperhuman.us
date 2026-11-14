// A browser's cookie jar for route tests: it applies every Set-Cookie of a response the way a browser does (deletions and
// Max-Age included, the Secure and __Host- rules, the Path match) and gives the Cookie header for the next request. A test that
// re-sends a cookie it saved by hand can pass where a real browser, which had dropped that cookie, would fail.

type Stored = { value: string; path: string; secure: boolean; expires: number };

export class CookieJar {
	private readonly cookies = new Map<string, Stored>();

	/** Cookies the browser already holds, for example a value from an earlier visit. */
	constructor(initial: Record<string, string> = {}) {
		for (const [name, value] of Object.entries(initial))
			this.cookies.set(name, {
				value,
				path: "/",
				secure: false,
				expires: Number.POSITIVE_INFINITY,
			});
	}

	/** Applies the Set-Cookie headers of a response that answered a request to `url`. */
	apply(response: Response, url: string) {
		const secureOrigin = new URL(url).protocol === "https:";

		for (const header of response.headers.getSetCookie()) {
			const [pair, ...attributes] = header
				.split(";")
				.map((part) => part.trim());
			const at = pair.indexOf("=");
			const name = pair.slice(0, at);
			const value = pair.slice(at + 1);

			const attribute = (key: string) =>
				attributes
					.find((part) =>
						part.toLowerCase().startsWith(`${key.toLowerCase()}=`),
					)
					?.slice(key.length + 1);

			const secure = attributes.some((part) => part.toLowerCase() === "secure");
			const path = attribute("Path") ?? "/";
			const maxAge = attribute("Max-Age");

			// A browser refuses a Secure cookie from an insecure origin, and a __Host- cookie that is not Secure with Path=/.
			if (secure && !secureOrigin) continue;

			if (name.startsWith("__Host-") && !(secure && path === "/")) continue;

			if (maxAge !== undefined && Number(maxAge) <= 0) {
				this.cookies.delete(name);

				continue;
			}

			this.cookies.set(name, {
				value,
				path,
				secure,
				expires:
					maxAge === undefined
						? Number.POSITIVE_INFINITY
						: Date.now() + Number(maxAge) * 1000,
			});
		}
	}

	/** The Cookie header this browser sends to `url`, or undefined when it sends none. */
	headerFor(url: string): string | undefined {
		const { protocol, pathname } = new URL(url);

		const sent = [...this.cookies]
			.filter(
				([, cookie]) =>
					cookie.expires > Date.now() &&
					(!cookie.secure || protocol === "https:") &&
					(pathname === cookie.path ||
						pathname.startsWith(
							cookie.path.endsWith("/") ? cookie.path : `${cookie.path}/`,
						)),
			)
			.map(([name, cookie]) => `${name}=${cookie.value}`);

		return sent.length ? sent.join("; ") : undefined;
	}

	/** The value of one cookie the browser holds, whatever its path. */
	get(name: string): string | undefined {
		const cookie = this.cookies.get(name);

		return cookie && cookie.expires > Date.now() ? cookie.value : undefined;
	}
}
