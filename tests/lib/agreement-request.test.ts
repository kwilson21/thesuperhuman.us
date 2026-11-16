import { expect, it } from "vitest";
import {
	agreementRequest,
	nativeAgreementRoute,
} from "~/lib/agreement-request";
import { isObject } from "~/lib/type-guards";
import type { APIContext } from "astro";
import { partial } from "../helpers/doubles";

const context = (type: string) =>
	partial<APIContext>({
		request: new Request("https://example.test/api/agreements/session", {
			method: "POST",
			headers: { "content-type": type },
		}),
	});

it("shows escaped actionable native errors while preserving status and no-store headers", async () => {
	const route = nativeAgreementRoute(
		async () =>
			Response.json(
				{ error: "Invalid <code>" },
				{ status: 401, headers: { "cache-control": "private, no-store" } },
			),
		() => "/agreements",
	);

	const response = await route(context("application/x-www-form-urlencoded"));

	expect(response.status).toBe(401);

	expect(response.headers.get("content-type")).toContain("text/html");

	expect(response.headers.get("cache-control")).toBe("private, no-store");
	const html = await response.text();

	expect(html).toContain("Invalid &lt;code&gt;");

	expect(html).toContain('href="/agreements"');

	expect(html).toContain('role="alert"');
});

it("keeps enhanced JSON and native success redirects unchanged", async () => {
	const json = nativeAgreementRoute(
		async () => Response.json({ ok: false }, { status: 409 }),
		() => "/agreements",
	);

	expect(await (await json(context("application/json"))).json()).toEqual({
		ok: false,
	});

	const redirect = nativeAgreementRoute(
		async () =>
			new Response(null, { status: 303, headers: { location: "/agreements" } }),
		() => "/agreements",
	);

	expect(
		(await redirect(context("application/x-www-form-urlencoded"))).headers.get(
			"location",
		),
	).toBe("/agreements");
});

const keysOf = (body: Awaited<ReturnType<typeof agreementRequest>>) =>
	isObject(body) && !(body instanceof Response) ? Object.keys(body) : null;

const form = (body: string) =>
	new Request("https://example.test/api/agreements/link", {
		method: "POST",
		headers: {
			origin: "https://example.test",
			"content-type": "application/x-www-form-urlencoded",
		},
		body,
	});

it("keeps the key order and key presence of a native form's fields", async () => {
	const legal = await agreementRequest(
		form(
			"legal_name=Ann&consent=on&cf-turnstile-response=tok&documents=%5B1%5D&turnstileToken=old",
		),
	);

	expect(keysOf(legal)).toEqual(["csrf_nonce", "values"]);

	expect(JSON.stringify(legal)).toBe(
		'{"values":{"legal_name":"Ann","consent":true,"cf-turnstile-response":"tok","documents":[1],"turnstileToken":"tok"}}',
	);

	const config = await agreementRequest(
		form("action=config&expectedCurrentVersion=3&enabled=false&name=Ann"),
	);

	expect(keysOf(config)).toEqual([
		"action",
		"expectedCurrentVersion",
		"values",
	]);

	expect(JSON.stringify(config)).toBe(
		'{"action":"config","expectedCurrentVersion":"3","values":{"enabled":false,"name":"Ann","registered_agent_confirmed":false}}',
	);

	const configOn = await agreementRequest(
		form("action=config&registered_agent_confirmed=on&name=Ann&confirmed=true"),
	);

	expect(JSON.stringify(configOn)).toBe(
		'{"action":"config","values":{"registered_agent_confirmed":true,"name":"Ann","confirmed":true}}',
	);

	const emptyValues = await agreementRequest(form("action=config&values="));

	expect(JSON.stringify(emptyValues)).toBe(
		'{"action":"config","values":{"values":"","registered_agent_confirmed":false}}',
	);

	expect(
		JSON.stringify(await agreementRequest(form("action=hold&held=on"))),
	).toBe('{"action":"hold","held":true}');
	const holdUnset = await agreementRequest(form("action=hold"));

	expect(keysOf(holdUnset)).toEqual(["action", "held"]);

	expect(JSON.stringify(holdUnset)).toBe('{"action":"hold","held":false}');

	expect(
		JSON.stringify(await agreementRequest(form("action=setting&x=1"))),
	).toBe('{"action":"setting","x":"1","enabled":false}');

	expect(
		JSON.stringify(await agreementRequest(form("action=setting&enabled=on"))),
	).toBe('{"action":"setting","enabled":true}');

	expect(
		JSON.stringify(
			await agreementRequest(form("action=setting&cf-turnstile-response=tok")),
		),
	).toBe(
		'{"action":"setting","cf-turnstile-response":"tok","turnstileToken":"tok","enabled":false}',
	);

	const duplicate = await agreementRequest(
		form("action=setting&enabled=on&action=hold"),
	);

	expect(keysOf(duplicate)).toEqual(["action", "enabled", "held"]);

	expect(JSON.stringify(duplicate)).toBe(
		'{"action":"hold","enabled":true,"held":false}',
	);

	const manifest = await agreementRequest(
		form("action=x&manifest=%7B%22b%22%3A1%2C%22a%22%3A%5Btrue%5D%7D"),
	);

	expect(JSON.stringify(manifest)).toBe(
		'{"action":"x","manifest":{"b":1,"a":[true]}}',
	);

	const invalid = await agreementRequest(form("action=x&values=%7B"));

	expect(invalid instanceof Response ? invalid.status : undefined).toBe(400);
});
