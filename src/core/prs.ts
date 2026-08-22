import { epley } from './e1rm.ts';

/** A completed AMRAP effort, ordered chronologically by the caller. */
export interface AmrapEffort {
  weight: number;
  reps: number;
  /** Opaque identifier the caller uses to correlate the result (e.g. workout id). */
  ref?: string;
}

/** One entry in the PR timeline: the effort, its e1RM, and whether it set a new PR. */
export interface PrTimelineEntry {
  weight: number;
  reps: number;
  ref?: string;
  e1rm: number | null;
  isPr: boolean; // true iff this effort strictly exceeded the running-max e1RM
}

/**
 * Walk a chronological list of AMRAP efforts and flag each one that set a NEW
 * personal record, i.e. whose e1RM strictly exceeds the running maximum of all
 * prior efforts. The first valid effort is always a PR. Efforts with no valid
 * e1RM (reps <= 0) never count as PRs and don't move the running max.
 */
export function computePrTimeline(efforts: readonly AmrapEffort[]): PrTimelineEntry[] {
  let runningMax = -Infinity;
  const out: PrTimelineEntry[] = [];

  for (const effort of efforts) {
    const e1 = epley(effort.weight, effort.reps);
    let isPr = false;
    if (e1 !== null && e1 > runningMax) {
      isPr = true;
      runningMax = e1;
    }
    out.push({
      weight: effort.weight,
      reps: effort.reps,
      ref: effort.ref,
      e1rm: e1,
      isPr,
    });
  }

  return out;
}

/** A chronological effort that also carries WHEN it happened, for epoch splitting. */
export interface DatedEffort extends AmrapEffort {
  /** ISO timestamp of the effort (the workout's completedAt, or its ULID id). */
  at: string;
}

/**
 * {@link computePrTimeline} with PR-RESET EPOCHS — the sibling used once the
 * user has switched programs with "Keep PRs" OFF.
 *
 * `resets` is Settings.prResets: an append-only list of ISO timestamps at which
 * the record slate was wiped. A single chronological pass walks the efforts and,
 * every time it crosses a reset timestamp, drops the running max back to
 * -Infinity — so the first effort of each epoch is a PR again, exactly as the
 * first effort overall is. Efforts are NOT rewritten: pre-reset entries keep the
 * `isPr` they earned, which is what lets old badges survive in History.
 *
 * Boundary rule: an effort at EXACTLY a reset timestamp belongs to the NEW
 * epoch (the reset is written at the moment of the switch, before any effort
 * that follows it can be logged).
 *
 * With an empty `resets` this is behaviour-identical to {@link computePrTimeline}.
 * Both `efforts` (chronological) and `resets` are treated as read-only; `resets`
 * is sorted into a local copy, so an unordered list is still handled correctly.
 */
export function computePrTimelineWithResets(
  efforts: readonly DatedEffort[],
  resets: readonly string[],
): PrTimelineEntry[] {
  // ISO-8601 timestamps sort lexicographically == chronologically.
  const boundaries = [...resets].sort((a, b) => a.localeCompare(b));
  let nextBoundary = 0;
  let runningMax = -Infinity;
  const out: PrTimelineEntry[] = [];

  for (const effort of efforts) {
    while (nextBoundary < boundaries.length && boundaries[nextBoundary]! <= effort.at) {
      runningMax = -Infinity; // crossed a reset — new epoch
      nextBoundary += 1;
    }

    const e1 = epley(effort.weight, effort.reps);
    let isPr = false;
    if (e1 !== null && e1 > runningMax) {
      isPr = true;
      runningMax = e1;
    }
    out.push({
      weight: effort.weight,
      reps: effort.reps,
      ref: effort.ref,
      e1rm: e1,
      isPr,
    });
  }

  return out;
}

/**
 * For a live AMRAP set at `weight`, find the smallest whole rep count whose e1RM
 * strictly beats `recordE1rm` — this powers the "≥ N REPS = NEW RECORD" hint.
 *
 * Returns null if no rep count from 1..maxReps (default 30) can beat the record
 * at this weight (i.e. the weight is too light to PR within a realistic set).
 * If there is no existing record (null), any single rep is a new record → 1.
 */
export function amrapTargetForPr(
  weight: number,
  recordE1rm: number | null,
  maxReps = 30,
): number | null {
  if (recordE1rm === null) return 1;

  for (let reps = 1; reps <= maxReps; reps++) {
    const e1 = epley(weight, reps);
    if (e1 !== null && e1 > recordE1rm) return reps;
  }
  return null;
}
