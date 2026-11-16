import type { RawValue } from "./fields";

/** R2 reports itself unavailable as error 10043 (ServiceUnavailable): a known dependency outage, answered 503, not an unexpected failure. */
export function objectStoreUnavailable(error: RawValue): boolean {
	return error instanceof Error && /\b10043\b/.test(error.message);
}
