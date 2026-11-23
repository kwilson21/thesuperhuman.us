import { expect, it } from "vitest";
import { POST } from "~/pages/api/offer/[token]/review";
import { runCase } from "../golden/harness";
import {
	REVIEW_TABLES,
	TOKEN,
	wireKit,
} from "../golden/areas/agreement-access";

// Two tabs review the same agreement at once. The tab whose batch loses a fact it decided from (the client row, the one
// pending MSA per client and template) reads and decides again, and answers what it then reads (behaviour fix B7 of
// docs/plans/2026-11-signing-conversion.md); a failure that no concurrent request explains answers 500.

const { scenario } = wireKit(`/api/offer/${TOKEN}/review`, REVIEW_TABLES);

const CLIENTS_INSERT = /INSERT OR IGNORE INTO software_agreement_clients/;

const KEY =
	"'grace@example.test','Hopper Systems LLC','hopper systems llc','LLC','Virginia','1 Main Street, Roanoke, VA 24011','grace@example.test'";

const answers = async (
	name: string,
	sql: string,
	failures: { on: RegExp; message: string; nth?: number }[] = [],
) => {
	const [json] = scenario(name, {
		wires: ["json"],
		over: {
			interleave: sql
				? [
						{
							on: CLIENTS_INSERT,
							label: name,
							run: (sqlite: { exec: (statement: string) => void }) =>
								sqlite.exec(sql),
						},
					]
				: [],
			failures: failures.map((failure) => ({ nth: 1, ...failure })),
		},
	});

	const record = await runCase(POST, json);
	const answer = record.steps[0].answer;

	return {
		status: "status" in answer ? answer.status : undefined,
		body: "body" in answer ? answer.body : undefined,
		logged: JSON.stringify(
			record.effects.filter((effect) => effect.kind === "console"),
		),
	};
};

it("reviews with the other tab's client when another tab creates the same legal party first", async () => {
	const result = await answers(
		"party created by another tab",
		`INSERT INTO software_agreement_clients VALUES('client-race',${KEY},'2026-11-13T11:59:59.000Z')`,
	);

	expect(result.status).toBe(200);
	expect(result.body).toContain('"ok":true');
});

it("answers 409 when another offer's MSA for the party appears before the batch", async () => {
	const result = await answers(
		"another offer's MSA appears",
		`INSERT INTO software_agreement_clients VALUES('client-1',${KEY},'2026-11-13T11:59:59.000Z'); INSERT INTO owner_requests(id,kind,name,email,summary,status,created_at,updated_at) VALUES('r3','software','Grace','grace@example.test','x','reviewed','t','t'); INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at) VALUES('o-r3','r3',1,'sent','{}','t','t'); INSERT INTO software_agreements(id,kind,offer_id,request_id,client_id,template_id,status,canonical_text,text_sha256,values_json,created_at,effective_on,review_session_hash) VALUES('ag-race','msa','o-r3','r3','client-1','tpl-msa','review','x','${"3".repeat(64)}','{}','t','2026-11-13','h')`,
	);

	expect(result.status).toBe(409);
	expect(result.body).toBe(
		'{"ok":false,"error":"Another offer has a pending MSA for this party. Ask Kazon to resolve it."}',
	);
});

it("answers 500 when a lookup fails for a reason no request explains", async () => {
	const result = await answers("outage", "", [
		{
			on: /SELECT \* FROM software_agreement_templates/,
			message: "d1 down",
		},
	]);

	expect(result.status).toBe(500);
});

const AGREEMENTS_INSERT = /INSERT INTO software_agreements\(/;
const FOREIGN_KEY = "FOREIGN KEY constraint failed";

it("answers 500 and logs the original error for a foreign key failure no race explains", async () => {
	const result = await answers("foreign key with no race", "", [
		{ on: AGREEMENTS_INSERT, message: FOREIGN_KEY },
	]);

	expect(result.status).toBe(500);
	expect(result.logged).toContain(FOREIGN_KEY);
});

it("answers 500 and logs the original error when the check for a race fails too", async () => {
	const result = await answers("foreign key and a failing check", "", [
		{ on: AGREEMENTS_INSERT, message: FOREIGN_KEY },
		// The evidence for a new client: the clients with its key, read again after the failure (the first read of that text
		// is the review's own, before the batch).
		{
			on: /SELECT id FROM software_agreement_clients WHERE recipient_email/,
			nth: 2,
			message: "the follow-up read is down",
		},
	]);

	expect(result.status).toBe(500);
	expect(result.logged).toContain(FOREIGN_KEY);
	expect(result.logged).not.toContain("follow-up");
});

it("reviews with the other request's client when the client the review found is replaced before the batch (#393)", async () => {
	// The client row the review finds by its key is there before the review's reads (added just before the draft batch);
	// another request then replaces it with its own row for the same legal party, just before the review batch. The
	// batch's documents name the row that is gone, so the batch fails its foreign key; the evidence read after it finds
	// that row gone, and the review reads and decides again with the other request's client.
	const [json] = scenario("the client found is replaced before the batch", {
		wires: ["json"],
		over: {
			interleave: [
				{
					on: /INSERT INTO software_agreement_drafts/,
					label: "the client is there before the review",
					run: (sqlite) =>
						sqlite.exec(
							`INSERT INTO software_agreement_clients VALUES('client-old',${KEY},'2026-11-13T11:00:00.000Z')`,
						),
				},
				{
					on: CLIENTS_INSERT,
					label: "another request replaces the client",
					run: (sqlite) =>
						sqlite.exec(
							`DELETE FROM software_agreement_clients WHERE id='client-old'; INSERT INTO software_agreement_clients VALUES('client-other',${KEY},'2026-11-13T11:59:59.000Z')`,
						),
				},
			],
		},
	});

	const record = await runCase(POST, {
		...json,
		steps: json.steps.map((step) => ({
			...step,
			dump: { music: [...REVIEW_TABLES, "software_agreement_clients"] },
		})),
	});

	const answer = record.steps[0].answer;

	expect("status" in answer ? answer.status : undefined).toBe(200);

	const batches = record.effects.flatMap((effect) =>
		effect.kind === "d1-batch" &&
		effect.statements.some((statement) => CLIENTS_INSERT.test(statement.sql))
			? [effect.result]
			: [],
	);

	expect(batches).toEqual(["rolled-back", "committed"]);
	expect(JSON.stringify(record.steps[0].state)).toContain('"client-other"');
	expect(JSON.stringify(record.steps[0].state)).not.toContain('"client-old"');
});
