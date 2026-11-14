// The shared golden-corpus harness. See tests/golden/README.md.
export {
	asClient,
	asClientCookie,
	asOwner,
	asVisitor,
	OWNER_EMAIL,
	type Actor,
} from "./actors";

export {
	dump,
	freshMusicDb,
	freshPublicationDb,
	seed,
	type Seed,
	type SeedRow,
} from "./db";

export { START, uuidFor } from "./determinism";

export type { InjectedFailure, Interleave } from "./d1";

export type { Effect, EffectBody } from "./log";

export {
	aiAfter,
	aiNever,
	aiThrows,
	aiValue,
	byHost,
	json,
	networkDown,
	text,
	type AiAnswer,
	type FetchAnswer,
	type FetchCall,
	type Responder,
} from "./net";

export * as rows from "./rows";

export { asFixture, sameRecord } from "./fixtures";

export { signStripeWebhook } from "./stripe";

export type { OptionalTrigger } from "./triggers";

export {
	CASE_TIMEOUT_MS,
	defineCorpus,
	generatedBody,
	runCase,
	DEFAULT_ENV,
	type Case,
	type CaseRecord,
	type Dump,
	type GeneratedBody,
	type Handler,
	type Lazy,
	type Prior,
	type StepBody,
	type Step,
	type World,
} from "./world";
