import { describe, it, expect } from 'vitest';

/** Heavy property tests: thousands of routines each. */
const HEAVY = { timeout: 60_000 };
import {
  COMPLEMENTS,
  FOCUS_SHARE,
  MAX_HOLD_FACTOR,
  MAX_HOLD_SEC,
  MIN_HOLD_SEC,
  NECK_MAX_HOLD_SEC,
  TOLERANCE_SEC,
  TRANSITION_SEC,
  WELL_ROUNDED_CORE,
  generateRoutine,
  holdCap,
  mulberry32,
  routineSeconds,
} from '../generator.ts';
import { STRETCHES, getStretch } from '../library.ts';
import {
  BODY_AREAS,
  FLOOR_POSTURE_ORDER,
  POSITION_ORDER,
  type BodyArea,
  type Routine,
} from '../types.ts';

const SEEDS = Array.from({ length: 60 }, (_, i) => i * 7919 + 1);
const MINUTES = [5, 6, 7, 8, 9, 10];
const OWNER: BodyArea[] = ['neck', 'upperBack', 'lowerBack', 'chest'];

/**
 * Focus sets the library is deep enough to give the full focus share at every
 * length. Neck alone is not one of them: neck-primary holds are capped at
 * 30 s, so all six neck stretches together hold at most 285 s and from 8
 * minutes the remaining time goes to complements (tested separately).
 */
const DEEP_SETS: BodyArea[][] = [
  ['upperBack'],
  ['lowerBack'],
  ['chest'],
  ['hips'],
  OWNER,
  ['hips', 'hamstrings'],
  ['chest', 'shoulders'],
  ['neck', 'chest'],
];
/** Narrow sets: few stretches exist, so the share can fall short without repeats. */
const NARROW_SETS: BodyArea[][] = [['calves'], ['wristsForearms'], ['quads']];
const ALL_AREAS: BodyArea[] = [...BODY_AREAS];
const ALL_SETS: BodyArea[][] = [[], ['neck'], ...DEEP_SETS, ...NARROW_SETS, ALL_AREAS];

/**
 * The suites below pin today's one-rep behaviour (reps defaults to 2 since the
 * Repeats feature); rep-specific properties are in generatorReps.test.ts.
 */
function gen(opts: Parameters<typeof generateRoutine>[0]): Routine {
  return generateRoutine({ reps: 1, ...opts });
}

function stretchOf(id: string) {
  const s = getStretch(id);
  if (!s) throw new Error(`unknown stretch ${id}`);
  return s;
}

function uniqueIds(r: Routine): string[] {
  return [...new Set(r.steps.map((st) => st.stretchId))];
}

/** Share of hold time in stretches that list ANY focus area. */
function focusShare(r: Routine): number {
  const focus = new Set(r.focusAreas);
  let inFocus = 0;
  let all = 0;
  for (const st of r.steps) {
    all += st.holdSec;
    if (stretchOf(st.stretchId).areas.some((a) => focus.has(a))) inFocus += st.holdSec;
  }
  return inFocus / all;
}

/** Share of hold time in stretches whose PRIMARY area is a focus area. */
function primaryShare(r: Routine): number {
  let p = 0;
  let all = 0;
  for (const st of r.steps) {
    all += st.holdSec;
    if (r.focusAreas.includes(stretchOf(st.stretchId).areas[0]!)) p += st.holdSec;
  }
  return p / all;
}

/** Hold seconds per focus area, attributing each step to the first focus area it lists. */
function perAreaSeconds(r: Routine, areas: readonly BodyArea[]): number[] {
  const per = new Map<BodyArea, number>(areas.map((a) => [a, 0]));
  for (const st of r.steps) {
    const a = stretchOf(st.stretchId).areas.find((x) => per.has(x));
    if (a) per.set(a, per.get(a)! + st.holdSec);
  }
  return [...per.values()];
}

interface Case {
  r: Routine;
  label: string;
}
let cache: Case[] | null = null;
/** Every (focus set x duration x seed) routine, generated once and shared. */
function cases(): Case[] {
  if (cache) return cache;
  cache = [];
  for (const focusAreas of ALL_SETS) {
    for (const minutes of MINUTES) {
      for (const seed of SEEDS) {
        const r = gen({ minutes, focusAreas, seed });
        cache.push({ r, label: `focus=[${focusAreas.join(',')}] min=${minutes} seed=${seed}` });
      }
    }
  }
  return cache;
}

/**
 * Run `check` over every case and assert no violations. Collecting messages
 * (rather than one expect per value) keeps thousands of cases fast.
 */
function expectAll(check: (r: Routine) => string | null) {
  const bad: string[] = [];
  for (const { r, label } of cases()) {
    const msg = check(r);
    if (msg !== null) bad.push(`${label}: ${msg}`);
  }
  expect(bad.slice(0, 10)).toEqual([]);
}

describe('generateRoutine: invariants across seeds, durations and focus sets', () => {
  it('lands within 30 s of the target (the contract), in practice within 2 s', HEAVY, () => {
    expect(TOLERANCE_SEC).toBe(30);
    expectAll((r) => {
      if (r.totalSec !== routineSeconds(r.steps)) return 'totalSec mismatch';
      const off = Math.abs(r.totalSec - r.minutes * 60);
      return off <= 2 ? null : `off by ${off}s`;
    });
  });

  // A third of all 2048 area subsets x every length (measured over all
  // subsets x 2 seeds: every routine within 1 s).
  it('lands within 2 s and respects hold caps for any focus subset', HEAVY, () => {
    const bad: string[] = [];
    for (let mask = 0; mask < 1 << BODY_AREAS.length; mask += 3) {
      const focusAreas = BODY_AREAS.filter((_, i) => mask & (1 << i));
      for (const minutes of MINUTES) {
        const seed = mask * 31 + minutes;
        const r = gen({ minutes, focusAreas, seed });
        const label = `[${focusAreas.join(',')}] ${minutes}m seed ${seed}`;
        const off = Math.abs(r.totalSec - minutes * 60);
        if (off > 2) bad.push(`${label}: off ${off}s`);
        for (const st of r.steps) {
          const s = stretchOf(st.stretchId);
          if (st.holdSec > holdCap(s) || st.holdSec < MIN_HOLD_SEC)
            bad.push(`${label}: ${s.id} hold ${st.holdSec}`);
        }
        for (const a of r.droppedAreas ?? []) {
          if (!focusAreas.includes(a)) bad.push(`${label}: dropped non-focus ${a}`);
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('never repeats a stretch, and bilateral stretches are left then right back to back', () => {
    expectAll((r) => {
      const seen = new Set<string>();
      for (let i = 0; i < r.steps.length;) {
        const st = r.steps[i]!;
        const s = stretchOf(st.stretchId);
        if (seen.has(s.id)) return `repeat ${s.id}`;
        seen.add(s.id);
        if (s.bilateral) {
          const next = r.steps[i + 1];
          if (st.side !== 'left') return `${s.id} first side ${st.side}`;
          if (next?.stretchId !== s.id || next.side !== 'right') return `${s.id} missing right`;
          if (next.holdSec !== st.holdSec) return `${s.id} uneven sides`;
          i += 2;
        } else {
          if (st.side !== undefined) return `${s.id} has a side`;
          i += 1;
        }
      }
      return null;
    });
  });

  it('caps holds: >= 20 s, <= 1.25x authored, <= 45 s, neck-primary <= 30 s', () => {
    expectAll((r) => {
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

  it('holdCap follows the rule for every library stretch', () => {
    for (const s of STRETCHES) {
      const cap = holdCap(s);
      expect(cap, s.id).toBeGreaterThanOrEqual(MIN_HOLD_SEC);
      expect(cap, s.id).toBeLessThanOrEqual(Math.max(MIN_HOLD_SEC, s.holdSec * MAX_HOLD_FACTOR));
      expect(cap, s.id).toBeLessThanOrEqual(MAX_HOLD_SEC);
      if (s.areas[0] === 'neck') expect(cap, s.id).toBeLessThanOrEqual(NECK_MAX_HOLD_SEC);
    }
    expect(holdCap(stretchOf('chin-tuck'))).toBe(25);
  });

  it('orders steps standing -> seated -> kneeling -> floor, the floor block by posture', () => {
    expectAll((r) => {
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

  it('is deterministic for a given seed and changes with the seed', () => {
    const a = gen({ minutes: 7, focusAreas: ['neck', 'chest'], seed: 42 });
    const b = gen({ minutes: 7, focusAreas: ['neck', 'chest'], seed: 42 });
    expect(b).toEqual(a);
    const variants = new Set(
      SEEDS.map((seed) => uniqueIds(gen({ minutes: 7, focusAreas: [], seed })).join()),
    );
    expect(variants.size).toBeGreaterThan(10);
  });

  it('clamps minutes into 5..10, and uses 7 when minutes is not a number', () => {
    expect(gen({ minutes: 2, focusAreas: [], seed: 1 }).minutes).toBe(5);
    expect(gen({ minutes: 25, focusAreas: [], seed: 1 }).minutes).toBe(10);
    expect(gen({ minutes: 7.4, focusAreas: [], seed: 1 }).minutes).toBe(7);
    expect(gen({ minutes: -3, focusAreas: [], seed: 1 }).minutes).toBe(5);
    expect(gen({ minutes: Infinity, focusAreas: [], seed: 1 }).minutes).toBe(10);
    expect(gen({ minutes: -Infinity, focusAreas: [], seed: 1 }).minutes).toBe(5);
    for (const bad of [Number.NaN, undefined, null, '8']) {
      const r = gen({ minutes: bad as unknown as number, focusAreas: [], seed: 1 });
      expect(r.minutes, String(bad)).toBe(7);
      expect(Math.abs(r.totalSec - 420), String(bad)).toBeLessThanOrEqual(2);
    }
  });

  it('reports the transition budget in the total', () => {
    const r = gen({ minutes: 5, focusAreas: [], seed: 3 });
    const holds = r.steps.reduce((n, st) => n + st.holdSec, 0);
    expect(r.totalSec).toBe(holds + TRANSITION_SEC * r.steps.length);
  });
});

describe('generateRoutine: focus', () => {
  // Counts any stretch that lists a focus area (see primary-share tests below).
  it(
    'gives roughly 75% of hold time to the focus areas (deep sets: measured 0.73-0.84)',
    HEAVY,
    () => {
      for (const focusAreas of DEEP_SETS) {
        for (const minutes of MINUTES) {
          for (const seed of SEEDS) {
            const r = gen({ minutes, focusAreas, seed });
            const share = focusShare(r);
            const label = `focus=[${focusAreas.join(',')}] min=${minutes} seed=${seed} share=${share}`;
            expect(share, label).toBeGreaterThanOrEqual(0.7);
            expect(share, label).toBeLessThanOrEqual(0.85);
          }
        }
      }
      expect(FOCUS_SHARE).toBe(0.75);
    },
  );

  // Neck-only: the 30 s neck cap limits all six neck stretches to 285 s, so
  // longer routines fill with complements (upper back, shoulders, chest)
  // instead of inflating neck holds. Measured: 0.74-0.82 at 5-7 min, 0.70 at
  // 8, ~0.62 at 9, ~0.55 at 10.
  it('neck-only focus keeps neck holds capped and still dominates', () => {
    for (const minutes of MINUTES) {
      for (const seed of SEEDS) {
        const r = gen({ minutes, focusAreas: ['neck'], seed });
        const label = `min=${minutes} seed=${seed}`;
        const neckSec = r.steps
          .filter((st) => stretchOf(st.stretchId).areas[0] === 'neck')
          .reduce((n, st) => n + st.holdSec, 0);
        expect(neckSec, label).toBeLessThanOrEqual(285);
        expect(focusShare(r), label).toBeGreaterThanOrEqual(minutes <= 7 ? 0.7 : 0.5);
        expect(focusShare(r), label).toBeLessThanOrEqual(0.85);
        const comp = r.steps.filter((st) => !stretchOf(st.stretchId).areas.includes('neck'));
        for (const st of comp) {
          expect(COMPLEMENTS.neck, `${label} ${st.stretchId}`).toContain(
            stretchOf(st.stretchId).areas[0],
          );
        }
      }
    }
  });

  it('narrow focus areas still dominate as far as the library allows', () => {
    for (const focusAreas of NARROW_SETS) {
      for (const minutes of MINUTES) {
        for (const seed of SEEDS) {
          const r = gen({ minutes, focusAreas, seed });
          const label = `focus=[${focusAreas.join(',')}] min=${minutes} seed=${seed}`;
          // Wrists at 10 min: 3 stretches at their caps are ~28% of the time.
          expect(focusShare(r), label).toBeGreaterThanOrEqual(0.25);
          expect(focusShare(r), label).toBeLessThanOrEqual(0.8);
        }
      }
    }
  });

  // Share of hold time in stretches whose PRIMARY area is focused. Measured
  // minimums over 300 seeds x 5..10 min: owner preset 0.73, neck 0.55,
  // lowerBack 0.56, chest 0.32, hips 0.33, hamstrings 0.70. Chest and hips
  // fall to about a third at 10 minutes because the library has only four
  // primary stretches for each; the rest of their 75% comes from stretches
  // that list them second (scalene, thoracic extension, figure-four, ...).
  // Quads, calves and wrists have only 2-3 primary stretches, so their
  // primary share can be ~0.28 (still the largest single area).
  it('primary-area share for the owner preset and single-area focus', HEAVY, () => {
    const bounds: [BodyArea[], number][] = [
      [OWNER, 0.7],
      [['neck'], 0.5],
      [['lowerBack'], 0.5],
      [['chest'], 0.3],
      [['hips'], 0.3],
      [['hamstrings'], 0.65],
      [['quads'], 0.25],
      [['calves'], 0.25],
      [['wristsForearms'], 0.25],
    ];
    for (const [focusAreas, min] of bounds) {
      for (const minutes of MINUTES) {
        for (const seed of SEEDS) {
          const r = gen({ minutes, focusAreas, seed });
          const label = `focus=[${focusAreas.join(',')}] min=${minutes} seed=${seed}`;
          expect(primaryShare(r), label).toBeGreaterThanOrEqual(min);
        }
      }
    }
  });

  // Balanced on actual scheduled seconds per area. Measured over these 18000
  // routines: max/min ratio 2.0, mean 1.05.
  it(
    'owner preset spreads time evenly across neck, upper back, lower back and chest',
    HEAVY,
    () => {
      let worst = 0;
      let worstLabel = '';
      for (const minutes of MINUTES) {
        for (let seed = 1; seed <= 3000; seed++) {
          const r = gen({ minutes, focusAreas: OWNER, seed });
          const vals = perAreaSeconds(r, OWNER);
          const ratio = Math.max(...vals) / Math.min(...vals);
          if (!(ratio <= worst)) {
            worst = ratio;
            worstLabel = `min=${minutes} seed=${seed} [${vals.join(',')}]`;
          }
        }
      }
      expect(worst, worstLabel).toBeLessThanOrEqual(2.0);
    },
  );

  it('spreads focus time across every focus area (other sets)', () => {
    const sets: BodyArea[][] = [
      ['hips', 'hamstrings'],
      ['chest', 'shoulders'],
      ['neck', 'chest'],
    ];
    for (const focusAreas of sets) {
      for (const minutes of MINUTES) {
        for (const seed of SEEDS) {
          const r = gen({ minutes, focusAreas, seed });
          const label = `focus=[${focusAreas.join(',')}] min=${minutes} seed=${seed}`;
          const vals = perAreaSeconds(r, focusAreas);
          expect(Math.min(...vals), label).toBeGreaterThan(0);
          expect(Math.max(...vals) / Math.min(...vals), label).toBeLessThanOrEqual(2.5);
        }
      }
    }
  });

  it('every focus area gets a primary-area stretch even when all of them are recent', () => {
    for (const area of BODY_AREAS) {
      const recent = STRETCHES.filter((s) => s.areas[0] === area).map((s) => s.id);
      for (const focusAreas of [[area], OWNER.includes(area) ? OWNER : [area, 'neck' as const]]) {
        for (const minutes of [5, 10]) {
          for (const seed of SEEDS.slice(0, 20)) {
            const r = gen({ minutes, focusAreas, seed, recentStretchIds: recent });
            const label = `${area} in [${focusAreas.join(',')}] min=${minutes} seed=${seed}`;
            expect(
              uniqueIds(r).some((id) => stretchOf(id).areas[0] === area),
              label,
            ).toBe(true);
          }
        }
      }
    }
  });

  it('complements for the owner preset are seeded and spread (none in > 50%)', HEAVY, () => {
    for (const minutes of MINUTES) {
      const counts = new Map<string, number>();
      for (let seed = 1; seed <= 500; seed++) {
        const r = gen({ minutes, focusAreas: OWNER, seed });
        for (const id of uniqueIds(r)) {
          const s = stretchOf(id);
          if (s.areas.some((a) => OWNER.includes(a))) continue;
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
      const label = `min=${minutes} ${JSON.stringify(Object.fromEntries(counts))}`;
      // Measured max: 42% (overhead-triceps at 9-10 min).
      expect(Math.max(...counts.values()) / 500, label).toBeLessThanOrEqual(0.5);
      const byArea = (a: BodyArea) =>
        [...counts.entries()]
          .filter(([id]) => stretchOf(id).areas[0] === a)
          .reduce((n, [, c]) => n + c, 0);
      expect(byArea('hamstrings'), label).toBeGreaterThan(0);
      expect(byArea('glutes'), label).toBeGreaterThan(0);
      expect(byArea('hips'), label).toBeGreaterThan(0);
    }
  });
});

describe('generateRoutine: many focus areas', () => {
  const SIX: BodyArea[][] = [
    ['neck', 'upperBack', 'lowerBack', 'chest', 'hips', 'hamstrings'],
    ['shoulders', 'glutes', 'quads', 'calves', 'wristsForearms', 'neck'],
    ['upperBack', 'lowerBack', 'hips', 'quads', 'calves', 'wristsForearms'],
  ];

  it('six areas: every area gets a primary stretch at 5, 7 and 10 minutes', () => {
    for (const focusAreas of SIX) {
      for (const minutes of [5, 7, 10]) {
        for (const seed of SEEDS) {
          const r = gen({ minutes, focusAreas, seed });
          const label = `[${focusAreas.join(',')}] min=${minutes} seed=${seed}`;
          expect(r.droppedAreas, label).toEqual([]);
          const prim = new Set(uniqueIds(r).map((id) => stretchOf(id).areas[0]));
          for (const a of focusAreas) expect(prim.has(a), `${label} ${a}`).toBe(true);
        }
      }
    }
  });

  it('all areas: nothing dropped at 7 and 10 minutes', () => {
    for (const minutes of [7, 10]) {
      for (const seed of SEEDS) {
        const r = gen({ minutes, focusAreas: ALL_AREAS, seed });
        expect(r.droppedAreas, `min=${minutes} seed=${seed}`).toEqual([]);
        const prim = new Set(uniqueIds(r).map((id) => stretchOf(id).areas[0]));
        for (const a of ALL_AREAS)
          expect(prim.has(a), `min=${minutes} seed=${seed} ${a}`).toBe(true);
      }
    }
  });

  // At 5 minutes one stretch per area cannot fit even at 20 s holds (the
  // cheapest set is 375 s), so the fewest possible areas are dropped, chosen
  // by seed among the costliest, and reported.
  it('all areas at 5 minutes: drops are minimal, seeded and reported', () => {
    const droppedSeen = new Set<string>();
    for (const seed of SEEDS) {
      const r = gen({ minutes: 5, focusAreas: ALL_AREAS, seed });
      const label = `seed=${seed}`;
      const dropped = r.droppedAreas ?? [];
      expect(dropped.length, label).toBeGreaterThan(0);
      expect(dropped.length, label).toBeLessThanOrEqual(2);
      for (const a of dropped) droppedSeen.add(a);
      const prim = new Set(uniqueIds(r).map((id) => stretchOf(id).areas[0]));
      for (const a of ALL_AREAS) {
        expect(prim.has(a), `${label} ${a} (dropped: ${dropped.join(',')})`).toBe(
          !dropped.includes(a),
        );
      }
      expect(Math.abs(r.totalSec - 300), label).toBeLessThanOrEqual(10);
    }
    // Not always the last areas in canonical order.
    expect(droppedSeen.size).toBeGreaterThanOrEqual(3);
  });

  it('droppedAreas is empty for ordinary routines', () => {
    expect(gen({ minutes: 7, focusAreas: OWNER, seed: 1 }).droppedAreas).toEqual([]);
    expect(gen({ minutes: 5, focusAreas: [], seed: 1 }).droppedAreas).toEqual([]);
  });
});

describe('generateRoutine: well-rounded', () => {
  it('always has a PRIMARY neck, upper back, lower back, chest, hips and hamstring stretch', () => {
    for (const minutes of MINUTES) {
      for (const seed of SEEDS) {
        const r = gen({ minutes, focusAreas: [], seed });
        const label = `min=${minutes} seed=${seed}`;
        const prim = new Set(uniqueIds(r).map((id) => stretchOf(id).areas[0]));
        for (const a of WELL_ROUNDED_CORE) expect(prim.has(a), `${label} missing ${a}`).toBe(true);
        expect(r.focusAreas).toEqual([]);
      }
    }
  });

  // Measured over 1000 seeds: each of quads / calves / wrists appears in
  // ~40% of 8-10 minute routines; shoulders and glutes ~35-45% at any length.
  it('quads, calves and wrists appear as seeded extras at 8-10 minutes only', () => {
    const seenLong = new Set<BodyArea>();
    for (const minutes of MINUTES) {
      for (const seed of SEEDS) {
        const r = gen({ minutes, focusAreas: [], seed });
        const prim = new Set(uniqueIds(r).map((id) => stretchOf(id).areas[0]!));
        for (const a of ['quads', 'calves', 'wristsForearms'] as const) {
          if (!prim.has(a)) continue;
          expect(minutes, `${a} at ${minutes} min seed ${seed}`).toBeGreaterThanOrEqual(8);
          seenLong.add(a);
        }
      }
    }
    expect([...seenLong].sort()).toEqual(['calves', 'quads', 'wristsForearms']);
  });
});

describe('generateRoutine: recent stretches', () => {
  it('avoids recently done stretches when equally relevant alternatives exist', () => {
    for (const minutes of [5, 7]) {
      for (const seed of SEEDS) {
        const first = gen({ minutes, focusAreas: [], seed });
        const recent = uniqueIds(first);
        const next = gen({
          minutes,
          focusAreas: [],
          seed: seed + 1,
          recentStretchIds: recent,
        });
        const overlap = uniqueIds(next).filter((id) => recent.includes(id));
        expect(overlap, `min=${minutes} seed=${seed}`).toEqual([]);
      }
    }
  });

  it('still produces a full routine when everything is recent', () => {
    const all = gen({ minutes: 10, focusAreas: [], seed: 9 });
    const r = gen({
      minutes: 10,
      focusAreas: [],
      seed: 9,
      recentStretchIds: uniqueIds(all),
    });
    expect(Math.abs(r.totalSec - 600)).toBeLessThanOrEqual(2);
  });
});

describe('mulberry32', () => {
  it('is deterministic and in [0, 1)', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
