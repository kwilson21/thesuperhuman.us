// The project calendar date helpers several areas share: whether a YYYY-MM-DD date is real, and today's date in the
// studio's time zone. Pure, so an area can use them without loading src/lib/audio-project-updates.ts (audio project
// storage and mail).

export function validProjectDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T12:00:00Z`);

	return (
		!Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
	);
}

export function projectToday(now = new Date()): string {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "America/New_York",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);

	const number = (type: string) =>
		parts.find((part) => part.type === type)?.value ?? "";

	return `${number("year")}-${number("month")}-${number("day")}`;
}
