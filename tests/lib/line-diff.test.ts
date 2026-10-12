import { describe, expect, it } from 'vitest';
import { lineDiff, unchangedLabel } from '~/lib/line-diff';

describe('line diff', () => {
  it('collapses identical text into one unchanged row', () => {
    expect(lineDiff('a\nb\nc', 'a\nb\nc')).toEqual([{ kind: 'unchanged', count: 3 }]);
  });

  it('reports one added line between unchanged rows', () => {
    expect(lineDiff('a\nc', 'a\nb\nc')).toEqual([
      { kind: 'unchanged', count: 1 },
      { kind: 'added', text: 'b' },
      { kind: 'unchanged', count: 1 },
    ]);
  });

  it('reports one removed line between unchanged rows', () => {
    expect(lineDiff('a\nb\nc', 'a\nc')).toEqual([
      { kind: 'unchanged', count: 1 },
      { kind: 'removed', text: 'b' },
      { kind: 'unchanged', count: 1 },
    ]);
  });

  it('lists a replaced line as removed then added', () => {
    expect(lineDiff('a\nold\nc', 'a\nnew\nc')).toEqual([
      { kind: 'unchanged', count: 1 },
      { kind: 'removed', text: 'old' },
      { kind: 'added', text: 'new' },
      { kind: 'unchanged', count: 1 },
    ]);
  });

  it('keeps the longest common subsequence and orders each changed region removed first', () => {
    expect(lineDiff('a\nb\nc\nd', 'a\nx\nc\ny\nd')).toEqual([
      { kind: 'unchanged', count: 1 },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'x' },
      { kind: 'unchanged', count: 1 },
      { kind: 'added', text: 'y' },
      { kind: 'unchanged', count: 1 },
    ]);
  });

  it('gives only added rows when before is empty', () => {
    expect(lineDiff('', 'a\nb')).toEqual([
      { kind: 'added', text: 'a' },
      { kind: 'added', text: 'b' },
    ]);
  });

  it('gives only removed rows when after is empty', () => {
    expect(lineDiff('a\nb', '')).toEqual([
      { kind: 'removed', text: 'a' },
      { kind: 'removed', text: 'b' },
    ]);
  });

  it('treats CRLF and CR line endings like LF', () => {
    expect(lineDiff('a\r\nold\r\nc', 'a\rnew\rc')).toEqual(lineDiff('a\nold\nc', 'a\nnew\nc'));
    expect(lineDiff('a\r\nb\r\n', 'a\nb\n')).toEqual([{ kind: 'unchanged', count: 2 }]);
  });

  it('does not add a row for a single trailing newline', () => {
    expect(lineDiff('a\nb', 'a\nb\n')).toEqual([{ kind: 'unchanged', count: 2 }]);
    expect(lineDiff('', '')).toEqual([]);
  });

  it('labels unchanged counts with correct singular and plural forms', () => {
    expect(unchangedLabel(1)).toBe('1 unchanged line');
    expect(unchangedLabel(3)).toBe('3 unchanged lines');
  });

  it('completes large fully different inputs by reporting every line', () => {
    const before = Array.from({ length: 3000 }, (_, i) => `old ${i}`).join('\n');
    const after = Array.from({ length: 3000 }, (_, i) => `new ${i}`).join('\n');
    const rows = lineDiff(before, after);
    expect(rows).toHaveLength(6000);
    expect(rows.filter(row => row.kind === 'removed')).toHaveLength(3000);
    expect(rows.filter(row => row.kind === 'added')).toHaveLength(3000);
  });
});
