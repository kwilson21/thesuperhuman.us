import type { RawValue } from "./fields";

/** R2 reports itself unavailable as error 10043 (ServiceUnavailable), written at the end of the message as "... (10043)": a known dependency outage, answered 503, not an unexpected failure. */
export function objectStoreUnavailable(error: RawValue): boolean {
	return error instanceof Error && /\(10043\)$/.test(error.message);
}

/** R2 reports an upload it no longer has as error 10024, "The specified multipart upload does not exist." */
export function multipartUploadGone(error: RawValue): boolean {
	return (
		error instanceof Error &&
		/\(10024\)$|multipart upload does not exist/i.test(error.message)
	);
}

/** R2 reports two writes to one key at once, which the losing completion of two can get, as error 10058. */
export function concurrentWriteToKey(error: RawValue): boolean {
	return error instanceof Error && /\(10058\)$/.test(error.message);
}

/** R2 reports a completion with a missing part, or a part whose entity tag does not match, as error 10025 (invalid part). */
export function multipartPartInvalid(error: RawValue): boolean {
	return (
		error instanceof Error &&
		/\(10025\)$|specified parts could not be found/i.test(error.message)
	);
}
