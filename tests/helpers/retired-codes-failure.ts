import { double } from "./doubles";

/** The fixed line the cleanup of the retired sign-in codes table logs when it fails. */
export const retiredCleanupLogLine =
	"Retired sign-in codes cleanup failed (Error).";

/**
 * A database that behaves as `real` except that any statement on the retired sign-in codes table fails, as an outage
 * would after the revocation batch has committed.
 */
export function failingRetiredCleanup(real: D1Database): D1Database {
	const refused: D1PreparedStatement = double<D1PreparedStatement>({
		bind: (): D1PreparedStatement => refused,
		run: async () => {
			throw new Error("d1 down");
		},
	});

	return double<D1Database>({
		prepare: (query: string) =>
			query.includes("audio_client_codes") ? refused : real.prepare(query),
		batch: (items: D1PreparedStatement[]) => real.batch(items),
	});
}
