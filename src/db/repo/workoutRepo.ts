import type { AccessoryWork, LiftId, MainSet, Workout } from '../../core/types.ts';
import { buildAccessoryWork, evaluateAccessoryProgression } from '../../core/accessories.ts';
import { db } from '../db.ts';

/** Read a single workout by id. */
export async function getWorkout(id: string): Promise<Workout | undefined> {
  return db.workouts.get(id);
}

async function requireWorkout(id: string): Promise<Workout> {
  const w = await db.workouts.get(id);
  if (!w) throw new Error(`Workout ${id} not found.`);
  return w;
}

/**
 * Stamp this workout's accessory snapshots from the day's active (non-archived)
 * AccessoryDefs in `order`, using each def's CURRENT weight (lazy stamping, so
 * earlier-in-cycle accessory progression is reflected). Idempotent-ish: only
 * stamps when accessoryWork is still empty.
 */
async function stampAccessoryWork(liftDayId: LiftId): Promise<AccessoryWork[]> {
  const defs = await db.accessories.where('liftDayId').equals(liftDayId).toArray();
  return defs
    .filter((d) => d.archivedAt === undefined)
    .sort((a, b) => a.order - b.order)
    .map((d) => buildAccessoryWork(d));
}

/** Whether any accessory set in the given accessoryWork has a logged rep. */
function hasLoggedAccessoryReps(accessoryWork: readonly AccessoryWork[]): boolean {
  return accessoryWork.some((a) => a.setReps.some((r) => r !== null && r !== undefined));
}

/**
 * The accessoryWork to use when transitioning a workout to in_progress. Preserves
 * any existing snapshot that already carries logged reps (so an unskip→reopen
 * never wipes entered accessory data); otherwise (re)stamps fresh from live defs.
 */
async function accessoryWorkForStart(w: Workout): Promise<AccessoryWork[]> {
  if (hasLoggedAccessoryReps(w.accessoryWork)) return w.accessoryWork;
  // Narrowing, not a guard: accessory DAYS are keyed by the four 5/3/1 lifts, so
  // the row has none by construction. (The real "never stamp accessories on a
  // StrongLifts row" guard is a separate concern — this branch is unreachable
  // until StrongLifts rows exist.)
  if (w.liftId === 'row') return [];
  return stampAccessoryWork(w.liftId);
}

/**
 * Transition a pending workout to in_progress: stamp startedAt and materialize
 * accessoryWork from the day's active AccessoryDefs. No-op if already started.
 */
export async function startWorkout(id: string): Promise<void> {
  await db.transaction('rw', db.workouts, db.accessories, async () => {
    const w = await requireWorkout(id);
    if (w.status === 'in_progress') return;
    if (w.status !== 'pending') {
      throw new Error(`Cannot start workout ${id} from status '${w.status}'.`);
    }
    const accessoryWork = await accessoryWorkForStart(w);
    await db.workouts.put({
      ...w,
      status: 'in_progress',
      startedAt: new Date().toISOString(),
      accessoryWork,
    });
  });
}

/**
 * Write-through log of a main-set actualReps. The first log on a still-pending
 * workout also starts it (stamps startedAt + accessoryWork). `kind`/`index`
 * identify the set within its kind-scoped list.
 */
export async function logMainSet(
  workoutId: string,
  kind: MainSet['kind'],
  index: number,
  actualReps: number,
): Promise<void> {
  await db.transaction('rw', db.workouts, db.accessories, async () => {
    const w = await requireWorkout(workoutId);
    if (w.status === 'completed' || w.status === 'skipped') {
      throw new Error(`Cannot log a main set on a ${w.status} workout (use editPastWorkout).`);
    }

    const now = new Date().toISOString();
    let next: Workout = w;

    // First interaction on a pending workout starts it.
    if (w.status === 'pending') {
      const accessoryWork = await accessoryWorkForStart(w);
      next = { ...w, status: 'in_progress', startedAt: now, accessoryWork };
    }

    const setIdx = next.mainSets.findIndex((s) => s.kind === kind && s.index === index);
    if (setIdx === -1) {
      throw new Error(`Main set ${kind}#${index} not found on workout ${workoutId}.`);
    }
    const mainSets = next.mainSets.map((s, i) =>
      i === setIdx ? { ...s, actualReps, loggedAt: now } : s,
    );
    await db.workouts.put({ ...next, mainSets });
  });
}

/**
 * Write-through log of one accessory set's reps. `accessoryIndex` indexes into
 * accessoryWork; `setIndex` into that entry's setReps. Requires the workout to
 * be in_progress (accessoryWork exists only after start).
 */
export async function logAccessorySet(
  workoutId: string,
  accessoryIndex: number,
  setIndex: number,
  reps: number,
): Promise<void> {
  await db.transaction('rw', db.workouts, async () => {
    const w = await requireWorkout(workoutId);
    if (w.status === 'completed' || w.status === 'skipped') {
      throw new Error(`Cannot log accessory on a ${w.status} workout (use editPastWorkout).`);
    }
    const entry = w.accessoryWork[accessoryIndex];
    if (!entry) throw new Error(`Accessory #${accessoryIndex} not found on workout ${workoutId}.`);
    if (setIndex < 0 || setIndex >= entry.setReps.length) {
      throw new Error(`Accessory set index ${setIndex} out of range.`);
    }
    const accessoryWork = w.accessoryWork.map((a, i) => {
      if (i !== accessoryIndex) return a;
      const setReps = a.setReps.slice();
      setReps[setIndex] = reps;
      return { ...a, setReps };
    });
    await db.workouts.put({ ...w, accessoryWork });
  });
}

/** Set (or clear) a workout's freeform notes. */
export async function setNotes(workoutId: string, notes: string): Promise<void> {
  await db.transaction('rw', db.workouts, async () => {
    const w = await requireWorkout(workoutId);
    await db.workouts.put({ ...w, notes });
  });
}

/**
 * Finish an in_progress workout in ONE transaction:
 *  - status → completed, stamp completedAt.
 *  - for each accessoryWork entry, evaluate core progression; where it passes,
 *    set progressed = true AND bump the matching (still-present) AccessoryDef's
 *    currentWeight by exactly +increment (plain addition — the user's own grid
 *    offset is preserved, e.g. 52 + 5 = 57, never re-snapped to the increment
 *    grid, honoring the plan's "+increment when all sets hit top" promise).
 *
 * Progression happens ONLY on the in_progress → completed transition, so a
 * double-finish is rejected (throws) — currentWeight can never bump twice.
 */
export async function finishWorkout(id: string): Promise<void> {
  await db.transaction('rw', db.workouts, db.accessories, async () => {
    const w = await requireWorkout(id);
    if (w.status !== 'in_progress') {
      throw new Error(`Cannot finish workout ${id}: status is '${w.status}', expected 'in_progress'.`);
    }

    const accessoryWork: AccessoryWork[] = [];
    for (const a of w.accessoryWork) {
      const progressed = evaluateAccessoryProgression(a.setReps, a.targetSets, a.repRangeMax);
      accessoryWork.push({ ...a, progressed });
      if (!progressed) continue;

      // Bump the live def (if it still exists) exactly once. Plain addition:
      // +increment from the current weight, preserving any off-grid offset.
      const def = await db.accessories.get(a.accessoryId);
      if (def) {
        const currentWeight = def.currentWeight + def.increment;
        await db.accessories.put({ ...def, currentWeight });
      }
    }

    await db.workouts.put({
      ...w,
      status: 'completed',
      completedAt: new Date().toISOString(),
      accessoryWork,
    });
  });
}

/** Skip a workout (explicit, counts as resolved). Only from pending/in_progress. */
export async function skipWorkout(id: string): Promise<void> {
  await db.transaction('rw', db.workouts, async () => {
    const w = await requireWorkout(id);
    if (w.status === 'completed') throw new Error(`Cannot skip a completed workout ${id}.`);
    if (w.status === 'skipped') return;
    await db.workouts.put({ ...w, status: 'skipped' });
  });
}

/**
 * Un-skip a workout back to pending. Allowed only while its cycle is still
 * active (a skip in a completed cycle is permanent history).
 */
export async function unskipWorkout(id: string): Promise<void> {
  await db.transaction('rw', db.workouts, db.cycles, async () => {
    const w = await requireWorkout(id);
    if (w.status !== 'skipped') {
      throw new Error(`Cannot unskip workout ${id}: status is '${w.status}'.`);
    }
    const cycle = await db.cycles.get(w.cycleId);
    if (!cycle || cycle.status !== 'active') {
      throw new Error(`Cannot unskip workout ${id}: its cycle is not active.`);
    }
    await db.workouts.put({ ...w, status: 'pending' });
  });
}

/** Edits allowed on a past workout: reps + notes ONLY. */
export interface PastWorkoutEdits {
  /** Main-set rep edits, addressed by kind + index. */
  mainSetReps?: { kind: MainSet['kind']; index: number; actualReps: number }[];
  /** Accessory rep edits, addressed by accessoryIndex + setIndex. */
  accessorySetReps?: { accessoryIndex: number; setIndex: number; reps: number }[];
  notes?: string;
}

/**
 * Edit a past (completed or skipped) workout. May change actualReps / accessory
 * setReps / notes ONLY — never weights, tmUsed, status, or accessory progression
 * (history-integrity invariant #1 & #2). Stamps editedAt.
 */
export async function editPastWorkout(id: string, edits: PastWorkoutEdits): Promise<void> {
  await db.transaction('rw', db.workouts, async () => {
    const w = await requireWorkout(id);

    let mainSets = w.mainSets;
    if (edits.mainSetReps && edits.mainSetReps.length > 0) {
      mainSets = mainSets.map((s) => {
        const edit = edits.mainSetReps!.find((e) => e.kind === s.kind && e.index === s.index);
        return edit ? { ...s, actualReps: edit.actualReps } : s;
      });
    }

    let accessoryWork = w.accessoryWork;
    if (edits.accessorySetReps && edits.accessorySetReps.length > 0) {
      accessoryWork = accessoryWork.map((a, ai) => {
        const relevant = edits.accessorySetReps!.filter((e) => e.accessoryIndex === ai);
        if (relevant.length === 0) return a;
        const setReps = a.setReps.slice();
        for (const e of relevant) {
          if (e.setIndex < 0 || e.setIndex >= setReps.length) {
            throw new Error(`Accessory set index ${e.setIndex} out of range on edit.`);
          }
          setReps[e.setIndex] = e.reps;
        }
        return { ...a, setReps }; // progressed is deliberately NOT recomputed
      });
    }

    const patch: Workout = {
      ...w,
      mainSets,
      accessoryWork,
      editedAt: new Date().toISOString(),
    };
    if (edits.notes !== undefined) patch.notes = edits.notes;

    await db.workouts.put(patch);
  });
}
