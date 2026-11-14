// Hand-built golden records in the shape the harness writes (format 4), for the tests of the comparison and proof tools.
import { createHash } from "node:crypto";

export const sha = (name: string) =>
	createHash("sha256").update(name).digest("hex");

export type Stated = {
	music: string;
	publication: string;
	touched: string[];
};

/** The state a harness record holds at an outside effect, and at the response. */
export const stateOf = (music = "m", touched: string[] = []): Stated => ({
	music: sha(music),
	publication: sha("p"),
	touched,
});

export const digestOf = (atResponse = "m", touched: string[] = []) => ({
	music: sha("end"),
	publication: sha("p"),
	r2: sha("r"),
	kv: sha("k"),
	atResponse: stateOf(atResponse, touched),
});

export const finalStateOf = () => ({
	music: {
		sha256: sha("final"),
		tables: { items: { rows: 1, sha256: sha("items") } },
	},
	publication: { sha256: sha("pub"), tables: {} },
	r2: {},
	kv: { RATE_LIMIT: {}, RESUME_STORE: {}, OAUTH_KV: null },
});
