import { describe, expect, it } from 'vitest';

import { allocateMeterCells } from './segment-meter.js';

const sum = (values: readonly number[]): number => values.reduce((acc, value) => acc + value, 0);

/** A tiny deterministic generator so the property runs are reproducible. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

describe('allocateMeterCells', () => {
  it('splits proportionally and puts the unfilled share last', () => {
    expect(allocateMeterCells([50, 25], 100, 20)).toEqual([10, 5, 5]);
  });

  it('is all unfilled for an empty run', () => {
    expect(allocateMeterCells([0, 0], 0, 12)).toEqual([0, 0, 12]);
    expect(allocateMeterCells([0, 0], 40, 12)).toEqual([0, 0, 12]);
  });

  it('is all zeros when there is no width', () => {
    expect(allocateMeterCells([3, 1], 4, 0)).toEqual([0, 0, 0]);
  });

  it('keeps a single failure among thousands visible', () => {
    const cells = allocateMeterCells([9_999, 1], 10_000, 56);
    expect(cells[1]).toBeGreaterThanOrEqual(1);
    expect(sum(cells)).toBe(56);
  });

  it('treats negative and non-finite counts as zero and a short total as the sum', () => {
    expect(allocateMeterCells([-5, Number.NaN, 10], 4, 10)).toEqual([0, 0, 10, 0]);
  });

  it('drops the smallest categories when there are more than cells', () => {
    const cells = allocateMeterCells([1, 2, 3, 4, 5], 15, 3);
    expect(sum(cells)).toBe(3);
    expect(cells[4]).toBeGreaterThan(0);
  });

  it('property: sums to width and never drops a non-zero category when it fits', () => {
    const next = lcg(42);
    for (let run = 0; run < 2_000; run += 1) {
      const buckets = 1 + Math.floor(next() * 5);
      const counts = Array.from({ length: buckets }, () => (next() < 0.3 ? 0 : Math.floor(next() * next() * 5_000)));
      const filled = sum(counts);
      const total = filled + Math.floor(next() * 3 * (filled + 1)) * (next() < 0.5 ? 1 : 0);
      const width = 1 + Math.floor(next() * 80);

      const cells = allocateMeterCells(counts, total, width);

      expect(cells).toHaveLength(buckets + 1);
      expect(sum(cells)).toBe(width);
      expect(cells.every((cell) => Number.isInteger(cell) && cell >= 0)).toBe(true);

      const nonZero = counts.filter((count) => count > 0).length + (total > filled ? 1 : 0);
      if (nonZero <= width) {
        counts.forEach((count, index) => {
          if (count > 0) expect(cells[index], `counts=${counts} total=${total} width=${width}`).toBeGreaterThanOrEqual(1);
        });
        if (total > filled) expect(cells[buckets]).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
