// What the browser shows of a software project: evidence labels and the date format. Pure, with no server imports,
// because the composer script imports it.

export const evidenceTypes = {
	concept: "Concept",
	prototype: "Prototype",
	working_preview: "Working preview",
	demonstration: "Demonstration",
	investigation: "Investigation",
	handoff: "Handoff",
} as const;

export const softwareDate = (value: string) =>
	new Date(
		value.length === 10 ? `${value}T12:00:00Z` : value,
	).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		timeZone: "America/New_York",
	});
