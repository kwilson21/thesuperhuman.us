import { expect, it } from "vitest";
import { POST } from "~/pages/api/offer/[token]/review";
import { runCase } from "../golden/harness";
import {
	REVIEW_TABLES,
	TOKEN,
	wireKit,
} from "../golden/areas/agreement-access";

// Two tabs review the same agreement at once. The tab that loses the race answers 409 with the route's own sentence; a
// failure that no concurrent request explains answers 500.

const { scenario } = wireKit(`/api/offer/${TOKEN}/review`, REVIEW_TABLES);

const CLIENTS_INSERT = /INSERT OR IGNORE INTO software_agreement_clients/;

const KEY =
	"'grace@example.test','Hopper Systems LLC','hopper systems llc','LLC','Virginia','1 Main Street, Roanoke, VA 24011','grace@example.test'";

const answers = async (
	name: string,
	sql: string,
	failure?: { on: RegExp; message: string },
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
			failures: failure ? [{ ...failure, nth: 1 }] : [],
		},
	});

	const record = await runCase(POST, json);
	const answer = record.steps[0].answer;

	return {
		status: "status" in answer ? answer.status : undefined,
		body: "body" in answer ? answer.body : undefined,
	};
};

it("answers 409 when another tab creates the same legal party first", async () => {
	const result = await answers(
		"party created by another tab",
		`INSERT INTO software_agreement_clients VALUES('client-race',${KEY},'2026-11-13T11:59:59.000Z')`,
	);

	expect(result.status).toBe(409);
	expect(result.body).toBe(
		'{"ok":false,"error":"The agreement could not be reviewed."}',
	);
});

it("answers 409 when another offer's MSA for the party appears before the batch", async () => {
	const result = await answers(
		"another offer's MSA appears",
		`INSERT INTO software_agreement_clients VALUES('client-1',${KEY},'2026-11-13T11:59:59.000Z'); INSERT INTO owner_requests(id,kind,name,email,summary,status,created_at,updated_at) VALUES('r3','software','Grace','grace@example.test','x','reviewed','t','t'); INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at) VALUES('o-r3','r3',1,'sent','{}','t','t'); INSERT INTO software_agreements(id,kind,offer_id,request_id,client_id,template_id,status,canonical_text,text_sha256,values_json,created_at,effective_on,review_session_hash) VALUES('ag-race','msa','o-r3','r3','client-1','tpl-msa','review','x','${"3".repeat(64)}','{}','t','2026-11-13','h')`,
	);

	expect(result.status).toBe(409);
});

it("answers 500 when a lookup fails for a reason no request explains", async () => {
	const result = await answers("outage", "", {
		on: /SELECT \* FROM software_agreement_templates/,
		message: "d1 down",
	});

	expect(result.status).toBe(500);
});
