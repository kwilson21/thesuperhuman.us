// The edge for the audio project routes: what each command's body must hold. Effect Schema readers that accept and refuse
// every body as the Zod 4 schemas they replaced did, with the same value (tests/server/audio-project-input-differential.test.ts
// holds each to a frozen copy of those schemas). A body that is not an object, an action that names none of the
// command's actions, or a field that does not read refuses the whole command, and the route answers its one sentence
// ("Check your message and try again.") whatever was wrong. What the value keeps, as Zod 4 kept it:
// - only the action's own fields; any other key is left out;
// - `body` is whatever the client sent, and its key must be there (Zod 4 refused a body with no `body` key, though one set
//   to undefined passes): the text rules read it, not the reader;
// - a message id is a whole number above 0 that a double holds exactly (Zod 4's `int()` refuses an unsafe integer), and
//   never Infinity or NaN;
// - a review id is 1 to 100 characters, counted by code points as Zod 4 counted them (a letter outside the basic plane is
//   one), and is not trimmed.
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { receivedKind } from "../lib/fields";

const messageBody = Schema.Unknown;

const messageId = Schema.Number.check(
	Schema.makeFilter(
		(value: number) => Number.isSafeInteger(value) && value > 0,
	),
);

const send = Schema.Struct({
	action: Schema.Literal("send"),
	body: messageBody,
});

const read = Schema.Struct({
	action: Schema.Literal("read"),
	messageId,
});

const respond = Schema.Struct({
	action: Schema.Literal("respond"),
	reviewId: Schema.String.check(
		Schema.makeFilter((value: string) => {
			const length = Array.from(value).length;

			return length >= 1 && length <= 100;
		}),
	),
	decision: Schema.Literals(["approved", "changes", "stopped"]),
	body: messageBody,
});

export type SendCommand = typeof send.Type;

export type ReadCommand = typeof read.Type;

export type RespondCommand = typeof respond.Type;

/** The owner's command: a message, or a mark that a client message was read. */
export type OwnerMessageCommand = SendCommand | ReadCommand;

/** The client's command: a message, a read mark, or an answer to the latest review. */
export type StudioMessageCommand = SendCommand | ReadCommand | RespondCommand;

/** Reads a command by its `action`, as a Zod discriminated union did: no object, or no such action, is refused. */
function readCommand<Body, Command>(
	body: Body,
	commands: { readonly [action: string]: Schema.Decoder<Command> },
): { ok: true; value: Command } | { ok: false } {
	if (receivedKind(body) !== "object" || !Predicate.isObject(body))
		return { ok: false };

	const named = "action" in body ? body.action : undefined;

	const reader = Object.entries(commands).find(
		([action]) => action === named,
	)?.[1];

	if (!reader) return { ok: false };
	const decoded = Schema.decodeUnknownResult(reader)(body);

	return Result.isSuccess(decoded)
		? { ok: true, value: decoded.success }
		: { ok: false };
}

/** Reads the owner's body. `body` is what `musicRequest` parsed from JSON. */
export const readOwnerMessageCommand = <Body>(body: Body) =>
	readCommand<Body, OwnerMessageCommand>(body, { send, read });

/** Reads the client's body. */
export const readStudioMessageCommand = <Body>(body: Body) =>
	readCommand<Body, StudioMessageCommand>(body, { send, read, respond });
