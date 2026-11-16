// The fixed answers of the media routes (music/file, audio/file and og/[name].mp4) when storage fails or is not bound. They
// share the sentence the music file route has always used for a missing object; its status says which it is. A failure
// answers 500 and is logged once by the route; a missing binding is a deliberate 503. Neither carries the error's own text.
const SENTENCE = "Media unavailable";

/** R2 or the assets fetch failed unexpectedly, or the catalog could not be read. */
export const mediaFailed = () => new Response(SENTENCE, { status: 500 });

/** A binding the route needs is not bound. */
export const mediaUnavailable = () => new Response(SENTENCE, { status: 503 });
