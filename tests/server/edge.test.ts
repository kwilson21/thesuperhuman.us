import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import { describe, expect, it } from "vitest";
import {
	rawTextField,
	readAtEdge,
	readFields,
	readText,
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
