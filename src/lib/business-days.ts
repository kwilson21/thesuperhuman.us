const zone = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayMs = 86_400_000;
const key = (date: Date) => date.toISOString().slice(0, 10);

function holidays(year: number): Set<string> {
  const dates = new Set<string>();
  const fixed = (y: number, month: number, day: number) => {
    const date = new Date(Date.UTC(y, month - 1, day));
    dates.add(key(date));
    if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1);
    else if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
    dates.add(key(date));
  };
  // Adjacent years cover observed New Year's Day across a year boundary.
  for (const y of [year - 1, year, year + 1]) {
    for (const [month, day] of [[1, 1], [6, 19], [7, 4], [11, 11], [12, 25]]) fixed(y, month, day);
  }
  for (const [month, weekday, occurrence] of [[1, 1, 3], [2, 1, 3], [9, 1, 1], [10, 1, 2], [11, 4, 4]]) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    dates.add(key(new Date(Date.UTC(year, month - 1, 1 + (weekday - first.getUTCDay() + 7) % 7 + 7 * (occurrence - 1)))));
  }
  const memorial = new Date(Date.UTC(year, 5, 0));
  memorial.setUTCDate(memorial.getUTCDate() - (memorial.getUTCDay() + 6) % 7);
  dates.add(key(memorial));
  return dates;
}

/** Return the New York calendar date after n Business Days; the starting day is excluded. */
export function addBusinessDays(fromIso: string, n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('Use a nonnegative whole number of Business Days.');
  const instant = new Date(fromIso.length === 10 ? `${fromIso}T12:00:00Z` : fromIso);
  if (!Number.isFinite(instant.getTime())) throw new RangeError('Use a valid ISO date.');
  const parts = zone.formatToParts(instant);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  const date = new Date(`${part('year')}-${part('month')}-${part('day')}T12:00:00Z`);
  let year = date.getUTCFullYear(), excluded = holidays(year);
  while (n > 0) {
    date.setTime(date.getTime() + dayMs);
    if (date.getUTCFullYear() !== year) { year = date.getUTCFullYear(); excluded = holidays(year); }
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6 && !excluded.has(key(date))) n--;
  }
  return key(date);
}
