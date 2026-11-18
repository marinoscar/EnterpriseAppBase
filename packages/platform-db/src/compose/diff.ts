// A tiny line diff for the `--check` report: shared prefix and suffix are
// trimmed, the middle is compared with a longest-common-subsequence table.
// Generated files are a few hundred lines and a stale file differs in one
// place, so this never gets large.

/**
 * Unified-style listing (`-` on disk, `+` expected) with up to two lines of context.
 *
 * @internal
 */
export function lineDiff(actual: string, expected: string, context = 2): string {
  const a = actual.split('\n');
  const b = expected.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const out: string[] = [];
  for (const line of a.slice(Math.max(0, start - context), start)) out.push(`  ${line}`);
  if (midA.length * midB.length > 4_000_000) {
    for (const line of midA) out.push(`- ${line}`);
    for (const line of midB) out.push(`+ ${line}`);
  } else {
    const lcs: number[][] = Array.from({ length: midA.length + 1 }, () => new Array<number>(midB.length + 1).fill(0));
    for (let i = midA.length - 1; i >= 0; i--) {
      for (let j = midB.length - 1; j >= 0; j--) {
        (lcs[i] as number[])[j] =
          midA[i] === midB[j]
            ? ((lcs[i + 1] as number[])[j + 1] as number) + 1
            : Math.max((lcs[i + 1] as number[])[j] as number, (lcs[i] as number[])[j + 1] as number);
      }
    }
    let i = 0;
    let j = 0;
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
        out.push(`  ${midA[i]}`);
        i++;
        j++;
      } else if (j < midB.length && (i === midA.length || ((lcs[i] as number[])[j + 1] as number) >= ((lcs[i + 1] as number[])[j] as number))) {
        out.push(`+ ${midB[j]}`);
        j++;
      } else {
        out.push(`- ${midA[i]}`);
        i++;
      }
    }
  }
  for (const line of a.slice(endA, endA + context)) out.push(`  ${line}`);
  return out.join('\n');
}
