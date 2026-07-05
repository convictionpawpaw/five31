import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, lbOnboardingPayload } from './setup.ts';
import { initializeFromOnboarding } from '../repo/onboardingRepo.ts';
import { getActiveCycle, getCycleWorkouts } from '../repo/cycleRepo.ts';
import {
  startWorkout,
  logMainSet,
  logAccessorySet,
  finishWorkout,
  editPastWorkout,
  getWorkout,
} from '../repo/workoutRepo.ts';
import { getLiftState } from '../repo/liftStateRepo.ts';
import { db } from '../db.ts';
import type { Workout } from '../../core/types.ts';

beforeEach(resetDb);

async function completedBench(): Promise<Workout> {
  await initializeFromOnboarding(
    lbOnboardingPayload({
      accessories: [
        { liftDayId: 'bench', name: 'Dips', sets: 3, repRangeMin: 8, repRangeMax: 12, currentWeight: 40, increment: 5 },
      ],
    }),
  );
  const cycle = await getActiveCycle();
  const bench = (await getCycleWorkouts(cycle!.id)).find(
    (w) => w.liftId === 'bench' && w.week === 1,
  )!;
  await startWorkout(bench.id);
  await logMainSet(bench.id, 'work', 2, 8); // AMRAP 8
  // Accessory falls short so it does NOT progress on finish.
  await logAccessorySet(bench.id, 0, 0, 10);
  await logAccessorySet(bench.id, 0, 1, 10);
  await logAccessorySet(bench.id, 0, 2, 10);
  await finishWorkout(bench.id);
  return (await getWorkout(bench.id))!;
}

describe('editPastWorkout', () => {
  it('changes reps + notes and stamps editedAt, without touching weights/tmUsed/status', async () => {
    const w = await completedBench();
    const beforeWeights = w.mainSets.map((s) => s.weight);

    await editPastWorkout(w.id, {
      mainSetReps: [{ kind: 'work', index: 2, actualReps: 12 }],
      notes: 'retro-edited',
    });

    const after = await getWorkout(w.id);
    expect(after!.mainSets.find((s) => s.kind === 'work' && s.index === 2)!.actualReps).toBe(12);
    expect(after!.notes).toBe('retro-edited');
    expect(after!.editedAt).toBeDefined();
    expect(after!.status).toBe('completed'); // unchanged
    expect(after!.tmUsed).toBe(200); // unchanged
    expect(after!.mainSets.map((s) => s.weight)).toEqual(beforeWeights); // weights frozen
  });

  it('editing a completed AMRAP does NOT change any AccessoryDef.currentWeight or LiftState', async () => {
    const w = await completedBench();
    const dipsId = w.accessoryWork[0]!.accessoryId;
    const dipsBefore = await db.accessories.get(dipsId);
    const benchTmBefore = (await getLiftState('bench'))!.trainingMax;

    // Edit both the main AMRAP reps AND the accessory reps up to the ceiling.
    await editPastWorkout(w.id, {
      mainSetReps: [{ kind: 'work', index: 2, actualReps: 20 }],
      accessorySetReps: [
        { accessoryIndex: 0, setIndex: 0, reps: 12 },
        { accessoryIndex: 0, setIndex: 1, reps: 12 },
        { accessoryIndex: 0, setIndex: 2, reps: 12 },
      ],
    });

    const dipsAfter = await db.accessories.get(dipsId);
    expect(dipsAfter!.currentWeight).toBe(dipsBefore!.currentWeight); // NO bump on edit
    // The snapshot's progressed flag is not recomputed on edit either.
    const after = await getWorkout(w.id);
    expect(after!.accessoryWork[0]!.progressed).toBe(false);
    // LiftState untouched (progression flows forward only, never from edits).
    expect((await getLiftState('bench'))!.trainingMax).toBe(benchTmBefore);
  });
});
