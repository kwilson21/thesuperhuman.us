import {
	GET,
	PUT,
} from "~/pages/api/owner/requests/[id]/updates/[updateId]/visual";
import { POST as updates } from "~/pages/api/owner/requests/[id]/updates";
import {
	asClient,
	asOwner,
	asVisitor,
	defineCorpus,
	generatedBody,
	type Case,
	type SeedRow,
	type Step,
	type World,
} from "./harness";
import {
	command,
	D1,
	D2,
	EARLIER,
	FUTURE,
	input,
	post,
	scene,
	SITE,
	TABLES,
	update,
} from "./areas/software-updates";

// The golden corpus for GET and PUT /api/owner/requests/[id]/updates/[updateId]/visual: the owner reads back, and
// attaches or replaces, the picture of a software update. There is no route that removes a picture; the only change of
// an attached image is a replacement by PUT, and a draft save never touches `visual_key`.
//
// GET (every response carries cache-control private no-store, x-robots-tag noindex nofollow, nosniff)
//   403 empty        "get who": visitor, signed-in studio client
//   404 empty        "get flag": unset, false, TRUE; "get row": unknown update, another request's update, no visual key, a
//                    key under another request or update, a bad extension or case, an object missing in R2
//   503 empty        "get unavailable": no MUSIC_DB, no AUDIO bucket
//   200 object       "get ok": png, jpeg, webp; a draft, shared or superseded update; a null stored media type (sent as the
//                    text "null"); a stored type that does not match the bytes
//   rejected         "get outage": the row query fails; R2 get fails; no id param (bind undefined)
// PUT
//   403 {ok:false}   "put who", "put origin": visitor, client; missing, other and http origin
//   404 {ok:false}   "put flag"; "put draft": unknown update, another request's, shared, superseded
//   503 {ok:false}   "put unavailable": no MUSIC_DB, no bucket, no id, no updateId
//   415 "Choose a PNG, JPEG or WebP image."   "put type": none, gif, jpg, upper case, a charset suffix, inherited object
//                    keys (constructor, toString, __proto__, hasOwnProperty, valueOf) answered before the body is read
//   413 "Use an image of 5 MB or less."       "put size": no body, content-length over the limit, exactly 5 MiB passes,
//                    one byte more fails, streamed over the limit
//   400 "The image does not match its file type."   "put bytes": every type against every wrong signature, short, empty
//   400 "Save an image description before uploading."   "put alt"
//   409 "The draft changed. Reload before uploading."   "put time": missing, different, no milliseconds
//   200 {ok,updatedAt}   "put ok": png, jpeg, webp; first upload; replacing (old object deleted); an old key that fails
//                    the key check (kept); the timestamp rule
//   200 cleanupPending   "put cleanup": the old object cannot be deleted
//   409 "...was not replaced."   "put race": the batch fails (project changed, revoked, completed, withdrawn, draft changed,
//                    shared or deleted) and the new object is deleted
//   503 "...could not be stored."   "put outage": R2 put fails; the batch fails and the cleanup delete fails
//   sequences        "put then get", "put twice", "put then draft save", "replace then get"

const KEY = `software/r1/${D1}/old.png`;

const PNG = [137, 80, 78, 71, 13, 10, 26, 10];

const JPEG = [0xff, 0xd8, 0xff, 0xe0];

const WEBP = [..."RIFF"]
	.map((c) => c.charCodeAt(0))
	.concat(
		[1, 2, 3, 4],
		[..."WEBP"].map((c) => c.charCodeAt(0)),
	);

const withTail = (head: number[], length = 24) =>
	Uint8Array.from({ length }, (_, i) => head[i] ?? 0x21);

const image = {
	"image/png": withTail(PNG),
	"image/jpeg": withTail(JPEG),
	"image/webp": withTail(WEBP),
} as const;

const draft = (over = {}) =>
	update(D1, "draft", { visual_alt: "A chart", ...over });

const withKey = (over = {}) =>
	draft({ visual_key: KEY, visual_media_type: "image/png", ...over });

const OLD = { [KEY]: { body: "old picture" } };

const R2_DUMP = { music: TABLES, r2: true };

const getStep = (extra: Partial<Step> = {}): Step => ({
	as: asOwner(),
	method: "GET",
	path: `/api/owner/requests/r1/updates/${D1}/visual`,
	params: { id: "r1", updateId: D1 },
	dump: R2_DUMP,
	...extra,
});

const put = (
	body: Step["body"],
	type: string | null = "image/png",
	extra: Partial<Step> = {},
): Step => ({
	as: asOwner(),
	method: "PUT",
	path: `/api/owner/requests/r1/updates/${D1}/visual`,
	params: { id: "r1", updateId: D1 },
	body,
	headers:
		type === null
			? { origin: SITE, "if-unmodified-since": EARLIER }
			: {
					origin: SITE,
					"content-type": type,
					"if-unmodified-since": EARLIER,
				},
	dump: R2_DUMP,
	...extra,
});

const png = () => image["image/png"];

type Parts = {
	readonly updates?: SeedRow[];
	readonly project?: { [key: string]: string | number | null };
	readonly request?: { [key: string]: string | number | null };
	readonly r2?: Case["r2"];
};

const stage = (o: Parts = {}): Partial<Case> => ({
	...scene({
		updates: o.updates ?? [draft()],
		project: o.project,
		request: o.request,
	}),
	r2: o.r2 ?? {},
});

const putCase = (
	name: string,
	step: Step,
	o: Parts = {},
	extra: Partial<Case> = {},
): Case => ({ name, ...stage(o), steps: [step], ...extra });

const getCase = (
	name: string,
	o: Parts = {},
	extra: Partial<Case> = {},
	step: Step = getStep(),
): Case => ({
	name,
	...stage({ updates: [withKey()], r2: { seed: OLD }, ...o }),
	steps: [step],
	...extra,
});

const types = ["image/png", "image/jpeg", "image/webp"] as const;

const mismatched = types.flatMap((type) =>
	types.flatMap((other) =>
		other === type
			? []
			: [
					putCase(
						`put bytes: ${type} claims ${other} bytes`,
						put(image[other], type),
					),
				],
	),
);

const inherited = [
	"constructor",
	"toString",
	"__proto__",
	"hasOwnProperty",
	"valueOf",
].map((type) =>
	putCase(`put type: the inherited name ${type}`, put(png(), type)),
);

const raceOn = /UPDATE software_project_updates SET visual_key=\?/;

const race = (name: string, statement: string, o: Parts = {}) =>
	putCase(name, put(png()), o, {
		interleave: [
			{
				on: raceOn,
				label: name,
				run: (sqlite: { exec: (sql: string) => void }) =>
					sqlite.exec(statement),
			},
		],
	});

const cases: Case[] = [
	// GET
	getCase("get who: a visitor", {}, {}, getStep({ as: asVisitor() })),
	getCase(
		"get who: a signed-in studio client",
		{},
		{},
		getStep({ as: asClient("grace@example.test") }),
	),
	getCase("get flag: unset", {}, { omit: ["AUDIO_CLIENT_PORTAL_ENABLED"] }),
	getCase(
		"get flag: false",
		{},
		{ env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" } },
	),
	getCase(
		"get flag: TRUE in capitals",
		{},
		{ env: { AUDIO_CLIENT_PORTAL_ENABLED: "TRUE" } },
	),
	getCase(
		"get flag: off wins over missing bindings",
		{},
		{
			omit: ["AUDIO_CLIENT_PORTAL_ENABLED"],
			music: { missing: true },
			r2: { missing: true },
		},
	),
	getCase("get unavailable: no MUSIC_DB", {}, { music: { missing: true } }),
	getCase("get unavailable: no AUDIO bucket", {}, { r2: { missing: true } }),
	getCase(
		"get row: an unknown update",
		{},
		{},
		getStep({
			path: "/api/owner/requests/r1/updates/nope/visual",
			params: { id: "r1", updateId: "nope" },
		}),
	),
	getCase(
		"get row: another request's id with this update",
		{},
		{},
		getStep({
			path: "/api/owner/requests/r2/updates/x/visual",
			params: { id: "r2", updateId: D1 },
		}),
	),
	getCase("get row: no visual key", { updates: [draft()] }),
	getCase("get row: a key under another request", {
		updates: [withKey({ visual_key: `software/r2/${D1}/old.png` })],
		r2: { seed: { [`software/r2/${D1}/old.png`]: { body: "x" } } },
	}),
	getCase("get row: a key under another update", {
		updates: [withKey({ visual_key: `software/r1/${D2}/old.png` })],
		r2: { seed: { [`software/r1/${D2}/old.png`]: { body: "x" } } },
	}),
	getCase("get row: a key with a gif extension", {
		updates: [withKey({ visual_key: `software/r1/${D1}/old.gif` })],
		r2: { seed: { [`software/r1/${D1}/old.gif`]: { body: "x" } } },
	}),
	getCase("get row: a key with capitals", {
		updates: [withKey({ visual_key: `software/r1/${D1}/OLD.png` })],
		r2: { seed: { [`software/r1/${D1}/OLD.png`]: { body: "x" } } },
	}),
	getCase("get row: a key with a path in it", {
		updates: [withKey({ visual_key: `software/r1/${D1}/a/b.png` })],
		r2: { seed: { [`software/r1/${D1}/a/b.png`]: { body: "x" } } },
	}),
	getCase("get row: the object is missing in R2", { r2: {} }),
	getCase("get ok: a png", { updates: [withKey()] }),
	getCase("get ok: a jpeg", {
		updates: [
			withKey({
				visual_key: `software/r1/${D1}/p.jpg`,
				visual_media_type: "image/jpeg",
			}),
		],
		r2: {
			seed: { [`software/r1/${D1}/p.jpg`]: { body: image["image/jpeg"] } },
		},
	}),
	getCase("get ok: a webp", {
		updates: [
			withKey({
				visual_key: `software/r1/${D1}/p.webp`,
				visual_media_type: "image/webp",
			}),
		],
		r2: {
			seed: { [`software/r1/${D1}/p.webp`]: { body: image["image/webp"] } },
		},
	}),
	getCase("get ok: a shared update", {
		updates: [withKey({ status: "shared", shared_at: EARLIER })],
	}),
	getCase("get ok: a superseded update", {
		updates: [withKey({ status: "superseded", shared_at: EARLIER })],
	}),
	getCase("get ok: a revoked project is still readable by the owner", {
		updates: [withKey()],
		project: { revoked_at: EARLIER },
	}),
	getCase("get ok: the stored type does not match the bytes", {
		updates: [withKey({ visual_media_type: "image/webp" })],
	}),
	getCase("get ok: a null stored media type", {
		updates: [withKey({ visual_media_type: null })],
	}),
	getCase("get ok: an empty object", { r2: { seed: { [KEY]: { body: "" } } } }),
	getCase(
		"get outage: the row query fails",
		{},
		{
			failures: [
				{
					on: /SELECT visual_key,visual_media_type/,
					message: "D1 unavailable",
				},
			],
		},
	),
	getCase(
		"get outage: R2 get fails",
		{},
		{ r2: { seed: OLD, fails: ["get"] } },
	),
	getCase(
		"get outage: no id param",
		{},
		{},
		getStep({ params: { updateId: D1 } }),
	),
	getCase(
		"get outage: no updateId param",
		{},
		{},
		getStep({ params: { id: "r1" } }),
	),
	// PUT gates
	putCase("put who: a visitor", put(png(), "image/png", { as: asVisitor() })),
	putCase(
		"put who: a signed-in studio client",
		put(png(), "image/png", { as: asClient("grace@example.test") }),
	),
	putCase(
		"put flag: unset",
		put(png()),
		{},
		{ omit: ["AUDIO_CLIENT_PORTAL_ENABLED"] },
	),
	putCase(
		"put flag: false",
		put(png()),
		{},
		{ env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" } },
	),
	putCase(
		"put unavailable: no MUSIC_DB",
		put(png()),
		{},
		{ music: { missing: true } },
	),
	putCase(
		"put unavailable: no bucket",
		put(png()),
		{},
		{ r2: { missing: true } },
	),
	putCase(
		"put unavailable: no id param",
		put(png(), "image/png", { params: { updateId: D1 } }),
	),
	putCase(
		"put unavailable: no updateId param",
		put(png(), "image/png", { params: { id: "r1" } }),
	),
	putCase(
		"put unavailable: an empty id param",
		put(png(), "image/png", { params: { id: "", updateId: D1 } }),
	),
	putCase(
		"put origin: missing",
		put(png(), "image/png", {
			headers: { "content-type": "image/png", "if-unmodified-since": EARLIER },
		}),
	),
	putCase(
		"put origin: another site",
		put(png(), "image/png", {
			headers: {
				origin: "https://evil.test",
				"content-type": "image/png",
				"if-unmodified-since": EARLIER,
			},
		}),
	),
	putCase(
		"put origin: http scheme",
		put(png(), "image/png", {
			headers: {
				origin: "http://thesuperhuman.us",
				"content-type": "image/png",
				"if-unmodified-since": EARLIER,
			},
		}),
	),
	// PUT types
	putCase("put type: none", put(png(), null)),
	putCase("put type: gif", put(png(), "image/gif")),
	putCase("put type: image/jpg", put(png(), "image/jpg")),
	putCase("put type: upper case", put(png(), "IMAGE/PNG")),
	putCase(
		"put type: a charset suffix",
		put(png(), "image/png; charset=binary"),
	),
	putCase("put type: json", put(png(), "application/json")),
	...inherited,
	putCase(
		"put type: refused before the draft is read",
		put(png(), "image/gif"),
		{ updates: [] },
	),
	// PUT size
	putCase("put size: no body", put(undefined)),
	putCase(
		"put size: content-length over the limit",
		put(png(), "image/png", {
			headers: {
				origin: SITE,
				"content-type": "image/png",
				"content-length": String(5 * 1024 * 1024 + 1),
				"if-unmodified-since": EARLIER,
			},
		}),
	),
	putCase(
		"put size: content-length exactly at the limit",
		put(png(), "image/png", {
			headers: {
				origin: SITE,
				"content-type": "image/png",
				"content-length": String(5 * 1024 * 1024),
				"if-unmodified-since": EARLIER,
			},
		}),
	),
	putCase(
		"put size: exactly 5 MiB",
		put(generatedBody(5 * 1024 * 1024, (i) => PNG[i] ?? 0x21)),
	),
	putCase(
		"put size: one byte over 5 MiB",
		put(generatedBody(5 * 1024 * 1024 + 1, (i) => PNG[i] ?? 0x21)),
	),
	putCase(
		"put size: 5 MiB jpeg",
		put(
			generatedBody(5 * 1024 * 1024, (i) => JPEG[i] ?? 0x21),
			"image/jpeg",
		),
	),
	// PUT bytes
	...mismatched,
	putCase("put bytes: a png of 7 bytes", put(Uint8Array.from(PNG.slice(0, 7)))),
	putCase("put bytes: a png of exactly 8 bytes", put(Uint8Array.from(PNG))),
	putCase(
		"put bytes: a jpeg of 2 bytes",
		put(Uint8Array.from(JPEG.slice(0, 2)), "image/jpeg"),
	),
	putCase(
		"put bytes: a jpeg of exactly 3 bytes",
		put(Uint8Array.from(JPEG.slice(0, 3)), "image/jpeg"),
	),
	putCase(
		"put bytes: a webp of 11 bytes",
		put(Uint8Array.from(WEBP.slice(0, 11)), "image/webp"),
	),
	putCase(
		"put bytes: a webp of exactly 12 bytes",
		put(Uint8Array.from(WEBP), "image/webp"),
	),
	putCase(
		"put bytes: a webp with RIFF but not WEBP",
		put(
			Uint8Array.from([...WEBP.slice(0, 8), 0x57, 0x45, 0x42, 0x50 + 1]),
			"image/webp",
		),
	),
	putCase("put bytes: an empty body", put("")),
	putCase(
		"put bytes: text that only names the type",
		put("<svg onload=alert(1)></svg>"),
	),
	putCase(
		"put bytes: a PNG signature with an SVG after it",
		put(
			Uint8Array.from([
				...PNG,
				...new TextEncoder().encode("<svg onload=alert(1)>"),
			]),
		),
	),
	// PUT draft
	putCase(
		"put draft: an unknown update",
		put(png(), "image/png", { params: { id: "r1", updateId: D2 } }),
	),
	putCase(
		"put draft: another request's id",
		put(png(), "image/png", { params: { id: "r2", updateId: D1 } }),
	),
	putCase("put draft: a shared update", put(png()), {
		updates: [draft({ status: "shared", shared_at: EARLIER })],
	}),
	putCase("put draft: a superseded update", put(png()), {
		updates: [draft({ status: "superseded", shared_at: EARLIER })],
	}),
	putCase("put alt: the draft has no description", put(png()), {
		updates: [update(D1, "draft")],
	}),
	putCase("put alt: a description of only spaces counts as one", put(png()), {
		updates: [draft({ visual_alt: "  " })],
	}),
	putCase(
		"put time: no if-unmodified-since header",
		put(png(), "image/png", {
			headers: { origin: SITE, "content-type": "image/png" },
		}),
	),
	putCase(
		"put time: a different time",
		put(png(), "image/png", {
			headers: {
				origin: SITE,
				"content-type": "image/png",
				"if-unmodified-since": "2026-11-13T10:00:00.000Z",
			},
		}),
	),
	putCase(
		"put time: the time without milliseconds",
		put(png(), "image/png", {
			headers: {
				origin: SITE,
				"content-type": "image/png",
				"if-unmodified-since": "2026-11-13T11:00:00Z",
			},
		}),
	),
	// PUT ok
	putCase("put ok: a png on a draft with no picture", put(png())),
	putCase("put ok: a jpeg", put(image["image/jpeg"], "image/jpeg")),
	putCase("put ok: a webp", put(image["image/webp"], "image/webp")),
	putCase("put ok: replacing a picture deletes the old one", put(png()), {
		updates: [withKey()],
		r2: { seed: OLD },
	}),
	putCase(
		"put ok: replacing a png with a jpeg",
		put(image["image/jpeg"], "image/jpeg"),
		{ updates: [withKey()], r2: { seed: OLD } },
	),
	putCase("put ok: an old key that fails the key check is kept", put(png()), {
		updates: [withKey({ visual_key: "elsewhere/old.png" })],
		r2: { seed: { "elsewhere/old.png": { body: "x" } } },
	}),
	putCase("put ok: an old key under another update is kept", put(png()), {
		updates: [withKey({ visual_key: `software/r1/${D2}/old.png` })],
		r2: { seed: { [`software/r1/${D2}/old.png`]: { body: "x" } } },
	}),
	putCase("put ok: the old object is already gone", put(png()), {
		updates: [withKey()],
		r2: {},
	}),
	putCase(
		"put ok: a future draft time moves the stamp past it",
		put(png(), "image/png", {
			headers: {
				origin: SITE,
				"content-type": "image/png",
				"if-unmodified-since": FUTURE,
			},
		}),
		{ updates: [draft({ updated_at: FUTURE })] },
	),
	putCase("put guard: a complete project", put(png()), {
		project: { state: "complete" },
	}),
	putCase("put guard: a revoked project", put(png()), {
		project: { revoked_at: EARLIER },
	}),
	putCase("put guard: a withdrawn request", put(png()), {
		request: { status: "withdrawn" },
	}),
	putCase("put guard: a request with no email", put(png()), {
		request: { email: "" },
	}),
	putCase("put ok: a draft on a project that is preparing", put(png()), {
		project: { state: "preparing" },
	}),
	// cleanup, races and outages
	putCase("put cleanup: the old object cannot be deleted", put(png()), {
		updates: [withKey()],
		r2: { seed: OLD, fails: ["delete"] },
	}),
	race(
		"put race: the project changed",
		"UPDATE software_projects SET state='complete'",
		{ updates: [draft()] },
	),
	race(
		"put race: the project was revoked",
		"UPDATE software_projects SET revoked_at='2026-11-13T11:30:00.000Z'",
	),
	race(
		"put race: the request was withdrawn",
		"UPDATE owner_requests SET status='withdrawn'",
	),
	race(
		"put race: the draft changed",
		"UPDATE software_project_updates SET updated_at='2026-11-13T11:45:00.000Z'",
	),
	race(
		"put race: the draft was shared",
		"UPDATE software_project_updates SET status='shared',shared_at='2026-11-13T11:45:00.000Z'",
	),
	race(
		"put race: the draft was deleted",
		"DELETE FROM software_project_updates",
	),
	race(
		"put race: with an old picture, the old one stays",
		"UPDATE software_project_updates SET updated_at='2026-11-13T11:45:00.000Z'",
		{ updates: [withKey()], r2: { seed: OLD } },
	),
	putCase(
		"put outage: the draft lookup fails",
		put(png()),
		{},
		{
			failures: [
				{
					on: /SELECT visual_key,visual_alt,updated_at/,
					message: "D1 unavailable",
				},
			],
		},
	),
	putCase(
		"put outage: R2 put fails",
		put(png()),
		{},
		{ r2: { fails: ["put"] } },
	),
	putCase(
		"put outage: the batch fails and the new object is deleted",
		put(png()),
		{},
		{ failures: [{ on: raceOn, message: "D1 unavailable" }] },
	),
	putCase(
		"put outage: the batch and the cleanup delete both fail",
		put(png()),
		{},
		{
			failures: [{ on: raceOn, message: "D1 unavailable" }],
			r2: { fails: ["delete"] },
		},
	),
	putCase(
		"put outage: the batch fails with an old picture",
		put(png()),
		{ updates: [withKey()], r2: { seed: OLD } },
		{ failures: [{ on: raceOn, message: "D1 unavailable" }] },
	),
	// sequences
	{
		name: "put then get: the picture reads back with its headers",
		...stage(),
		steps: [
			put(png()),
			getStep({ path: `/api/owner/requests/r1/updates/${D1}/visual` }),
		],
	},
	{
		name: "put twice: the second needs the new time",
		...stage(),
		steps: [
			put(png()),
			put(image["image/jpeg"], "image/jpeg", {
				headers: (prior) => ({
					origin: SITE,
					"content-type": "image/jpeg",
					"if-unmodified-since": String(prior.answerJson(0).updatedAt),
				}),
			}),
		],
	},
	{
		name: "put twice: the second reuses the old time",
		...stage(),
		steps: [put(png()), put(image["image/jpeg"], "image/jpeg")],
	},
	{
		name: "put then get after a replacement: the new picture reads back",
		...stage({ updates: [withKey()], r2: { seed: OLD } }),
		steps: [put(image["image/webp"], "image/webp"), getStep()],
	},
	{
		name: "put then get after a failed cleanup",
		...stage({ updates: [withKey()], r2: { seed: OLD, fails: ["delete"] } }),
		steps: [put(png()), getStep()],
	},
	{
		name: "put then a draft save keeps the picture",
		...stage(),
		steps: [
			put(png()),
			post(
				(prior) =>
					command("draft", input({ visual_alt: "A new chart" }), {
						expectedUpdatedAt: String(prior.answerJson(0).updatedAt),
						expectedProjectUpdatedAt: EARLIER,
						updateId: D1,
					}),
				{
					handler: updates,
					path: "/api/owner/requests/r1/updates",
					params: { id: "r1" },
					dump: R2_DUMP,
				},
			),
		],
	},
	{
		name: "put then a draft save with no description is refused",
		...stage(),
		steps: [
			put(png()),
			post(
				(prior) =>
					command("draft", input({ visual_alt: "" }), {
						expectedUpdatedAt: String(prior.answerJson(0).updatedAt),
						expectedProjectUpdatedAt: EARLIER,
					}),
				{
					handler: updates,
					path: "/api/owner/requests/r1/updates",
					params: { id: "r1" },
					dump: R2_DUMP,
				},
			),
		],
	},
	{
		name: "put then get for a shared update the owner shared meanwhile",
		...stage(),
		steps: [
			put(png()),
			getStep({
				before: {
					label: "the draft is shared",
					run: (world: World) =>
						world.music.exec(
							"UPDATE software_project_updates SET status='shared',shared_at='2026-11-13T12:05:00.000Z'",
						),
				},
			}),
		],
	},
];

defineCorpus(
	"owner-request-update-visual",
	(context) => (context.request.method === "GET" ? GET(context) : PUT(context)),
	cases,
);
