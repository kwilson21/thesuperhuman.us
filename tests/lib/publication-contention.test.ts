import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { D1PublicationJournal } from "~/lib/publication/journal";
import type { Publication } from "~/lib/publication/contract";
import { double } from "../helpers/doubles";
import { fakeBatch } from "../helpers/tests-lib-a-bindings";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

it("serializes simultaneous connections competing for the same project revision", async () => {
	const directory = mkdtempSync(join(tmpdir(), "publication-"));
	const filename = join(directory, "journal.sqlite");
	const sql = new DatabaseSync(filename);
	sql.exec(
		readFileSync(
			new URL(
				"../../migrations/publication/0001_publication_journal.sql",
				import.meta.url,
			),
			"utf8",
		),
	);
	sql.close();
	const barrier = new SharedArrayBuffer(4);
	const workers: Worker[] = [];

	const pending = new WeakMap<
		D1PreparedStatement,
		{ query: string; args: unknown[] }
	>();

	const statement = (
		query: string,
		args: unknown[] = [],
	): D1PreparedStatement => {
		const prepared = double<D1PreparedStatement>({
			bind: (...values: unknown[]) => statement(query, values),
		});

		pending.set(prepared, { query, args });

		return prepared;
	};

	const statementOf = (item: D1PreparedStatement) => {
		const info = pending.get(item);

		if (!info) throw new Error("Expected a statement prepared by this test.");

		return info;
	};

	const db = double<D1Database>({
		prepare: (query: string) => statement(query),
		batch: fakeBatch(
			(statements) =>
				new Promise<D1Result[]>((resolve, reject) => {
					const worker = new Worker(
						`
        const { workerData: d, parentPort } = require('node:worker_threads');
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(d.filename);
        db.exec('PRAGMA busy_timeout=5000');
        const gate = new Int32Array(d.barrier);
        Atomics.add(gate,0,1); Atomics.notify(gate,0);
        while (Atomics.load(gate,0)<2) Atomics.wait(gate,0,1,5000);
        try {
          db.exec('BEGIN IMMEDIATE');
          const results = d.statements.map(s => ({ results: db.prepare(s.query).all(Object.fromEntries(s.args.map((value,index) => [String(index+1),value]))) }));
          db.exec('COMMIT'); parentPort.postMessage(results);
        } finally { db.close(); }
      `,
						{
							eval: true,
							workerData: {
								filename,
								barrier,
								statements: statements.map(statementOf),
							},
						},
					);

					workers.push(worker);
					worker.once("message", resolve);
					worker.once("error", reject);
					worker.once("exit", (code) => {
						if (code) reject(new Error("Worker failed"));
					});
				}),
		),
	});

	const journal = new D1PublicationJournal(db);

	const p: Publication = {
		version: 1,
		projectId: "threadline",
		eventId: "a",
		entryId: "a",
		expectedRevision: 0,
		operation: "withdraw",
		story: null,
		origin: "work",
		occurredOn: "2026-09-05",
		threadId: null,
		milestoneId: null,
	};

	try {
		const results = await Promise.all([
			journal.commit(p),
			journal.commit({ ...p, eventId: "b", entryId: "b" }),
		]);

		expect(results.map((r) => r.status).sort()).toEqual([
			"accepted",
			"conflict",
		]);
	} finally {
		await Promise.all(workers.map((w) => w.terminate()));
		rmSync(directory, { recursive: true, force: true });
	}
});
