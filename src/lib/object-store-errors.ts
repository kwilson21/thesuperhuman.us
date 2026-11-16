import type { RawValue } from "./fields";

/** R2 reports itself unavailable as error 10043 (ServiceUnavailable), written at the end of the message as "... (10043)": a known dependency outage, answered 503, not an unexpected failure. */
export function objectStoreUnavailable(error: RawValue): boolean {
	return error instanceof Error && /\(10043\)$/.test(error.message);
}
