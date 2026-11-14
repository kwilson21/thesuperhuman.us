/**
 * A sentence the code wrote for the person reading the answer. A route may put the message of this error in its
 * response; it never puts the message of any other error there, because those come from the database, the JSON parser
 * or the runtime and say nothing a reader can use. `src/server/failure.ts` sorts what a route caught.
 */
export class ReaderMessage extends Error {}

/**
 * Another request changed the facts this one was built on, found by a check written for one batch (see
 * `reviewAgreements`): a lost race, which a route answers with 409 and its own sentence. A route never shows its message.
 */
export class LostRace extends Error {}
