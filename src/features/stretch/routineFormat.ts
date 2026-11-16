import {
  BODY_AREAS,
  BODY_AREA_LABELS,
  type BodyArea,
  type Routine,
  type RoutineStep,
} from '../../core/stretch/types.ts';
import { getStretch } from '../../core/stretch/library.ts';
import { ROUTINE_NAME_MAX } from '../../db/repo/stretchRepo.ts';

/** The one-tap owner preset (neck and back work). */
export const NECK_BACK_CHEST: readonly BodyArea[] = ['neck', 'upperBack', 'lowerBack', 'chest'];

/** One preview row: every step of one stretch (all its sides and reps). */
export interface StepRun {
  stretchId: string;
  /** Index of the run's first step in the routine. */
  firstStep: number;
  bilateral: boolean;
  /** Reps of the stretch (1 when done once). */
  repOf: number;
  /** Hold per rep (and per side), seconds. */
  holdSec: number;
}

/** Group a routine's steps into one run per stretch (they are always adjacent). */
export function stepRuns(steps: readonly RoutineStep[]): StepRun[] {
  const out: StepRun[] = [];
  steps.forEach((st, i) => {
    const last = out.at(-1);
    if (last && last.stretchId === st.stretchId) {
      last.bilateral ||= st.side !== undefined;
      return;
    }
    out.push({
      stretchId: st.stretchId,
      firstStep: i,
      bilateral: st.side !== undefined,
      repOf: st.repOf ?? 1,
      holdSec: st.holdSec,
    });
  });
  return out;
}

/** Number of distinct stretches in a routine. */
export function distinctStretchCount(r: Pick<Routine, 'steps'>): number {
  return new Set(r.steps.map((s) => s.stretchId)).size;
}

/** "Rep 2 of 2", or null for a stretch done once. */
export function repLabel(step: RoutineStep | undefined): string | null {
  if (!step || step.repOf === undefined || step.repOf < 2 || step.rep === undefined) return null;
  return `Rep ${step.rep} of ${step.repOf}`;
}

/**
 * How step `index` follows the one before it: the same stretch on the other
 * side ('switch'), the same stretch again ('again', the next rep of a one-sided
 * stretch), or a new stretch ('new', also for the first step).
 */
export function transitionKind(
  steps: readonly RoutineStep[],
  index: number,
): 'new' | 'again' | 'switch' {
  const prev = steps[index - 1];
  const cur = steps[index];
  if (!prev || !cur || prev.stretchId !== cur.stretchId) return 'new';
  return cur.side !== undefined && prev.side !== cur.side ? 'switch' : 'again';
}

/** Most reps any stretch in the routine gets (1 for older routines). */
export function routineReps(r: Pick<Routine, 'steps' | 'reps'>): number {
  return Math.max(1, ...r.steps.map((s) => s.repOf ?? 1));
}

/**
 * Default name for saving a routine, e.g. "Neck + back + chest · 7 min" or
 * "Well-rounded · 7 min"; always within the name limit.
 */
export function defaultRoutineName(r: Pick<Routine, 'focusAreas' | 'minutes'>): string {
  const areas = BODY_AREAS.filter((a) => r.focusAreas.includes(a));
  const tail = ` · ${r.minutes} min`;
  let head: string;
  if (areas.length === 0) head = 'Well-rounded';
  else if (
    areas.length === NECK_BACK_CHEST.length &&
    NECK_BACK_CHEST.every((a) => areas.includes(a))
  )
    head = 'Neck + back + chest';
  else head = areas.map((a) => BODY_AREA_LABELS[a]).join(' + ');
  if (head.length + tail.length > ROUTINE_NAME_MAX) head = `${areas.length} areas`;
  return `${head}${tail}`;
}

/** Ids in a routine that the library no longer has (a retired stretch). */
export function missingStretchIds(r: Pick<Routine, 'steps'>): string[] {
  return [...new Set(r.steps.map((s) => s.stretchId))].filter((id) => !getStretch(id));
}
