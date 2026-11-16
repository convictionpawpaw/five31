import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REPS,
  MAX_HOLD_FACTOR,
  MAX_HOLD_SEC,
  MIN_HOLD_SEC,
  NECK_MAX_HOLD_SEC,
  TOLERANCE_SEC,
  WELL_ROUNDED_CORE,
  clampReps,
  generateRoutine,
  holdCap,
  routineSeconds,
} from '../generator.ts';
import { STRETCHES, getStretch } from '../library.ts';
import {
  BODY_AREAS,
  FLOOR_POSTURE_ORDER,
  POSITION_ORDER,
  type BodyArea,
  type Reps,
  type Routine,
} from '../types.ts';

/** Heavy property tests: thousands of routines each. */
const HEAVY = { timeout: 120_000 };

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 3);
const MINUTES = [5, 6, 7, 8, 9, 10];
const OWNER: BodyArea[] = ['neck', 'upperBack', 'lowerBack', 'chest'];
const SETS: BodyArea[][] = [
  [],
  OWNER,
  ['neck'],
  ['upperBack'],
  ['lowerBack'],
  ['hips', 'hamstrings'],
  ['chest', 'shoulders'],
  ['calves'],
  ['wristsForearms'],
  [...BODY_AREAS],
];
const REPS: Reps[] = [1, 2, 3];

/**
 * Planned length tolerance at 2x / 3x. Every rep of a stretch shares one
 * hold, so the final whole-second nudge moves in steps of 2 to 6 seconds and
 * can miss by a few. Measured max over 1000 seeds x 5..10 min x these sets
 * and a third of all focus subsets: 4 s (contract: TOLERANCE_SEC).
 */
const REPS_OFF_SEC = 5;

function stretchOf(id: string) {
  const s = getStretch(id);
  if (!s) throw new Error(`unknown stretch ${id}`);
  return s;
}

interface Case {
  r: Routine;
  reps: Reps;
  label: string;
}
let cache: Case[] | null = null;
function cases(): Case[] {
  if (cache) return cache;
  cache = [];
  for (const reps of REPS) {
    for (const focusAreas of SETS) {
      for (const minutes of MINUTES) {
        for (const seed of SEEDS) {
          cache.push({
            r: generateRoutine({ minutes, focusAreas, seed, reps }),
            reps,
            label: `reps=${reps} focus=[${focusAreas.join(',')}] min=${minutes} seed=${seed}`,
          });
        }
      }
    }
  }
  return cache;
}

function expectAll(check: (c: Case) => string | null) {
  const bad: string[] = [];
  for (const c of cases()) {
    const msg = check(c);
    if (msg !== null) bad.push(`${c.label}: ${msg}`);
  }
  expect(bad.slice(0, 10)).toEqual([]);
}

/** Distinct stretch ids in order, with how many reps each got. */
function runs(r: Routine): { id: string; repOf: number }[] {
  const out: { id: string; repOf: number }[] = [];
  for (const st of r.steps) {
    if (out.at(-1)?.id === st.stretchId) continue;
    out.push({ id: st.stretchId, repOf: st.repOf ?? 1 });
  }
  return out;
}

/** Share of distinct repeatable (non-continuous) stretches that got 2+ reps. */
function repeatedShare(r: Routine): number {
  const rs = runs(r).filter((x) => !stretchOf(x.id).continuous);
  if (rs.length === 0) return 1;
  return rs.filter((x) => x.repOf > 1).length / rs.length;
}

describe('generateRoutine reps: structure', () => {
  it('records the requested reps; defaults to 2; invalid values fall back to 2', () => {
    expect(DEFAULT_REPS).toBe(2);
    expect(generateRoutine({ minutes: 7, focusAreas: [], seed: 1 }).reps).toBe(2);
    for (const reps of REPS) {
      expect(generateRoutine({ minutes: 7, focusAreas: [], seed: 1, reps }).reps).toBe(reps);
    }
    for (const bad of [0, 4, 2.5, Number.NaN, '2', null, undefined]) {
      expect(clampReps(bad), String(bad)).toBe(2);
    }
  });

  it(
    'every rep of a stretch is adjacent: hold, hold / L, R, L, R; rep and repOf consistent',
    HEAVY,
    () => {
      expectAll(({ r, reps }) => {
        const seen = new Set<string>();
        let i = 0;
        while (i < r.steps.length) {
          const first = r.steps[i]!;
          const s = stretchOf(first.stretchId);
          if (seen.has(s.id)) return `${s.id} appears in two places`;
          seen.add(s.id);
          const repOf = first.repOf ?? 1;
          if (first.repOf !== undefined && first.repOf < 2) return `${s.id} repOf ${first.repOf}`;
          if (repOf > reps) return `${s.id} repOf ${repOf} > ${reps}`;
          if (s.continuous && repOf > 1) return `continuous ${s.id} repeated`;
          const sides = s.bilateral ? (['left', 'right'] as const) : [undefined];
          for (let rep = 1; rep <= repOf; rep++) {
            for (const side of sides) {
              const st = r.steps[i];
              if (!st || st.stretchId !== s.id) return `${s.id} run cut short at rep ${rep}`;
              if (st.side !== side) return `${s.id} rep ${rep} side ${st.side} (want ${side})`;
              if (
                repOf > 1
                  ? st.rep !== rep || st.repOf !== repOf
                  : st.rep !== undefined || st.repOf !== undefined
              )
                return `${s.id} rep fields ${st.rep}/${st.repOf} at rep ${rep}`;
              if (st.holdSec !== first.holdSec) return `${s.id} uneven holds across reps/sides`;
              i++;
            }
          }
        }
        return null;
      });
    },
  );

  it("reps = 1 carries no rep fields at all (today's routine shape)", () => {
    expectAll(({ r, reps }) => {
      if (reps !== 1) return null;
      return r.steps.some((st) => 'rep' in st || 'repOf' in st) ? 'rep field on a 1x step' : null;
    });
  });

  it('continuous movements (cat-cow) are never repeated', () => {
    const continuous = STRETCHES.filter((s) => s.continuous).map((s) => s.id);
    expect(continuous).toContain('cat-cow');
    let seen = 0;
    expectAll(({ r }) => {
      for (const x of runs(r)) {
        if (!continuous.includes(x.id)) continue;
        seen++;
        if (x.repOf !== 1) return `${x.id} x${x.repOf}`;
      }
      return null;
    });
    expect(seen).toBeGreaterThan(100);
  });

  it('is deterministic for a given seed and reps', () => {
    const a = generateRoutine({ minutes: 7, focusAreas: OWNER, seed: 42, reps: 2 });
    expect(generateRoutine({ minutes: 7, focusAreas: OWNER, seed: 42, reps: 2 })).toEqual(a);
  });
});

describe('generateRoutine reps: invariants at 1x, 2x and 3x', () => {
  it(`lands within ${REPS_OFF_SEC} s of the target (2 s at 1x)`, HEAVY, () => {
    expect(REPS_OFF_SEC).toBeLessThan(TOLERANCE_SEC);
    expectAll(({ r, reps }) => {
      if (r.totalSec !== routineSeconds(r.steps)) return 'totalSec mismatch';
      const off = Math.abs(r.totalSec - r.minutes * 60);
      return off <= (reps === 1 ? 2 : REPS_OFF_SEC) ? null : `off by ${off}s`;
    });
  });

  it('any focus subset: duration and hold caps hold at 2x and 3x', HEAVY, () => {
    const bad: string[] = [];
    for (const reps of [2, 3] as Reps[]) {
      for (let mask = 0; mask < 1 << BODY_AREAS.length; mask += 5) {
        const focusAreas = BODY_AREAS.filter((_, i) => mask & (1 << i));
        for (const minutes of MINUTES) {
          const seed = mask * 31 + minutes;
          const r = generateRoutine({ minutes, focusAreas, seed, reps });
          const label = `reps=${reps} [${focusAreas.join(',')}] ${minutes}m`;
          const off = Math.abs(r.totalSec - minutes * 60);
          if (off > REPS_OFF_SEC) bad.push(`${label}: off ${off}s`);
          for (const st of r.steps) {
            if (st.holdSec > holdCap(stretchOf(st.stretchId)) || st.holdSec < MIN_HOLD_SEC)
              bad.push(`${label}: ${st.stretchId} hold ${st.holdSec}`);
          }
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('caps every rep: >= 20 s, <= 1.25x authored, <= 45 s, neck-primary <= 30 s', () => {
    expectAll(({ r }) => {
      for (const st of r.steps) {
        const s = stretchOf(st.stretchId);
        const h = st.holdSec;
        if (h < MIN_HOLD_SEC) return `${s.id} hold ${h} < min`;
        if (h > MAX_HOLD_SEC) return `${s.id} hold ${h} > 45`;
        if (h > s.holdSec * MAX_HOLD_FACTOR) return `${s.id} hold ${h} > 1.25 x ${s.holdSec}`;
        if (s.areas[0] === 'neck' && h > NECK_MAX_HOLD_SEC) return `${s.id} neck hold ${h}`;
      }
      return null;
    });
  });

  it('keeps the standing -> seated -> kneeling -> floor order and the floor posture order', () => {
    expectAll(({ r }) => {
      const ranks = r.steps.map((st) => {
        const s = stretchOf(st.stretchId);
        const posture = s.posture ? FLOOR_POSTURE_ORDER.indexOf(s.posture) : 0;
        return POSITION_ORDER.indexOf(s.position) * 10 + posture;
      });
      for (let i = 1; i < ranks.length; i++) {
        if (ranks[i]! < ranks[i - 1]!) return `position/posture goes back at step ${i}`;
      }
      return null;
    });
  });
});

describe('generateRoutine reps: coverage first', () => {
  /** Areas that must each have a primary-area stretch (focus, or the well-rounded core). */
  const required = (focus: readonly BodyArea[]) => (focus.length ? focus : WELL_ROUNDED_CORE);

  function coverageCheck(focusAreas: BodyArea[], minutes: number, seed: number, reps: Reps) {
    const one = generateRoutine({ minutes, focusAreas, seed, reps: 1 });
    const r = generateRoutine({ minutes, focusAreas, seed, reps });
    if (JSON.stringify(r.droppedAreas) !== JSON.stringify(one.droppedAreas))
      return `dropped ${r.droppedAreas?.join(',')} vs 1x ${one.droppedAreas?.join(',')}`;
    const prim = new Set(runs(r).map((x) => stretchOf(x.id).areas[0]));
    for (const a of required(focusAreas)) {
      if (!(r.droppedAreas ?? []).includes(a) && !prim.has(a)) return `no primary ${a}`;
    }
    return null;
  }

  it('droppedAreas equal reps = 1 and every kept area has a primary stretch', HEAVY, () => {
    const bad: string[] = [];
    for (const reps of [2, 3] as Reps[]) {
      for (const focusAreas of SETS) {
        for (const minutes of MINUTES) {
          for (const seed of SEEDS) {
            const msg = coverageCheck(focusAreas, minutes, seed, reps);
            if (msg) bad.push(`reps=${reps} [${focusAreas.join(',')}] ${minutes}m ${seed}: ${msg}`);
          }
        }
      }
      for (let mask = 0; mask < 1 << BODY_AREAS.length; mask += 7) {
        const focusAreas = BODY_AREAS.filter((_, i) => mask & (1 << i));
        for (const minutes of [5, 7, 10]) {
          const msg = coverageCheck(focusAreas, minutes, mask + minutes, reps);
          if (msg) bad.push(`reps=${reps} [${focusAreas.join(',')}] ${minutes}m: ${msg}`);
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  // Measured over 1000 seeds per length (repeated share of the distinct,
  // non-continuous stretches, min / mean): 0.80 / 0.96 at 5 min, 0.80 / 0.97
  // at 6, 0.67 / 0.95 at 7, 0.71 / 0.96 at 8, 0.83 / 0.99 at 9, 1.00 / 1.00 at
  // 10. Distinct stretches: mean 5.2 (5 min) to 7.3 (10 min), vs 7.3 to 12.1
  // at 1x.
  it(
    '2x owner preset: most stretches are done twice, and fewer distinct stretches than 1x',
    HEAVY,
    () => {
      let sum = 0;
      let n = 0;
      for (const minutes of MINUTES) {
        let distinct2 = 0;
        let distinct1 = 0;
        for (let seed = 1; seed <= 200; seed++) {
          const r = generateRoutine({ minutes, focusAreas: OWNER, seed, reps: 2 });
          const share = repeatedShare(r);
          expect(share, `min=${minutes} seed=${seed}`).toBeGreaterThanOrEqual(0.6);
          sum += share;
          n++;
          distinct2 += runs(r).length;
          distinct1 += runs(generateRoutine({ minutes, focusAreas: OWNER, seed, reps: 1 })).length;
        }
        expect(distinct2, `min=${minutes}`).toBeLessThan(distinct1);
      }
      expect(sum / n).toBeGreaterThanOrEqual(0.93);
    },
  );

  it('2x well-rounded: the core six are covered and most stretches repeat', () => {
    for (const minutes of MINUTES) {
      let sum = 0;
      for (const seed of SEEDS) {
        const r = generateRoutine({ minutes, focusAreas: [], seed, reps: 2 });
        const prim = new Set(runs(r).map((x) => stretchOf(x.id).areas[0]));
        for (const a of WELL_ROUNDED_CORE)
          expect(prim.has(a), `${minutes}m ${seed} ${a}`).toBe(true);
        sum += repeatedShare(r);
      }
      // Measured means over 1000 seeds: 0.96-1.00 at every length (per
      // routine at least 0.78).
      expect(sum / SEEDS.length, `min=${minutes}`).toBeGreaterThanOrEqual(0.85);
    }
  });

  // Repeats go to the area with the fewest seconds first, and an area whose
  // only pick is a continuous movement gets a companion stretch instead of a
  // second rep, so the owner preset stays as level as at 1x (measured 2.0
  // over 1000 seeds x 5..10 min at 2x; 1.93 at 1x).
  it('2x owner preset keeps time level across its four areas (max/min <= 2)', HEAVY, () => {
    let worst = 0;
    let worstLabel = '';
    for (const minutes of MINUTES) {
      for (let seed = 1; seed <= 500; seed++) {
        const r = generateRoutine({ minutes, focusAreas: OWNER, seed, reps: 2 });
        const per = new Map<BodyArea, number>(OWNER.map((a) => [a, 0]));
        for (const st of r.steps) {
          const a = stretchOf(st.stretchId).areas.find((x) => per.has(x));
          if (a) per.set(a, per.get(a)! + st.holdSec);
        }
        const vals = [...per.values()];
        const ratio = Math.max(...vals) / Math.min(...vals);
        if (ratio > worst) {
          worst = ratio;
          worstLabel = `min=${minutes} seed=${seed} [${vals.join(',')}]`;
        }
      }
    }
    expect(worst, worstLabel).toBeLessThanOrEqual(2.0);
  });
});
