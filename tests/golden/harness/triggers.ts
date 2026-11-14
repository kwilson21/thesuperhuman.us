// Declared triggers of a case: the failures, outages and races it says it provokes. A trigger that never fires leaves a
// case that records the happy path under a name that claims an outage or a race, which is what happens silently when a
// conversion changes the SQL a hook matches. So the runner checks, at the end of every case (recording or checking), that
// each declared trigger fired as often as it was declared to, and fails the case if one did not.
//
// A trigger that may legitimately stay quiet is listed in the case's `optionalTriggers` with the reason, in the test file.

/** A declared trigger that need not fire. `trigger` is the text the failure message prints for it. */
export type OptionalTrigger = {
	readonly trigger: string;
	readonly reason: string;
};

type Entry = { need: number; seen: number };

export class Triggers {
	private readonly entries = new Map<string, Entry>();

	/** `isRecording` is false while off-record work (sign-in, setup, hooks) runs; it never counts. */
	constructor(private readonly isRecording: () => boolean = () => true) {}

	/** Declares a trigger that must be seen `need` times. The same text declared again keeps the larger need. */
	declare(id: string, need = 1) {
		const known = this.entries.get(id);

		if (known) known.need = Math.max(known.need, need);
		else this.entries.set(id, { need, seen: 0 });
	}

	/** Counts one match or one firing of a declared trigger. */
	see(id: string) {
		if (!this.isRecording()) return;

		const known = this.entries.get(id);

		if (known) known.seen += 1;
	}

	/** What is wrong: each declared trigger that did not fire enough and is not optional, and each optional entry that is not valid. */
	problems(optional: readonly OptionalTrigger[] = []): string[] {
		const found: string[] = [];
		const allowed = new Set<string>();

		for (const entry of optional) {
			if (entry.reason.trim() === "")
				found.push(`optional trigger "${entry.trigger}" has no reason`);
			else if (!this.entries.has(entry.trigger))
				found.push(
					`optional trigger "${entry.trigger}" matches no declared trigger of the case`,
				);
			else allowed.add(entry.trigger);
		}

		for (const [id, { need, seen }] of this.entries)
			if (seen < need && !allowed.has(id))
				found.push(
					`declared trigger did not fire: ${id} (seen ${seen} time${seen === 1 ? "" : "s"}, declared ${need})`,
				);

		return found;
	}
}
