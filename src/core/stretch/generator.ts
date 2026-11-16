import { STRETCHES } from './library.ts';
import {
  BODY_AREAS,
  FLOOR_POSTURE_ORDER,
  POSITION_ORDER,
  type BodyArea,
  type Reps,
  type Routine,
  type RoutineStep,
  type Stretch,
} from './types.ts';

/**
 * Routine generator. Pure and deterministic for a given seed.
 *
 * Model: a routine is a set of stretches, each held once (or once per side
 * when bilateral), with a fixed {@link TRANSITION_SEC} before every step (the
 * first one is the player's "get ready" lead-in). Planned length is therefore
 * sum(hold + TRANSITION_SEC) over steps.
 *
 * Holds: every hold is between {@link MIN_HOLD_SEC} and {@link holdCap}: at
 * most {@link MAX_HOLD_FACTOR} x the stretch's authored hold, never above
 * {@link MAX_HOLD_SEC}, and never above {@link NECK_MAX_HOLD_SEC} for a
 * stretch whose primary area is the neck. Time is filled by adding stretches,
 * not by inflating holds.
 *
 * How it works:
 *   1. Buckets. With focus areas there is one MAIN bucket per focus area
 *      (a stretch belongs to the first focus area it lists, so its primary
 *      area when that is focused) and one SECONDARY bucket of complements:
 *      stretches touching no focus area. Complement areas come from
 *      {@link COMPLEMENTS}; the secondary bucket draws them in a seeded,
 *      weighted, area-diverse order, then anything else that avoids the
 *      focus as a last resort. With no focus (well-rounded) the main buckets
 *      are {@link WELL_ROUNDED_CORE} (primary-area stretches only) and the
 *      secondary bucket holds seeded extras ({@link WELL_ROUNDED_EXTRAS}, plus
 *      {@link WELL_ROUNDED_LONG_EXTRAS} from {@link LONG_ROUTINE_MINUTES}).
 *   2. Candidate order inside a main bucket: primary-area stretches first
 *      (relevance), then stretches not done recently, then seeded jitter.
 *      Recency only breaks ties among equally relevant stretches, so every
 *      focus area always gets a primary-area stretch when one exists.
 *   3. Mandatory pass: one stretch per main bucket. If that is longer than
 *      the routine at nominal holds, bilateral picks are swapped for
 *      unilateral primary-area alternatives; if it still cannot fit at the
 *      minimum hold, areas are dropped (seeded choice among the costliest)
 *      and reported in {@link Routine.droppedAreas}.
 *   4. Fill: hold time H = target - transitions is split MAIN
 *      {@link FOCUS_SHARE} (evenly per area) / SECONDARY the rest. Stretches
 *      are added to the bucket furthest below its share (in nominal hold
 *      seconds) while that brings it closer, and always while the caps could
 *      not otherwise reach H.
 *   5. Holds: the shares are clamped to what each bucket can hold, focus
 *      areas are levelled on ACTUAL scheduled seconds, each bucket's time is
 *      spread over its stretches in proportion to their authored holds, then
 *      rounded and nudged so the total lands on the target (normally exact,
 *      at worst a few seconds off).
 *   6. Order by position (standing → seated → kneeling → floor), the floor
 *      block by posture (sitting → supine → side-lying → prone), then pick
 *      order; bilateral stretches emit left then right.
 *
 * Reps ({@link GenerateOptions.reps}, default 2): every rep of a stretch is
 * done back to back (unilateral: hold, hold; bilateral: L, R, L, R) at the
 * same hold, and the hold caps apply per rep. Coverage comes first: the
 * mandatory pass (3) picks one stretch per area as at reps = 1 (its
 * prefer-one-sided swap counts the planned reps, so at 2x/3x it may pick a
 * different stretch for the SAME area), and its drop pass always works at one
 * rep, so exactly the same areas are covered or dropped. During the fill (4), whenever another
 * rep of an already chosen stretch still fits at minimum holds it is added
 * BEFORE any new stretch: focus/core primary-area stretches first, then their
 * other main-bucket picks, then complements; among those, the stretch with
 * the fewest reps so far (so areas stay level), then seeded. A new stretch
 * enters with one rep and is offered its further reps on the next turns.
 * {@link Stretch.continuous} movements (cat-cow) never get a second rep. With
 * reps = 1 no rep is ever offered, so the output is today's routine exactly
 * (steps carry no rep fields).
 */

/** Seconds before every step (lead-in for the first, transition otherwise). */
export const TRANSITION_SEC = 5;
export const MIN_HOLD_SEC = 20;
/** Absolute ceiling on any hold. */
export const MAX_HOLD_SEC = 45;
/** A hold never exceeds this multiple of the stretch's authored hold. */
export const MAX_HOLD_FACTOR = 1.25;
/** Ceiling for any stretch whose PRIMARY area is the neck. */
export const NECK_MAX_HOLD_SEC = 30;
/** Share of hold time given to focus areas when any are selected. */
export const FOCUS_SHARE = 0.75;
/**
 * Planned length is always within this many seconds of the target (the
 * contract; in practice the generator lands within a few seconds).
 */
export const TOLERANCE_SEC = 30;
export const MIN_MINUTES = 5;
export const MAX_MINUTES = 10;
/** Used when the requested minutes are missing or not a number. */
export const DEFAULT_MINUTES = 7;
/** The one-per-area mandatory set may run this far over at minimum holds. */
const MANDATORY_SLACK_SEC = 10;

/** Areas a well-rounded routine always covers with a PRIMARY-area stretch. */
export const WELL_ROUNDED_CORE: readonly BodyArea[] = [
  'neck',
  'upperBack',
  'lowerBack',
  'chest',
  'hips',
  'hamstrings',
];
/** Seeded extras for a well-rounded routine of any length. */
export const WELL_ROUNDED_EXTRAS: readonly BodyArea[] = ['shoulders', 'glutes'];
/** Extra extras once the routine is long enough. */
export const WELL_ROUNDED_LONG_EXTRAS: readonly BodyArea[] = ['quads', 'calves', 'wristsForearms'];
/** From this length well-rounded routines may include the long extras. */
export const LONG_ROUTINE_MINUTES = 8;
/** Share of hold time for the well-rounded core (short / long routines). */
const WELL_ROUNDED_CORE_SHARE = 0.85;
const WELL_ROUNDED_CORE_SHARE_LONG = 0.75;

/** Areas that pair naturally with each focus area, most relevant first. */
export const COMPLEMENTS: Record<BodyArea, readonly BodyArea[]> = {
  neck: ['upperBack', 'shoulders', 'chest'],
  upperBack: ['chest', 'neck', 'shoulders'],
  lowerBack: ['hips', 'hamstrings', 'glutes'],
  chest: ['upperBack', 'shoulders', 'neck'],
  shoulders: ['chest', 'upperBack', 'neck'],
  hips: ['glutes', 'lowerBack', 'quads'],
  glutes: ['hips', 'lowerBack', 'hamstrings'],
  hamstrings: ['calves', 'lowerBack', 'glutes'],
  quads: ['hips', 'calves'],
  calves: ['hamstrings', 'quads'],
  wristsForearms: ['shoulders', 'chest', 'neck'],
};
/** Relevance weight by position in a COMPLEMENTS list. */
const COMPLEMENT_RANK_WEIGHT = [1, 0.8, 0.6] as const;

export interface GenerateOptions {
  /** Target length in minutes; rounded and clamped to 5..10 (7 if not a number). */
  minutes: number;
  /** Areas to focus on; empty for a well-rounded routine. */
  focusAreas: readonly BodyArea[];
  seed: number;
  /** Stretch ids done recently; avoided among equally relevant alternatives. */
  recentStretchIds?: readonly string[];
  /** Override the library (tests). */
  library?: readonly Stretch[];
  /** Reps per stretch, back to back; default {@link DEFAULT_REPS}. */
  reps?: Reps;
}

/** Reps used when none (or an invalid value) is requested. */
export const DEFAULT_REPS: Reps = 2;

/** Anything → a valid rep count (1, 2 or 3); otherwise {@link DEFAULT_REPS}. */
export function clampReps(reps: unknown): Reps {
  return reps === 1 || reps === 2 || reps === 3 ? reps : DEFAULT_REPS;
}

/** mulberry32: tiny, fast, well-distributed seeded PRNG returning [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Number of timed steps a stretch produces. */
export function stepCount(s: Stretch): number {
  return s.bilateral ? 2 : 1;
}

/** Longest hold the generator will ever give this stretch (per side). */
export function holdCap(s: Stretch): number {
  let cap = Math.min(MAX_HOLD_SEC, Math.floor(s.holdSec * MAX_HOLD_FACTOR));
  if (s.areas[0] === 'neck') cap = Math.min(cap, NECK_MAX_HOLD_SEC);
  return Math.max(MIN_HOLD_SEC, cap);
}

/** The authored hold, brought inside [MIN_HOLD_SEC, holdCap]. */
function nominalHold(s: Stretch): number {
  return Math.max(MIN_HOLD_SEC, Math.min(holdCap(s), s.holdSec));
}

/** Requested minutes → whole minutes in 5..10; NaN or non-numbers → 7. */
export function clampMinutes(minutes: unknown): number {
  if (typeof minutes !== 'number' || Number.isNaN(minutes)) return DEFAULT_MINUTES;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(minutes)));
}

/** Planned seconds of a list of steps (holds plus one transition each). */
export function routineSeconds(steps: readonly RoutineStep[]): number {
  return steps.reduce((sum, st) => sum + st.holdSec + TRANSITION_SEC, 0);
}

interface Bucket {
  /** Focus/core area for a main bucket; null for the secondary bucket. */
  area: BodyArea | null;
  /** Candidates, best first. */
  order: Stretch[];
  /** Relevance tier per candidate id (0 = primary-area match). */
  tier: Map<string, number>;
  chosen: Stretch[];
  /** No room for even one stretch (main buckets only). */
  dropped: boolean;
  /** Seeded tie-break between buckets. */
  rand: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Generate a routine. See the module doc for the rules. Deterministic: the
 * same options always yield the same routine.
 */
export function generateRoutine(opts: GenerateOptions): Routine {
  const library = opts.library ?? STRETCHES;
  const minutes = clampMinutes(opts.minutes);
  const target = minutes * 60;
  const requested: readonly BodyArea[] = Array.isArray(opts.focusAreas) ? opts.focusAreas : [];
  const focus = BODY_AREAS.filter((a) => requested.includes(a));
  const focusSet = new Set<BodyArea>(focus);
  const recent = new Set(opts.recentStretchIds ?? []);
  const seed = Number.isFinite(opts.seed) ? opts.seed : 0;
  const repsWanted = clampReps(opts.reps);

  // One jitter value per library stretch, drawn in library order, so the
  // random stream does not depend on the order picks happen in. Every other
  // seeded choice uses a second, independent stream.
  const rng = mulberry32(seed);
  const jitter = new Map<string, number>();
  for (const s of library) jitter.set(s.id, rng());
  const rng2 = mulberry32((seed ^ 0x9e3779b9) >>> 0);

  const isRecent = (s: Stretch) => (recent.has(s.id) ? 1 : 0);
  const byPreference = (a: Stretch, b: Stretch) =>
    isRecent(a) - isRecent(b) || (jitter.get(b.id) ?? 0) - (jitter.get(a.id) ?? 0);

  const tieredBucket = (area: BodyArea, cands: { s: Stretch; tier: number }[]): Bucket => {
    const sorted = [...cands].sort((x, y) => x.tier - y.tier || byPreference(x.s, y.s));
    return {
      area,
      order: sorted.map((c) => c.s),
      tier: new Map(sorted.map((c) => [c.s.id, c.tier])),
      chosen: [],
      dropped: false,
      rand: rng2(),
    };
  };

  /**
   * Secondary bucket: a seeded weighted permutation of `areas`, then
   * round-robin across them so picks spread over areas, stretches not done
   * recently first; `fallback` stretches only after every area is used up.
   */
  const mixedBucket = (
    areas: readonly { area: BodyArea; weight: number }[],
    pool: readonly Stretch[],
    fallback: readonly Stretch[],
  ): Bucket => {
    const left = areas.filter((a) => a.weight > 0);
    const perm: BodyArea[] = [];
    while (left.length > 0) {
      const total = left.reduce((n, a) => n + a.weight, 0);
      let x = rng2() * total;
      let i = 0;
      while (i < left.length - 1 && x >= left[i]!.weight) {
        x -= left[i]!.weight;
        i++;
      }
      perm.push(left.splice(i, 1)[0]!.area);
    }
    const lists = perm.map((a) => pool.filter((s) => s.areas[0] === a).sort(byPreference));
    const robin: Stretch[] = [];
    for (let r = 0; lists.some((l) => r < l.length); r++) {
      for (const l of lists) if (r < l.length) robin.push(l[r]!);
    }
    // Stable: non-recent first, round-robin order otherwise.
    const ordered = [
      ...robin.filter((s) => !recent.has(s.id)),
      ...robin.filter((s) => recent.has(s.id)),
      ...[...fallback].sort(byPreference),
    ];
    return {
      area: null,
      order: ordered,
      tier: new Map(ordered.map((s) => [s.id, 0])),
      chosen: [],
      dropped: false,
      rand: rng2(),
    };
  };

  // --- 1. Buckets -----------------------------------------------------------
  const main: Bucket[] = [];
  let secondary: Bucket;
  let mainShare: number;
  if (focus.length === 0) {
    for (const area of WELL_ROUNDED_CORE) {
      main.push(
        tieredBucket(
          area,
          library.filter((s) => s.areas[0] === area).map((s) => ({ s, tier: 0 })),
        ),
      );
    }
    const long = minutes >= LONG_ROUTINE_MINUTES;
    const extras = long
      ? [...WELL_ROUNDED_EXTRAS, ...WELL_ROUNDED_LONG_EXTRAS]
      : WELL_ROUNDED_EXTRAS;
    secondary = mixedBucket(
      extras.map((area) => ({ area, weight: 1 })),
      library.filter((s) => extras.includes(s.areas[0]!)),
      [],
    );
    mainShare = long ? WELL_ROUNDED_CORE_SHARE_LONG : WELL_ROUNDED_CORE_SHARE;
  } else {
    const attribution = (s: Stretch) => s.areas.find((x) => focusSet.has(x));
    for (const area of focus) {
      main.push(
        tieredBucket(
          area,
          library
            .filter((s) => attribution(s) === area)
            .map((s) => ({ s, tier: s.areas[0] === area ? 0 : 1 })),
        ),
      );
    }
    const avoidsFocus = library.filter((s) => attribution(s) === undefined);
    // Complement relevance: best rank any focus area gives it, times how many
    // eligible stretches it has, so picks spread over stretches rather than
    // piling onto the one stretch of a thin area.
    const weights: { area: BodyArea; weight: number }[] = [];
    for (const area of BODY_AREAS) {
      if (focusSet.has(area)) continue;
      let rel = 0;
      for (const f of focus) {
        const i = COMPLEMENTS[f].indexOf(area);
        if (i >= 0) rel = Math.max(rel, COMPLEMENT_RANK_WEIGHT[i] ?? 0.5);
      }
      const n = avoidsFocus.filter((s) => s.areas[0] === area).length;
      if (rel > 0 && n > 0) weights.push({ area, weight: rel * n });
    }
    const compAreas = new Set(weights.map((w) => w.area));
    secondary = mixedBucket(
      weights,
      avoidsFocus.filter((s) => compAreas.has(s.areas[0]!)),
      avoidsFocus.filter((s) => !compAreas.has(s.areas[0]!)),
    );
    mainShare = FOCUS_SHARE;
  }
  const buckets = [...main, secondary];

  const used = new Set<string>();
  let pickCounter = 0;
  const pickIndex = new Map<string, number>();
  /** Reps per chosen stretch (1 until the fill adds more). */
  const repsOf = new Map<string, number>();
  const choose = (b: Bucket, s: Stretch) => {
    b.chosen.push(s);
    used.add(s.id);
    pickIndex.set(s.id, pickCounter++);
    repsOf.set(s.id, 1);
  };
  /** Timed steps a chosen stretch produces: sides x reps. */
  const stepsOf = (s: Stretch) => stepCount(s) * (repsOf.get(s.id) ?? 1);
  const next = (b: Bucket): Stretch | undefined =>
    b.dropped ? undefined : b.order.find((s) => !used.has(s.id));

  const sumOver = (f: (s: Stretch) => number, bs: readonly Bucket[] = buckets) =>
    bs.reduce((n, b) => n + b.chosen.reduce((m, s) => m + f(s), 0), 0);
  const steps = () => sumOver(stepsOf);
  const minHolds = (bs?: readonly Bucket[]) => sumOver((s) => stepsOf(s) * MIN_HOLD_SEC, bs);
  const maxHolds = (bs?: readonly Bucket[]) => sumOver((s) => stepsOf(s) * holdCap(s), bs);
  const nomHolds = (bs?: readonly Bucket[]) => sumOver((s) => stepsOf(s) * nominalHold(s), bs);
  // Every rep of a stretch shares its hold, so a stretch costs steps x (hold + transition).
  const cost = (s: Stretch, hold: number) => stepsOf(s) * (hold + TRANSITION_SEC);

  // --- 2. Mandatory pass: one stretch per main bucket -------------------------
  for (const b of main) {
    const first = b.order[0];
    if (first) choose(b, first);
    else b.dropped = true; // nothing in the library for this area
  }
  const live = () => main.filter((b) => !b.dropped);
  const pickOf = (b: Bucket) => b.chosen[0]!;
  const unilateralAlt = (b: Bucket, allowRecent: boolean) => {
    const cur = pickOf(b);
    const tier = b.tier.get(cur.id);
    return b.order.find(
      (s) =>
        s !== cur &&
        !s.bilateral &&
        b.tier.get(s.id) === tier &&
        (allowRecent || !recent.has(s.id) || recent.has(cur.id)),
    );
  };
  const swap = (b: Bucket, s: Stretch) => {
    used.delete(pickOf(b).id);
    b.chosen = [];
    choose(b, s);
  };
  const byCostThenRand = (hold: (s: Stretch) => number) => (x: Bucket, y: Bucket) =>
    cost(pickOf(y), hold(pickOf(y))) - cost(pickOf(x), hold(pickOf(x))) || x.rand - y.rand;

  // Too long at nominal holds (counting the reps each pick is meant to get):
  // prefer shorter (unilateral) primary picks. Same areas, so coverage and
  // the drop pass below (always at one rep) are unchanged by reps.
  const plannedReps = (s: Stretch) => (s.continuous ? 1 : repsWanted);
  for (;;) {
    const total = live().reduce(
      (n, b) => n + plannedReps(pickOf(b)) * cost(pickOf(b), nominalHold(pickOf(b))),
      0,
    );
    if (total <= target) break;
    const cands = live()
      .filter((b) => pickOf(b).bilateral && unilateralAlt(b, false))
      .sort(byCostThenRand(nominalHold));
    if (cands.length === 0) break;
    swap(cands[0]!, unilateralAlt(cands[0]!, false)!);
  }
  // Too long even at minimum holds: swap regardless of recency, then drop.
  for (;;) {
    const total = live().reduce((n, b) => n + cost(pickOf(b), MIN_HOLD_SEC), 0);
    if (total <= target + MANDATORY_SLACK_SEC) break;
    const swappable = live()
      .filter((b) => pickOf(b).bilateral && unilateralAlt(b, true))
      .sort(byCostThenRand(() => MIN_HOLD_SEC));
    if (swappable.length > 0) {
      swap(swappable[0]!, unilateralAlt(swappable[0]!, true)!);
      continue;
    }
    // Drop a seeded choice among the costliest areas (fewest drops overall).
    const lv = live();
    const worst = Math.max(...lv.map((b) => cost(pickOf(b), MIN_HOLD_SEC)));
    const ties = lv.filter((b) => cost(pickOf(b), MIN_HOLD_SEC) === worst);
    const victim = ties[Math.floor(rng2() * ties.length)]!;
    used.delete(pickOf(victim).id);
    victim.chosen = [];
    victim.dropped = true;
  }

  // --- 3. Fill ------------------------------------------------------------------
  /** Hold-second share each bucket should get out of H. */
  const targets = (H: number): Map<Bucket, number> => {
    const m = live().filter((b) => b.chosen.length > 0 || next(b));
    const secOn = secondary.chosen.length > 0 || next(secondary) !== undefined;
    const share = secOn && m.length > 0 ? mainShare : m.length > 0 ? 1 : 0;
    const t = new Map<Bucket, number>();
    for (const b of m) t.set(b, (share * H) / m.length);
    t.set(secondary, (1 - share) * H);
    return t;
  };
  interface Option {
    b: Bucket;
    s: Stretch;
    /** Bucket share minus its nominal hold seconds. */
    deficit: number;
    /** Bucket share minus the most its stretches can hold (> 0: under capacity). */
    need: number;
    /** Nominal hold seconds the candidate adds. */
    size: number;
    /** Even at minimum holds the bucket would still be within its share. */
    fits: boolean;
    /** 0 for the bucket's preferred candidate, 1 for its unilateral alternative. */
    alt: number;
  }
  /** Prefer the candidate whose size best fits the gap, then the preferred one. */
  const byFit = (gap: (o: Option) => number) => (x: Option, y: Option) =>
    Math.abs(gap(x) - x.size) - Math.abs(gap(y) - y.size) || x.alt - y.alt;
  /** Main buckets whose continuous pick has already been given a companion. */
  const companioned = new Set<Bucket>();
  for (let guard = 0; guard < library.length * (repsWanted + 1) + 1; guard++) {
    const H = target - TRANSITION_SEC * steps();
    const t = targets(H);
    const minNow = minHolds();

    // Reps before new stretches: another rep of a chosen stretch whenever one
    // still fits at minimum holds. A continuous movement (cat-cow) never gets
    // one; if it is a focus/core area's pick, that area instead gets a
    // "companion": its next repeatable stretch, so it is not left behind.
    if (repsWanted > 1) {
      interface RepCand {
        b: Bucket;
        s: Stretch;
        /** 0: focus/core primary-area pick; 1: other main-bucket pick; 2: complement. */
        rank: number;
        r: number;
        /** The bucket's nominal hold seconds so far (lowest first keeps areas level). */
        area: number;
        /** Set when the action is choosing this companion rather than adding a rep. */
        companion?: Stretch;
      }
      const repCands: RepCand[] = [];
      const fitsSteps = (k: number) => minNow + k * MIN_HOLD_SEC <= H - k * TRANSITION_SEC;
      for (const b of buckets) {
        for (const s of b.chosen) {
          const r = repsOf.get(s.id) ?? 1;
          const rank = b.area === null ? 2 : b.tier.get(s.id) === 0 ? 0 : 1;
          if (s.continuous) {
            // Only when it is all the area has: otherwise the area already has
            // a repeatable stretch and is no worse off than any other.
            const alone = b.chosen.every((x) => x.continuous);
            if (b.area === null || !alone || companioned.has(b) || r >= repsWanted) continue;
            const tier = b.tier.get(s.id);
            const free = (x: Stretch) => !used.has(x.id) && !x.continuous;
            const sameTier = (x: Stretch) => free(x) && b.tier.get(x.id) === tier;
            // One-sided first: its reps then roughly match one rep of the others.
            const c =
              b.order.find((x) => sameTier(x) && !x.bilateral) ??
              b.order.find(sameTier) ??
              b.order.find(free);
            if (c && fitsSteps(stepCount(c))) {
              repCands.push({ b, s, rank, r, area: nomHolds([b]), companion: c });
            }
            continue;
          }
          if (r >= repsWanted || !fitsSteps(stepCount(s))) continue;
          repCands.push({ b, s, rank, r, area: nomHolds([b]) });
        }
      }
      if (repCands.length > 0) {
        repCands.sort(
          (x, y) =>
            x.rank - y.rank ||
            x.area - y.area ||
            x.r - y.r ||
            x.b.rand - y.b.rand ||
            (jitter.get(y.s.id) ?? 0) - (jitter.get(x.s.id) ?? 0),
        );
        const top = repCands[0]!;
        if (top.companion) {
          companioned.add(top.b);
          choose(top.b, top.companion);
        } else {
          repsOf.set(top.s.id, top.r + 1);
        }
        continue;
      }
    }
    const options: Option[] = [];
    for (const b of buckets) {
      const first = next(b);
      if (!first || !t.has(b)) continue;
      // The preferred candidate, plus (focus/core buckets only) the best
      // unilateral of the same tier: a short stretch often fits a small gap far
      // better than a two-sided one. The secondary bucket keeps its seeded
      // area-diverse order untouched so complements stay spread out.
      const cands = [first];
      if (first.bilateral && b.area !== null) {
        const tier = b.tier.get(first.id);
        const uni = b.order.find(
          (s) => !used.has(s.id) && !s.bilateral && b.tier.get(s.id) === tier,
        );
        if (uni) cands.push(uni);
      }
      const tb = t.get(b)!;
      cands.forEach((s, alt) => {
        const k = stepCount(s);
        if (minNow + k * MIN_HOLD_SEC > H - k * TRANSITION_SEC) return; // would overrun
        // A new stretch is sized at the reps it will get right after (it
        // enters with one and the rep pass adds the rest while they fit), so
        // the fill does not overfill a bucket and then squeeze every hold.
        const planned = k * (s.continuous ? 1 : repsWanted);
        options.push({
          b,
          s,
          deficit: tb - nomHolds([b]),
          need: tb - maxHolds([b]),
          size: planned * nominalHold(s),
          fits: minHolds([b]) + k * MIN_HOLD_SEC <= tb,
          alt,
        });
      });
    }
    /** The highest-scoring bucket among `opts`, then its best-fitting option. */
    const best = (opts: Option[], score: (o: Option) => number, gap: (o: Option) => number) => {
      if (opts.length === 0) return undefined;
      const top = Math.max(...opts.map(score));
      const b = opts.filter((o) => score(o) === top).sort((x, y) => x.b.rand - y.b.rand)[0]!.b;
      return opts.filter((o) => o.b === b).sort(byFit(gap))[0];
    };
    const need = (o: Option) => o.need;
    const deficit = (o: Option) => o.deficit;
    // An addition that would push a bucket past its share even at minimum
    // holds is only made when nothing else can fill the time.
    const fitting = options.filter((o) => o.fits);
    const pick =
      maxHolds() < H
        ? // The caps cannot fill the time: must add, to whoever is shortest of room.
          (best(fitting, need, need) ?? best(options, need, need))
        : // A focus/core area cannot reach its share even at the caps: give it
          // another stretch rather than overfilling the other areas. Otherwise
          // add to the bucket furthest below its share while that helps.
          (best(
            fitting.filter((o) => o.b.area !== null && o.need > 0),
            need,
            deficit,
          ) ??
          best(
            fitting.filter((o) => o.deficit >= 0.5 * o.size),
            deficit,
            deficit,
          ));
    if (!pick) break;
    choose(pick.b, pick.s);
  }

  // --- 4. Holds -------------------------------------------------------------------
  const H = target - TRANSITION_SEC * steps();
  const mainOn = live().filter((b) => b.chosen.length > 0);
  const lo = (bs: readonly Bucket[]) => minHolds(bs);
  const hi = (bs: readonly Bucket[]) => maxHolds(bs);
  let mainT: number;
  let secT = 0;
  if (secondary.chosen.length > 0 && mainOn.length > 0) {
    mainT = clamp(mainShare * H, lo(mainOn), hi(mainOn));
    secT = clamp(H - mainT, lo([secondary]), hi([secondary]));
    mainT = clamp(H - secT, lo(mainOn), hi(mainOn));
  } else if (mainOn.length > 0) {
    mainT = clamp(H, lo(mainOn), hi(mainOn));
  } else {
    mainT = 0;
    secT = clamp(H, lo([secondary]), hi([secondary]));
  }

  /** Smallest level L with sum(f(L)) >= want, by bisection (f monotone). */
  const solve = (f: (x: number) => number, want: number, top: number): number => {
    let a = 0;
    let z = top;
    for (let i = 0; i < 60; i++) {
      const m = (a + z) / 2;
      if (f(m) < want) a = m;
      else z = m;
    }
    return z;
  };

  // Level the focus/core buckets on actual seconds.
  const alloc = new Map<Bucket, number>();
  if (mainOn.length > 0) {
    const level = solve(
      (L) => mainOn.reduce((n, b) => n + clamp(L, lo([b]), hi([b])), 0),
      mainT,
      hi(mainOn) + 1,
    );
    for (const b of mainOn) alloc.set(b, clamp(level, lo([b]), hi([b])));
  }
  if (secondary.chosen.length > 0) alloc.set(secondary, secT);

  // Inside a bucket, scale authored holds by one factor (clamped per stretch).
  const real = new Map<string, number>();
  for (const [b, want] of alloc) {
    const hold = (s: Stretch, f: number) => clamp(nominalHold(s) * f, MIN_HOLD_SEC, holdCap(s));
    const fill = (f: number) => b.chosen.reduce((n, s) => n + stepsOf(s) * hold(s, f), 0);
    const f = solve(fill, want, 10);
    for (const s of b.chosen) real.set(s.id, hold(s, f));
  }

  const picked = buckets.flatMap((b) => b.chosen);
  const holdOf = new Map<string, number>();
  for (const s of picked) holdOf.set(s.id, Math.round(real.get(s.id) ?? nominalHold(s)));
  // Nudge whole seconds so the total lands on the target.
  let diff = target - picked.reduce((n, s) => n + cost(s, holdOf.get(s.id)!), 0);
  for (let guard = 0; guard < 400 && diff !== 0; guard++) {
    const dirn = diff > 0 ? 1 : -1;
    let best: Stretch | null = null;
    let bestErr = -Infinity;
    for (const s of picked) {
      const h = holdOf.get(s.id)!;
      if (stepsOf(s) > Math.abs(diff)) continue;
      if (dirn > 0 ? h >= holdCap(s) : h <= MIN_HOLD_SEC) continue;
      const err = dirn * ((real.get(s.id) ?? h) - h);
      if (err > bestErr) {
        bestErr = err;
        best = s;
      }
    }
    if (!best) break;
    holdOf.set(best.id, holdOf.get(best.id)! + dirn);
    diff -= dirn * stepsOf(best);
  }

  // --- 5. Order and emit -----------------------------------------------------------
  const postureRank = (s: Stretch) =>
    s.position === 'floor' && s.posture ? FLOOR_POSTURE_ORDER.indexOf(s.posture) : 0;
  const ordered = [...picked].sort(
    (a, b) =>
      POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position) ||
      postureRank(a) - postureRank(b) ||
      pickIndex.get(a.id)! - pickIndex.get(b.id)!,
  );

  const out: RoutineStep[] = [];
  for (const s of ordered) {
    const holdSec = holdOf.get(s.id)!;
    const repOf = repsOf.get(s.id) ?? 1;
    for (let rep = 1; rep <= repOf; rep++) {
      // Rep fields only on repeated stretches, so a single stays as before.
      const r = repOf > 1 ? { rep, repOf } : {};
      if (s.bilateral) {
        out.push({ stretchId: s.id, side: 'left', holdSec, ...r });
        out.push({ stretchId: s.id, side: 'right', holdSec, ...r });
      } else {
        out.push({ stretchId: s.id, holdSec, ...r });
      }
    }
  }

  return {
    minutes,
    focusAreas: focus,
    seed: opts.seed,
    reps: repsWanted,
    steps: out,
    totalSec: routineSeconds(out),
    droppedAreas: main.filter((b) => b.dropped && focus.length > 0).map((b) => b.area!),
  };
}
