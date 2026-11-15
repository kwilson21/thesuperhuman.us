import { expect, it } from "vitest";
import { softwareBriefEmail } from "~/lib/client-emails";

it("labels each brief answer in the client's wording, and prints undefined for a key with no label", () => {
	const copy = softwareBriefEmail("Jordan Clay", {
		existing: "An old site",
		nope: "Not a label",
	});

	expect(copy.text).toContain("What you already have\nAn old site");
	expect(copy.text).toContain("undefined\nNot a label");
});

it.each(["constructor", "toString", "__proto__"])(
	"prints a key inherited from Object.prototype (%s) the same way as an unknown key",
	(key) => {
		const inherited = softwareBriefEmail(
			"Jordan Clay",
			Object.fromEntries([[key, "An answer"]]),
		);

		const unknown = softwareBriefEmail("Jordan Clay", { nope: "An answer" });

		expect(inherited.text).toBe(unknown.text);
		expect(inherited.text).toContain("undefined\nAn answer");
	},
);
