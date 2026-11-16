// Delivers the results of tracked macrotask work in the order the work STARTED.
//
// A threaded WebCrypto operation or a setImmediate finishes whenever the machine finishes it, and the order of those
// finishes is real time. If a finished result were handed to the route at once, the route's next step (a timer it
// creates, an effect it starts) would depend on which digest was faster. So each piece of tracked work takes a slot when
// it starts. When it finishes, the slot keeps the result. The driver hands results to the route one at a time, oldest slot
// first, and only at a driver turn, so what the route does next is a function of its own structure.
//
// Work in flight is every slot not yet delivered (finished or not). The driver waits for the oldest slot to finish; it
// never delivers a later one first.

export type SlotKind = "threads" | "immediate";

export type Slot = {
	readonly kind: SlotKind;
	finished: boolean;
	deliver: (() => void) | undefined;
};

export class Sequencer {
	private readonly slots: Slot[] = [];

	/** Told when a slot finishes, so a runner waiting for it can wake. */
	constructor(private readonly changed: () => void) {}

	/** Takes a place in the delivery order for work that starts now. Returns the slot to finish. */
	start(kind: SlotKind): Slot {
		const slot: Slot = { kind, finished: false, deliver: undefined };

		this.slots.push(slot);

		return slot;
	}

	/** The work of `slot` finished with `deliver` as the way to hand its result to the route. */
	finish(slot: Slot, deliver: () => void) {
		slot.finished = true;
		slot.deliver = deliver;
		this.changed();
	}

	/** Work that has started and not yet been delivered. */
	get pending() {
		return this.slots.length;
	}

	/** True when every undelivered slot is a setImmediate (none is a threaded operation). */
	get onlyImmediates() {
		return this.slots.every((slot) => slot.kind === "immediate");
	}

	/**
	 * Delivers the oldest slot if it has finished, one per call. Returns its kind, or undefined when the oldest slot is
	 * still running (or there is none). A later slot that finished first waits here until the earlier ones are delivered.
	 */
	deliverNext(): SlotKind | undefined {
		const head = this.slots[0];

		if (!head?.finished) return undefined;

		this.slots.shift();
		head.deliver?.();

		return head.kind;
	}
}
