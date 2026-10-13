export type DiffRow = { kind: 'removed' | 'added'; text: string } | { kind: 'unchanged'; count: number };

export const unchangedLabel = (count: number) => `${count} unchanged line${count === 1 ? '' : 's'}`;

const maxTableCells = 4_000_000;

const splitLines = (text: string) => {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (normalized === '') return [];
  return (normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized).split('\n');
};

/** Index pairs of lines kept by a longest common subsequence; empty above the table cap (everything changes). */
function matchedPairs(a: string[], b: string[]): [number, number][] {
  const n = a.length, m = b.length;
  if (n * m > maxTableCells) return [];
  // table[at(i, j)] is the LCS length of a[i..] and b[j..]. Under the cap the LCS is at most 2000, so Uint16 is exact.
  const table = new Uint16Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[at(i, j)] = a[i] === b[j] ? table[at(i + 1, j + 1)] + 1 : Math.max(table[at(i + 1, j)], table[at(i, j + 1)]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) i++;
    else j++;
  }
  return pairs;
}

/** Line diff in order: unchanged runs collapse to counts, and each changed region lists removed lines before added lines. */
export function lineDiff(before: string, after: string): DiffRow[] {
  const a = splitLines(before), b = splitLines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let endA = a.length, endB = b.length;
  while (endA > head && endB > head && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const midA = a.slice(head, endA), midB = b.slice(head, endB);
  const rows: DiffRow[] = [];
  const keep = (count: number) => {
    if (count === 0) return;
    const last = rows.at(-1);
    if (last?.kind === 'unchanged') last.count += count;
    else rows.push({ kind: 'unchanged', count });
  };
  let i = 0, j = 0;
  const change = (toA: number, toB: number) => {
    for (; i < toA; i++) rows.push({ kind: 'removed', text: midA[i] });
    for (; j < toB; j++) rows.push({ kind: 'added', text: midB[j] });
  };
  keep(head);
  for (const [pa, pb] of matchedPairs(midA, midB)) {
    change(pa, pb);
    keep(1);
    i++; j++;
  }
  change(midA.length, midB.length);
  keep(a.length - endA);
  return rows;
}
