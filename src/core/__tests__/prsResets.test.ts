import { describe, it, expect } from 'vitest';
import { computePrTimeline, computePrTimelineWithResets, type DatedEffort } from '../prs.ts';
import { epley } from '../e1rm.ts';

/** A dated effort, terse. */
const e = (weight: number, reps: number, at: string, ref?: string): DatedEffort => ({
  weight,
  reps,
  at,
  ...(ref === undefined ? {} : { ref }),
});

// A representative spread: rising PRs, an equal effort, a regression, and two
// efforts with no valid e1RM.
const FIXTURE: DatedEffort[] = [
  e(200, 5, '2026-01-01T10:00:00.000Z', 'a'), // 233.3 — first, PR
  e(200, 5, '2026-01-08T10:00:00.000Z', 'b'), // equal → not a PR
  e(205, 5, '2026-01-15T10:00:00.000Z', 'c'), // 239.2 — PR
  e(200, 0, '2026-01-22T10:00:00.000Z', 'd'), // invalid → never a PR
  e(200, 3, '2026-01-29T10:00:00.000Z', 'f'), // 220 — below the max
  e(200, 8, '2026-02-05T10:00:00.000Z', 'g'), // 253.3 — PR
];

describe('computePrTimelineWithResets — equivalence', () => {
  it('with NO resets is behaviour-identical to computePrTimeline', () => {
    const withResets = computePrTimelineWithResets(FIXTURE, []);
    const classic = computePrTimeline(
      FIXTURE.map(({ weight, reps, ref }) => ({ weight, reps, ref })),
    );
    expect(withResets).toEqual(classic);
  });

  it('flags the same PRs as the classic timeline on the fixture', () => {
    const flags = computePrTimelineWithResets(FIXTURE, []).map((t) => t.isPr);
    expect(flags).toEqual([true, false, true, false, false, true]);
  });

  it('carries weight, reps, ref and e1rm through unchanged', () => {
    const out = computePrTimelineWithResets(FIXTURE, []);
    expect(out.map((t) => t.ref)).toEqual(['a', 'b', 'c', 'd', 'f', 'g']);
    expect(out[0]!.e1rm).toBe(epley(200, 5));
    expect(out[3]!.e1rm).toBeNull();
  });
});

describe('computePrTimelineWithResets — epochs', () => {
  it('restarts the record after a reset: a WEAKER effort is a PR again', () => {
    const efforts = [
      e(300, 5, '2026-01-01T10:00:00.000Z', 'big'), // 350
      e(100, 5, '2026-03-01T10:00:00.000Z', 'small'), // 116.7 — normally not a PR
    ];
    const noReset = computePrTimelineWithResets(efforts, []);
    expect(noReset.map((t) => t.isPr)).toEqual([true, false]);

    const reset = computePrTimelineWithResets(efforts, ['2026-02-01T00:00:00.000Z']);
    expect(reset.map((t) => t.isPr)).toEqual([true, true]);
  });

  it('preserves the badges earned BEFORE the reset', () => {
    const efforts = [
      e(200, 5, '2026-01-01T10:00:00.000Z', 'a'), // PR
      e(205, 5, '2026-01-08T10:00:00.000Z', 'b'), // PR
      e(200, 3, '2026-01-15T10:00:00.000Z', 'c'), // not a PR
      e(100, 5, '2026-03-01T10:00:00.000Z', 'd'), // first of epoch 2 → PR
    ];
    const out = computePrTimelineWithResets(efforts, ['2026-02-01T00:00:00.000Z']);
    expect(out.map((t) => t.isPr)).toEqual([true, true, false, true]);
    // The pre-reset entries are untouched by the later epoch.
    expect(out.slice(0, 3)).toEqual(computePrTimelineWithResets(efforts.slice(0, 3), []));
  });

  it('only the FIRST effort of the new epoch restarts — the rest compete normally', () => {
    const efforts = [
      e(300, 5, '2026-01-01T10:00:00.000Z'), // 350
      e(100, 5, '2026-03-01T10:00:00.000Z'), // 116.7 — epoch 2 PR
      e(95, 5, '2026-03-08T10:00:00.000Z'), // 110.8 — below the epoch max
      e(105, 5, '2026-03-15T10:00:00.000Z'), // 122.5 — epoch 2 PR
    ];
    const out = computePrTimelineWithResets(efforts, ['2026-02-01T00:00:00.000Z']);
    expect(out.map((t) => t.isPr)).toEqual([true, true, false, true]);
  });

  it('handles MULTIPLE resets — every epoch restarts independently', () => {
    const efforts = [
      e(300, 5, '2026-01-01T10:00:00.000Z'), // epoch 1 → PR
      e(200, 5, '2026-03-01T10:00:00.000Z'), // epoch 2 → PR
      e(150, 5, '2026-03-10T10:00:00.000Z'), // epoch 2, weaker → no
      e(100, 5, '2026-05-01T10:00:00.000Z'), // epoch 3 → PR
      e(120, 5, '2026-05-10T10:00:00.000Z'), // epoch 3, stronger → PR
    ];
    const out = computePrTimelineWithResets(efforts, [
      '2026-02-01T00:00:00.000Z',
      '2026-04-01T00:00:00.000Z',
    ]);
    expect(out.map((t) => t.isPr)).toEqual([true, true, false, true, true]);
  });

  it('collapses two resets with no effort between them (switching twice)', () => {
    const efforts = [e(300, 5, '2026-01-01T10:00:00.000Z'), e(100, 5, '2026-05-01T10:00:00.000Z')];
    const out = computePrTimelineWithResets(efforts, [
      '2026-02-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
    ]);
    expect(out.map((t) => t.isPr)).toEqual([true, true]);
  });

  it('BOUNDARY: an effort exactly at the reset timestamp is in the NEW epoch', () => {
    const at = '2026-02-01T00:00:00.000Z';
    const efforts = [e(300, 5, '2026-01-01T10:00:00.000Z'), e(100, 5, at)];
    expect(computePrTimelineWithResets(efforts, [at]).map((t) => t.isPr)).toEqual([true, true]);
  });

  it('a reset AFTER every effort changes nothing', () => {
    const out = computePrTimelineWithResets(FIXTURE, ['2027-01-01T00:00:00.000Z']);
    expect(out).toEqual(computePrTimelineWithResets(FIXTURE, []));
  });

  it('a reset BEFORE every effort changes nothing (the first effort was a PR anyway)', () => {
    const out = computePrTimelineWithResets(FIXTURE, ['2020-01-01T00:00:00.000Z']);
    expect(out).toEqual(computePrTimelineWithResets(FIXTURE, []));
  });

  it('accepts unsorted resets (sorts a local copy, input untouched)', () => {
    const efforts = [
      e(300, 5, '2026-01-01T10:00:00.000Z'),
      e(200, 5, '2026-03-01T10:00:00.000Z'),
      e(100, 5, '2026-05-01T10:00:00.000Z'),
    ];
    const resets = ['2026-04-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'];
    const out = computePrTimelineWithResets(efforts, resets);
    expect(out.map((t) => t.isPr)).toEqual([true, true, true]);
    expect(resets).toEqual(['2026-04-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z']);
  });

  it('an invalid effort neither PRs nor resets the epoch max', () => {
    const efforts = [
      e(300, 5, '2026-01-01T10:00:00.000Z'), // 350 — PR
      e(300, 0, '2026-03-01T10:00:00.000Z'), // invalid, in the new epoch
      e(100, 5, '2026-03-02T10:00:00.000Z'), // 116.7 — first VALID of the epoch → PR
    ];
    const out = computePrTimelineWithResets(efforts, ['2026-02-01T00:00:00.000Z']);
    expect(out.map((t) => t.isPr)).toEqual([true, false, true]);
    expect(out[1]!.e1rm).toBeNull();
  });

  it('handles an empty effort list', () => {
    expect(computePrTimelineWithResets([], ['2026-02-01T00:00:00.000Z'])).toEqual([]);
  });

  it('does not mutate the efforts it is given', () => {
    const efforts = [e(200, 5, '2026-01-01T10:00:00.000Z', 'a')];
    const snapshot = JSON.parse(JSON.stringify(efforts)) as unknown;
    computePrTimelineWithResets(efforts, ['2026-02-01T00:00:00.000Z']);
    expect(efforts).toEqual(snapshot);
  });
});
