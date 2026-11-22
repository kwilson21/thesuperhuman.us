import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { privateProjectObjectKey } from "../../src/lib/audio-project-files";
import {
	AudioBucket,
	Background,
	MusicDb,
	StudioNoticeMail,
	type StudioNoticeOutcome,
} from "../../src/server/services";
import { double, partial } from "./doubles";
import { musicWorld } from "./music-world";

// A project, its payment and its files in the real schema, and the services the file flows run with, for the flow stories of the
// uploads, the owner's file route and the client's file read.

export type AudioWorld = ReturnType<typeof musicWorld>;

export const AT = new Date("2026-11-13T12:00:00.000Z");
export const OWNER = "owner@example.com";

/** A service request with its project (the trigger makes it), a payment, and the project moved to `stage`. */
export function seedProject(
	world: AudioWorld,
	stage: string,
	payment: { booking?: string; balance?: string } = {},
	request = "song-1",
) {
	const at = AT.toISOString();

	world.sql
		.prepare(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
      VALUES (?,'service','artist@example.com','A song','reviewed',?,?)`)
		.run(request, at, at);
	world.sql
		.prepare(`INSERT INTO audio_payments(request_id,approved_service,total_amount_cents,booking_amount_cents,balance_amount_cents,
      offer_accepted_at,booking_status,balance_status,created_at,updated_at)
      VALUES (?,'Mix',10000,5000,5000,?,?,?,?,?)`)
		.run(
			request,
			at,
			payment.booking ?? "paid",
			payment.balance ?? "open",
			at,
			at,
		);
	world.sql
		.prepare("UPDATE audio_projects SET stage=? WHERE request_id=?")
		.run(stage, request);
}

/** A file row of the project; `status` and the other columns as given. */
export function seedFile(
	world: AudioWorld,
	id: string,
	over: { [column: string]: string | number | null } = {},
	request = "song-1",
) {
	const row = {
		id,
		request_id: request,
		version: "review",
		object_key: privateProjectObjectKey(request, id, "audio/mpeg"),
		display_name: "Mix",
		media_type: "audio/mpeg",
		byte_size: 5,
		status: "uploaded",
		uploaded_at: AT.toISOString(),
		published_at: null,
		expires_at: null,
		...over,
	};

	const columns = Object.keys(row);

	world.sql
		.prepare(
			`INSERT INTO audio_project_files(${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
		)
		.run(...Object.values(row));
}

/** An R2 bucket in a map: `objects` holds each object's size, and each call is the member the test gives, if any. */
export function memoryBucket(members: Partial<R2Bucket> = {}) {
	const objects = new Map<string, number>();
	const deleted: string[] = [];

	const bucket = double<R2Bucket>({
		head: async (key: string) => {
			const size = objects.get(key);

			return size === undefined ? null : partial<R2Object>({ size });
		},
		delete: async (key: string) => {
			deleted.push(key);
			objects.delete(key);
		},
		...members,
	});

	return { bucket, objects, deleted };
}

/** What the flows start in the background, and the studio notices they send: each is recorded, and the provider says `answer`. */
export function backgroundWorld(answer: StudioNoticeOutcome = "sent") {
	const mails: { to: string; subject: string; kind: string }[] = [];
	const defers: number[] = [];

	const services = Context.merge(
		Context.make(Background, {
			schedule: () => Effect.void,
			defer: (work) =>
				Effect.sync(() => {
					defers.push(work.length);
				}).pipe(Effect.andThen(Effect.all(work, { discard: true }))),
		}),
		Context.make(StudioNoticeMail, {
			send: (notice) =>
				Effect.sync(() => {
					mails.push(notice);

					return answer;
				}),
		}),
	);

	return { services, mails, defers };
}

/** The services of a flow that reads the database and the bucket. */
export const worldServices = (world: AudioWorld, bucket: R2Bucket) =>
	Context.merge(
		Context.make(MusicDb, world.db),
		Context.make(AudioBucket, bucket),
	);

/** What a flow ended in, in a story's words: its answer, or the name of the refusal or failure. */
export const endedWith = <A, E extends { readonly _tag: string }, R>(
	flow: Effect.Effect<A, E, R>,
	services: Context.Context<R>,
) =>
	Effect.runPromise(
		flow.pipe(
			Effect.map((value) => ({ done: value })),
			Effect.catch((failure) => Effect.succeed({ refused: failure._tag })),
			Effect.provideContext(services),
		),
	);
