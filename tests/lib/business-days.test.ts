import { describe, expect, it } from 'vitest';
import { addBusinessDays } from '../../src/lib/business-days';

describe('New York Business Days', () => {
  it.each([
    ['2025-12-31', '2026-01-02'], // New Year
    ['2026-01-16', '2026-01-20'], // third Monday in January
    ['2026-02-13', '2026-02-17'], // third Monday in February
    ['2026-05-22', '2026-05-26'], // last Monday in May
    ['2026-06-18', '2026-06-22'], // Juneteenth
    ['2026-07-02', '2026-07-06'], // Saturday Independence Day observed Friday
    ['2026-09-04', '2026-09-08'], // first Monday in September
    ['2026-10-09', '2026-10-13'], // second Monday in October
    ['2026-11-10', '2026-11-12'], // Veterans Day
    ['2026-11-25', '2026-11-27'], // fourth Thursday in November
    ['2026-12-24', '2026-12-28'], // Christmas
    ['2027-12-30', '2028-01-03'], // next year's New Year observed Friday
    ['2023-12-22', '2023-12-26'],
    ['2022-06-17', '2022-06-21'], // Sunday Juneteenth observed Monday
    ['2021-07-02', '2021-07-06'], // Sunday Independence Day
    ['2018-11-09', '2018-11-13'], // Sunday Veterans Day
    ['2022-12-23', '2022-12-27'], // Sunday Christmas
  ])('skips the holiday following %s', (from, expected) => expect(addBusinessDays(from, 1)).toBe(expected));
  it('spans Thanksgiving and weekends', () => expect(addBusinessDays('2026-11-23', 5)).toBe('2026-12-01'));
  it('uses New York dates across UTC midnight and DST', () => {
    expect(addBusinessDays('2026-10-06T01:00:00Z', 0)).toBe('2026-10-05');
    expect(addBusinessDays('2026-03-06T23:00:00Z', 1)).toBe('2026-03-09');
  });
  it('rejects invalid inputs', () => {
    for (const n of [-1, 0.5, Infinity]) expect(() => addBusinessDays('2026-01-01', n)).toThrow();
    expect(() => addBusinessDays('invalid', 1)).toThrow();
  });
});
