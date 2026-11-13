import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import { describe, expect, it } from "vitest";
import {
	type Body,
	choiceField,
	fieldOf,
	rawTextField,
	readAtEdge,
	readFields,
	readText,
	readVariants,
	receivedKind,
	stringField,
	textField,
} from "../../src/server/edge";

// A message on the base type is what a missing field or a value of the wrong type says; a message on a filter is
// what a value that fails the check says.
const Name = Schema.String.annotate({ message: "Name is required." }).check(
	Schema.isMinLength(1, { message: "Name is required." }),
	Schema.isMaxLength(100, { message: "Name is too long." }),
);

const Email = Schema.String.check(
	Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: "Invalid email." }),
);

const Service = Schema.Literals(["mix", "master"]);
const Company = Schema.UndefinedOr(Schema.String);

const Even = Schema.String.pipe(
	Schema.decodeTo(Schema.Number, {
		decode: readText<number>((text) =>
			Number(text) % 2 === 0
				? { value: Number(text) }
				: { say: "Use an even number." },
		),
		encode: SchemaGetter.transform((value: number) => String(value)),
	}),
);

describe("readText", () => {
	it("decodes text into a value, or refuses with the sentence it gives", () => {
		expect(readAtEdge(Even, "4")).toEqual({ ok: true, value: 4 });
		expect(readAtEdge(Even, "3")).toEqual({
			ok: false,
			say: "Use an even number.",
		});
	});
});

describe("readAtEdge", () => {
	it("gives the typed value for good input", () => {
		expect(readAtEdge(Name, "Kazon")).toEqual({ ok: true, value: "Kazon" });
	});

	it("gives the filter's own sentence when the input fails it", () => {
		expect(readAtEdge(Name, "")).toEqual({
			ok: false,
			say: "Name is required.",
		});
	});

	it("gives the base type's sentence for a field that is not there or is not text", () => {
		expect(readAtEdge(Name, undefined)).toEqual({
			ok: false,
			say: "Name is required.",
		});
		expect(readAtEdge(Name, 5)).toEqual({
			ok: false,
			say: "Name is required.",
		});
	});

	it("refuses a body that is not text", () => {
		expect(readAtEdge(Name, { a: 1 }).ok).toBe(false);
		expect(readAtEdge(Name, null).ok).toBe(false);
	});
});

describe("readFields", () => {
	const fields = {
		name: Name,
		email: Email,
		service: Service,
		company: Company,
	};

	it("decodes every field into a typed value", () => {
		const read = readFields(fields, {
			name: "Kazon",
			email: "k@example.com",
			service: "mix",
		});

		expect(read).toEqual({
			ok: true,
			value: {
				name: "Kazon",
				email: "k@example.com",
				service: "mix",
				company: undefined,
			},
		});
	});

	it("maps each failing field to its one sentence and keeps the good ones out", () => {
		const read = readFields(fields, {
			name: "",
			email: "nope",
			service: "mix",
			company: "Acme",
		});

		expect(read).toEqual({
			ok: false,
			errors: { name: "Name is required.", email: "Invalid email." },
		});
	});

	it("fails every required field for a body that is not an object", () => {
		for (const body of [null, undefined, "text", ["a"], 4]) {
			const read = readFields(fields, body);

			expect(read.ok).toBe(false);

			if (!read.ok) {
				expect(Object.keys(read.errors).sort()).toEqual([
					"email",
					"name",
					"service",
				]);
			}
		}
	});

	it("does not read a field the schemas do not name", () => {
		const read = readFields({ name: Name }, { name: "Kazon", admin: "true" });

		expect(read).toEqual({ ok: true, value: { name: "Kazon" } });
	});

	it("does not read a prototype property as a field", () => {
		const read = readFields({ toString: Name }, {});

		expect(read.ok).toBe(false);
	});

	it("has a closed error type keyed by the field names", () => {
		const read = readFields({ name: Name, email: Email }, {});

		if (!read.ok) {
			const name: string | undefined = read.errors.name;
			// @ts-expect-error only the named fields can have an error
			const other = read.errors.phone;

			expect(name).toBe("Name is required.");
			expect(other).toBeUndefined();
		}
	});
});

describe("readFields options", () => {
	const Code = textField(
		Schema.isMinLength(3, { message: "too short" }),
		Schema.isPattern(/^\d+$/, { message: "digits only" }),
	);

	it("takes the first failing check's sentence by default and the last when asked", () => {
		expect(readFields({ code: Code }, { code: "a" })).toEqual({
			ok: false,
			errors: { code: "too short" },
		});
		expect(
			readFields({ code: Code }, { code: "a" }, { winner: "last" }),
		).toEqual({
			ok: false,
			errors: { code: "digits only" },
		});
	});

	it("lists errors in the order the fields are written, not the body's", () => {
		const read = readFields(
			{ a: Code, b: Code, c: Code },
			{ c: "x", a: "x", b: "x" },
		);

		expect(read.ok).toBe(false);

		if (!read.ok) expect(Object.keys(read.errors)).toEqual(["a", "b", "c"]);
	});

	it("gives a missing or undefined field its default without reading it", () => {
		const read = readFields(
			{ code: Code, tags: Schema.Array(Schema.String) },
			{ code: "123" },
			{ defaults: { tags: [] } },
		);

		expect(read).toEqual({ ok: true, value: { code: "123", tags: [] } });
	});

	it("answers a body that is not an object under _form, with a sentence or one per kind", () => {
		expect(readFields({ code: Code }, null, { notObject: "bad body" })).toEqual(
			{
				ok: false,
				errors: { _form: "bad body" },
			},
		);
		expect(readFields({ code: Code }, [], { notObject: "bad body" }).ok).toBe(
			false,
		);
		expect(
			readFields({ code: Code }, ["x"], { notObject: { null: "n" } }),
		).toEqual({ ok: false, errors: { code: "too short" } });
		expect(
			readFields({ code: Code }, null, { notObject: { null: "n" } }),
		).toEqual({
			ok: false,
			errors: { _form: "n" },
		});
	});

	it("names undefined as a kind of its own and never refuses an object by a sentence for another kind", () => {
		const notObject = {
			undefined: "u",
			other: "o",
			array: "a",
		};

		expect(readFields({ code: Code }, undefined, { notObject })).toEqual({
			ok: false,
			errors: { _form: "u" },
		});
		expect(
			readFields({ code: Code }, { code: "12345" }, { notObject }),
		).toEqual({ ok: true, value: { code: "12345" } });
		expect(readFields({ code: Code }, 1n, { notObject })).toEqual({
			ok: false,
			errors: { _form: "o" },
		});
	});

	it("runs cross-field checks only after every field passed", () => {
		const after = (value: { readonly lo: number; readonly hi: number }) =>
			value.lo > value.hi ? { hi: "hi must not be below lo" } : {};

		const fields = { lo: Schema.Number, hi: Schema.Number };

		expect(readFields(fields, { lo: 3, hi: 1 }, { after })).toEqual({
			ok: false,
			errors: { hi: "hi must not be below lo" },
		});
		expect(readFields(fields, { lo: 1, hi: 3 }, { after }).ok).toBe(true);
		expect(readFields(fields, { lo: "x", hi: 1 }, { after })).toEqual({
			ok: false,
			errors: { lo: expect.any(String) },
		});
	});

	it("does not refuse a body because `after` answered entries that are all undefined", () => {
		const fields = { lo: Schema.Number };

		expect(
			readFields(fields, { lo: 1 }, { after: () => ({ lo: undefined }) }),
		).toEqual({ ok: true, value: { lo: 1 } });
		expect(readFields(fields, { lo: 1 }, { after: () => ({}) }).ok).toBe(true);
		expect(
			readFields(
				fields,
				{ lo: 1 },
				{ after: () => ({ lo: undefined, _form: "no" }) },
			),
		).toEqual({ ok: false, errors: { _form: "no" } });
	});

	it("keeps a raw text field untrimmed and reads a non-string as empty", () => {
		const read = readFields(
			{ token: rawTextField(), text: textField() },
			{ token: "  t  ", text: 5 },
		);

		expect(read).toEqual({ ok: true, value: { token: "  t  ", text: "" } });
	});

	it("accepts a body typed unknown", () => {
		let body: Schema.Unknown["Type"];

		body = { code: "123" };
		expect(readFields({ code: Code }, body).ok).toBe(true);
	});
});

describe("receivedKind", () => {
	it("names a value's kind the way a person reads it in 'received number'", () => {
		expect(
			[
				undefined,
				null,
				[],
				{},
				"a",
				1,
				Number.NaN,
				true,
				1n,
				Symbol("s"),
				() => 1,
			].map(receivedKind),
		).toEqual([
			"undefined",
			"null",
			"array",
			"object",
			"string",
			"number",
			"nan",
			"boolean",
			"bigint",
			"symbol",
			"function",
		]);
	});
});

describe("fieldOf", () => {
	const even = fieldOf<number>((raw) =>
		Predicate.isNumber(raw) && raw % 2 === 0
			? { value: raw }
			: { say: `Use an even number, not ${receivedKind(raw)}.` },
	);

	it("reads the raw value, so the sentence can depend on what arrived", () => {
		expect(readFields({ n: even }, { n: 4 })).toEqual({
			ok: true,
			value: { n: 4 },
		});
		expect(readFields({ n: even }, { n: "4" })).toEqual({
			ok: false,
			errors: { n: "Use an even number, not string." },
		});
		expect(readFields({ n: even }, {})).toEqual({
			ok: false,
			errors: { n: "Use an even number, not undefined." },
		});
	});

	it("gives a typed value", () => {
		const read = readFields({ n: even }, { n: 2 });
		const n: number | undefined = read.ok ? read.value.n : undefined;

		expect(n).toBe(2);
	});
});

describe("stringField", () => {
	const field = stringField(
		{
			missing: "Required",
			wrongType: (received) => `Expected string, received ${received}`,
		},
		Schema.isMaxLength(5, { message: "Too long." }),
	);

	it("gives one sentence for a missing value and another that names the received type", () => {
		expect(readFields({ f: field }, {})).toEqual({
			ok: false,
			errors: { f: "Required" },
		});
		expect(readFields({ f: field }, { f: undefined })).toEqual({
			ok: false,
			errors: { f: "Required" },
		});
		expect(readFields({ f: field }, { f: 5 })).toEqual({
			ok: false,
			errors: { f: "Expected string, received number" },
		});
		expect(readFields({ f: field }, { f: null })).toEqual({
			ok: false,
			errors: { f: "Expected string, received null" },
		});
		expect(readFields({ f: field }, { f: ["a"] })).toEqual({
			ok: false,
			errors: { f: "Expected string, received array" },
		});
	});

	it("trims a string by default, runs the checks on it, and can leave it as it arrived", () => {
		expect(readFields({ f: field }, { f: "  abc  " })).toEqual({
			ok: true,
			value: { f: "abc" },
		});
		expect(readFields({ f: field }, { f: "abcdefg" })).toEqual({
			ok: false,
			errors: { f: "Too long." },
		});

		const raw = stringField({
			missing: "Required",
			wrongType: () => "Wrong",
			trim: false,
		});

		expect(readFields({ f: raw }, { f: "  a  " })).toEqual({
			ok: true,
			value: { f: "  a  " },
		});
	});
});

describe("choiceField", () => {
	const field = choiceField(["mix", "master"], {
		missing: "Required",
		wrongType: (received) => `Expected 'mix' | 'master', received ${received}`,
		notOneOf: (received) =>
			`Invalid choice. Expected 'mix' | 'master', received '${received}'`,
	});

	it("keeps the raw value so each sentence can quote what was received", () => {
		expect(readFields({ f: field }, {})).toEqual({
			ok: false,
			errors: { f: "Required" },
		});
		expect(readFields({ f: field }, { f: 3 })).toEqual({
			ok: false,
			errors: { f: "Expected 'mix' | 'master', received number" },
		});
		expect(readFields({ f: field }, { f: "x" })).toEqual({
			ok: false,
			errors: { f: "Invalid choice. Expected 'mix' | 'master', received 'x'" },
		});
		expect(readFields({ f: field }, { f: "mix" })).toEqual({
			ok: true,
			value: { f: "mix" },
		});
	});

	it("has the literal union as its type", () => {
		const read = readFields({ f: field }, { f: "master" });
		const f: "mix" | "master" | undefined = read.ok ? read.value.f : undefined;

		expect(f).toBe("master");
	});

	it("does not take an inherited property name as a choice", () => {
		expect(readFields({ f: field }, { f: "toString" }).ok).toBe(false);
	});
});

describe("readVariants", () => {
	const text = (max: number) =>
		stringField(
			{ missing: "Required", wrongType: () => "Required" },
			Schema.isMaxLength(max, { message: `Under ${max}.` }),
		);

	const variants = {
		site: { name: text(5), url: text(10) },
		app: { name: text(5), goal: text(10), notes: text(10) },
	};

	const options = {
		unknownVariant: "Choose a starting point.",
		notObject: "Send the form again.",
		defaults: { app: { notes: "" } },
	};

	it("reads the fields of the variant the discriminator names, and tags the value with it", () => {
		expect(
			readVariants(
				"path",
				variants,
				{ path: "site", name: "Ada", url: "u" },
				options,
			),
		).toEqual({ ok: true, value: { path: "site", name: "Ada", url: "u" } });
		expect(
			readVariants(
				"path",
				variants,
				{ path: "app", name: "Ada", goal: "g" },
				options,
			),
		).toEqual({
			ok: true,
			value: { path: "app", name: "Ada", goal: "g", notes: "" },
		});
	});

	it("does not read another variant's fields", () => {
		expect(
			readVariants(
				"path",
				variants,
				{ path: "site", name: "Ada", url: "u", goal: 4 },
				options,
			).ok,
		).toBe(true);
	});

	it("lists errors in the order the variant's fields are written", () => {
		const read = readVariants(
			"path",
			variants,
			{ path: "app", notes: "n".repeat(20), goal: 5, name: "Ada Lovelace" },
			options,
		);

		expect(read).toEqual({
			ok: false,
			errors: { name: "Under 5.", goal: "Required", notes: "Under 10." },
		});

		if (!read.ok)
			expect(Object.keys(read.errors)).toEqual(["name", "goal", "notes"]);
	});

	it("answers an unknown, missing or inherited discriminator with its own sentence", () => {
		for (const path of ["nope", undefined, 4, null, "toString", "__proto__"])
			expect(
				readVariants("path", variants, { path, name: "x" }, options),
			).toEqual({
				ok: false,
				errors: { path: "Choose a starting point." },
			});
	});

	it("answers a body that is not an object under _form", () => {
		expect(readVariants("path", variants, null, options)).toEqual({
			ok: false,
			errors: { _form: "Send the form again." },
		});
	});

	it("has a union keyed by the discriminator as its type", () => {
		const read = readVariants(
			"path",
			variants,
			{ path: "app", name: "a", goal: "g" },
			options,
		);

		if (read.ok && read.value.path === "app") {
			const goal: string = read.value.goal;

			// @ts-expect-error the site variant has no goal, and a narrowed app value has no url
			const url: string = read.value.url;

			expect(goal).toBe("g");
			expect(url).toBeUndefined();
		}
	});

	it("runs `after` on the typed union once every field passed", () => {
		const after = (value: { readonly path: string; readonly name: string }) =>
			value.name === "Ada" ? { name: "No Adas." } : {};

		expect(
			readVariants(
				"path",
				variants,
				{ path: "site", name: "Ada", url: "u" },
				{ ...options, after },
			),
		).toEqual({ ok: false, errors: { name: "No Adas." } });
	});
});

describe("alongside", () => {
	const fields = {
		a: stringField(
			{ missing: "a required", wrongType: () => "a required" },
			Schema.isMaxLength(3, { message: "a too long" }),
		),
		b: stringField({ missing: "b required", wrongType: () => "b required" }),
	};

	const alongside = (input: Body) =>
		input.a === "line\nbreak" ? { z: "z extra", a: "a one line" } : {};

	it("runs while the field checks fail, and its sentence overrides the field's in the field's place", () => {
		const read = readFields(fields, { a: "line\nbreak", b: 2 }, { alongside });

		expect(read).toEqual({
			ok: false,
			errors: { a: "a one line", b: "b required", z: "z extra" },
		});

		// a keeps the position the field errors gave it; a key only alongside names comes after them.
		if (!read.ok) expect(Object.keys(read.errors)).toEqual(["a", "b", "z"]);
	});

	it("refuses a body whose fields all passed when alongside answers anything, and then skips `after`", () => {
		let ran = false;

		const read = readFields(
			fields,
			{ a: "ok", b: "b" },
			{
				alongside: () => ({ b: "b alongside" }),
				after: () => {
					ran = true;

					return {};
				},
			},
		);

		expect(read).toEqual({ ok: false, errors: { b: "b alongside" } });
		expect(ran).toBe(false);
	});

	it("leaves the answer alone when it says nothing", () => {
		expect(
			readFields(
				fields,
				{ a: "ok", b: "b" },
				{ alongside: () => ({ a: undefined }) },
			),
		).toEqual({ ok: true, value: { a: "ok", b: "b" } });
	});

	it("is not run for a body that is not an object", () => {
		let ran = false;

		readFields(fields, "text", {
			notObject: "bad",
			alongside: () => {
				ran = true;

				return {};
			},
		});
		expect(ran).toBe(false);
	});

	it("runs for an unknown discriminator too, in readVariants", () => {
		const read = readVariants(
			"path",
			{ one: fields },
			{ path: "nope", a: "line\nbreak" },
			{ unknownVariant: "Choose.", alongside },
		);

		expect(read).toEqual({
			ok: false,
			errors: { path: "Choose.", a: "a one line", z: "z extra" },
		});
	});
});
