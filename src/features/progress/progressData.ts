import type {
  AccessoryDef,
  BodyweightEntry,
  Cycle,
  LiftId,
  SlLiftId,
  Units,
  Workout,
} from '../../core/types.ts';
import { epley } from '../../core/e1rm.ts';
import { convertWeight } from '../../core/units.ts';
import { computePrTimelineWithResets, type DatedEffort } from '../../core/prs.ts';
import { effortSet } from '../../core/efforts.ts';
import { fmtShortDate } from '../shared/format.ts';
import type { LinePoint } from './charts/index.ts';

/** Chronological key for a completed workout (completedAt, else ULID id). */
function completedKey(w: Workout): string {
  return w.completedAt ?? w.id;
}

/**
 * Completed workouts of one lift with a logged PR EFFORT, oldest first. The
 * effort is program-aware (`effortSet`), so a 5/3/1 workout contributes its
 * AMRAP set — byte-identical to the previous behaviour — and a StrongLifts row
 * contributes its best logged work set.
 */
function completedEffortWorkouts(workouts: readonly Workout[], liftId: SlLiftId): Workout[] {
  return workouts
    .filter((w) => {
      if (w.liftId !== liftId || w.status !== 'completed') return false;
      const set = effortSet(w);
      return set !== null && set.actualReps !== undefined;
    })
    .sort((a, b) => completedKey(a).localeCompare(completedKey(b)));
}

/** A summary stat shown as a big numeral above a chart. */
export interface StatValue {
  value: number;
  units: Units;
}

/** The e1RM line series for a lift plus latest/best headline stats. */
export interface E1rmSeries {
  points: LinePoint[];
  latest: StatValue | null;
  best: StatValue | null;
}

/**
 * Build the e1RM timeline for a lift from every completed workout's logged PR
 * effort, chronological. Efforts are converted into `targetUnits`. PR points
 * (via core computePrTimelineWithResets) are flagged for glowing diamond
 * markers; `resets` is Settings.prResets, so after a program switch with Keep
 * PRs off the diamonds restart while the earlier line is untouched. `latest` is
 * the most recent effort's e1RM; `best` is the max e1RM over the series.
 */
export function buildE1rmSeries(
  workouts: readonly Workout[],
  liftId: SlLiftId,
  targetUnits: Units,
  resets: readonly string[] = [],
): E1rmSeries {
  const relevant = completedEffortWorkouts(workouts, liftId);

  const efforts: DatedEffort[] = relevant.map((w) => {
    const set = effortSet(w)!;
    const weight = convertWeight(set.weight, w.units, targetUnits);
    return { weight, reps: set.actualReps!, ref: w.id, at: completedKey(w) };
  });
  const timeline = computePrTimelineWithResets(efforts, resets);

  const points: LinePoint[] = [];
  let best: number | null = null;
  timeline.forEach((entry, i) => {
    if (entry.e1rm === null) return;
    const w = relevant[i]!;
    points.push({
      x: points.length,
      y: entry.e1rm,
      isPr: entry.isPr,
      label: fmtShortDate(completedKey(w)),
    });
    if (best === null || entry.e1rm > best) best = entry.e1rm;
  });

  const latestVal = points.length > 0 ? points[points.length - 1]!.y : null;
  return {
    points,
    latest: latestVal !== null ? { value: latestVal, units: targetUnits } : null,
    best: best !== null ? { value: best, units: targetUnits } : null,
  };
}

/** One row of the reverse-chronological PR list. */
export interface PrListEntry {
  workoutId: string;
  /** Widened with `workout.liftId`, so a StrongLifts row PR can appear here. */
  liftId: SlLiftId;
  date: string;
  weight: number;
  reps: number;
  e1rm: number;
  units: Units;
}

/**
 * Every PR-flagged effort across all lifts, newest first. Each lift's timeline
 * is computed in its OWN unit history (efforts normalised to the first effort's
 * units per lift), preserving the values as logged. `resets` splits the timeline
 * into PR epochs; pre-reset records keep the badge they earned.
 */
export function buildPrList(
  workouts: readonly Workout[],
  resets: readonly string[] = [],
): PrListEntry[] {
  const byLift = new Map<SlLiftId, Workout[]>();
  for (const w of workouts) {
    if (w.status !== 'completed') continue;
    const set = effortSet(w);
    if (!set || set.actualReps === undefined) continue;
    const list = byLift.get(w.liftId) ?? [];
    list.push(w);
    byLift.set(w.liftId, list);
  }

  const out: PrListEntry[] = [];
  for (const [liftId, list] of byLift) {
    list.sort((a, b) => completedKey(a).localeCompare(completedKey(b)));
    const refUnits = list[0]!.units;
    const efforts: DatedEffort[] = list.map((w) => {
      const set = effortSet(w)!;
      return {
        weight: convertWeight(set.weight, w.units, refUnits),
        reps: set.actualReps!,
        ref: w.id,
        at: completedKey(w),
      };
    });
    const timeline = computePrTimelineWithResets(efforts, resets);
    timeline.forEach((entry, i) => {
      if (!entry.isPr || entry.e1rm === null) return;
      const w = list[i]!;
      const set = effortSet(w)!;
      out.push({
        workoutId: w.id,
        liftId,
        date: completedKey(w),
        weight: set.weight,
        reps: set.actualReps!,
        e1rm: epley(set.weight, set.actualReps!) ?? 0,
        units: w.units,
      });
    });
  }

  out.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}

/** A TM value snapshot for one cycle, used by the TM step chart. */
export interface TmStepSeries {
  points: { x: number; y: number; label?: string }[];
  latest: StatValue | null;
}

/**
 * TM-per-cycle step series for a lift, from each cycle's `tms` snapshot
 * (including the active cycle), x = cycle number. TMs are shown in their cycle's
 * own units (no conversion — a unit switch already rewrote live snapshots), so
 * we convert historical snapshots into `targetUnits` for a consistent axis.
 */
export function buildTmStepSeries(
  cycles: readonly Cycle[],
  liftId: LiftId,
  targetUnits: Units,
): TmStepSeries {
  const ordered = [...cycles].sort((a, b) => a.number - b.number);
  // x MUST be the 0-based array index (chartScale.projectX assumes x runs
  // 0..n-1); the `C${number}` label carries the cycle identity. Using c.number
  // (1-based) would push the newest cycle's TM point off the right edge.
  const points = ordered.map((c, i) => ({
    x: i,
    y: convertWeight(c.tms[liftId], c.units, targetUnits),
    label: `C${c.number}`,
  }));
  const latest = points.length > 0 ? { value: points[points.length - 1]!.y, units: targetUnits } : null;
  return { points, latest };
}

/** The weight-over-time series for a chosen accessory definition. */
export interface AccessorySeries {
  points: LinePoint[];
  latest: StatValue | null;
}

/**
 * Accessory weight-over-time from the workout accessoryWork snapshots for a
 * given accessory id, chronological across completed workouts. Uses the snapshot
 * `weight` field (the weight actually used that session), converted to
 * `targetUnits`.
 */
export function buildAccessorySeries(
  workouts: readonly Workout[],
  accessoryId: string,
  targetUnits: Units,
): AccessorySeries {
  const rows: { key: string; weight: number; units: Units }[] = [];
  for (const w of workouts) {
    if (w.status !== 'completed') continue;
    for (const a of w.accessoryWork) {
      if (a.accessoryId !== accessoryId) continue;
      rows.push({ key: completedKey(w), weight: a.weight, units: w.units });
    }
  }
  rows.sort((a, b) => a.key.localeCompare(b.key));

  const points: LinePoint[] = rows.map((r, i) => ({
    x: i,
    y: convertWeight(r.weight, r.units, targetUnits),
    label: fmtShortDate(r.key),
  }));
  const latest = points.length > 0 ? { value: points[points.length - 1]!.y, units: targetUnits } : null;
  return { points, latest };
}

/**
 * Last-N session weights (chronological) for an accessory sparkline, each
 * converted from its workout's own units into `targetUnits` — the same
 * conversion {@link buildAccessorySeries} applies, so a mid-history unit switch
 * never draws 100 lb next to 45 kg on one line.
 */
export function accessorySparklineValues(
  workouts: readonly Workout[],
  accessoryId: string,
  targetUnits: Units,
  n = 6,
): number[] {
  const rows: { key: string; weight: number; units: Units }[] = [];
  for (const w of workouts) {
    if (w.status !== 'completed') continue;
    for (const a of w.accessoryWork) {
      if (a.accessoryId === accessoryId) {
        rows.push({ key: completedKey(w), weight: a.weight, units: w.units });
      }
    }
  }
  rows.sort((a, b) => a.key.localeCompare(b.key));
  return rows.slice(-n).map((r) => convertWeight(r.weight, r.units, targetUnits));
}

/** The bodyweight line series + latest value. */
export interface BodyweightSeries {
  points: LinePoint[];
  latest: StatValue | null;
}

/**
 * Bodyweight-over-time line. Entries are already date-sorted by the repo; we
 * convert each into `targetUnits` for a single axis.
 */
export function buildBodyweightSeries(
  entries: readonly BodyweightEntry[],
  targetUnits: Units,
): BodyweightSeries {
  const points: LinePoint[] = entries.map((e, i) => ({
    x: i,
    y: convertWeight(e.weight, e.units, targetUnits),
    label: fmtShortDate(e.date),
  }));
  const latest = points.length > 0 ? { value: points[points.length - 1]!.y, units: targetUnits } : null;
  return { points, latest };
}

/** Accessory picker option: id, name, day, archived flag. */
export interface AccessoryOption {
  id: string;
  name: string;
  liftDayId: LiftId;
  archived: boolean;
}

/** Build picker options from all accessory defs (archived last), by day order. */
export function accessoryOptions(defs: readonly AccessoryDef[]): AccessoryOption[] {
  return defs
    .map((d) => ({
      id: d.id,
      name: d.name,
      liftDayId: d.liftDayId,
      archived: d.archivedAt !== undefined,
    }))
    .sort((a, b) => {
      if (a.archived !== b.archived) return a.archived ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
}

// ---------------------------------------------------------------------------
// StrongLifts-aware chart chrome
// ---------------------------------------------------------------------------

/**
 * Whether the barbell row has any data at all. The row is a StrongLifts-only
 * lift: on a pure 5/3/1 history its chip would open onto a permanently empty
 * chart, so the chip appears ONLY once a row workout exists (pending counts —
 * the block has been created and the lift is real from that moment).
 */
export function hasRowData(workouts: readonly Workout[]): boolean {
  return workouts.some((w) => w.liftId === 'row');
}

/**
 * The lift chips for the e1RM tab: the user's 5/3/1 day order, with ROW appended
 * (never interleaved) when — and only when — row data exists. The TM tab is
 * deliberately NOT built from this: training maxes are a 4-lift concept.
 */
export function e1rmLiftChips(
  order: readonly LiftId[],
  workouts: readonly Workout[],
): SlLiftId[] {
  const chips: SlLiftId[] = [...order];
  if (hasRowData(workouts)) chips.push('row');
  return chips;
}

/** The caption shown under a PR chart once the record slate has been reset. */
export const PR_RESET_CAPTION = 'Record reset at program switch — diamonds restart.';

/**
 * The reset caption, or null when the timeline is unbroken. A predicate rather
 * than an inline `length > 0` so the rule ("shown iff prResets is non-empty",
 * including the absent case) is stated in one tested place.
 */
export function prResetCaption(resets: readonly string[] | undefined): string | null {
  return resets !== undefined && resets.length > 0 ? PR_RESET_CAPTION : null;
}
