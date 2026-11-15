/**
 * DEV / PREVIEW SEED — generate plausible multi-cycle data to exercise the
 * analytics screens. Uses ONLY the repo functions (never raw table writes) so
 * every history-integrity invariant holds exactly as in normal use.
 *
 * This file is import-only against the repos and db; it is the single new file
 * chunk C5 adds under src/db. It is NOT part of any export schema path — the
 * data it produces is ordinary data.
 */
import type { LiftId, SlLiftId } from '../core/types.ts';
import { DAY_ORDER } from '../core/scheme.ts';
import { cycleAdvancePlan } from '../core/cycle.ts';
import { defaultAccessoryIncrement, defaultLiftIncrements } from '../core/units.ts';
import { db } from './db.ts';
import {
  completeCycle,
  finishWorkout,
  getActiveCycle,
  getCycleWorkouts,
  getSettings,
  initializeFromOnboarding,
  logAccessorySet,
  logMainSet,
  setNotes,
  startWorkout,
  upsertBodyweight,
} from './repo/index.ts';

/** Deterministic pseudo-random in [0,1) so seeds are reproducible per session. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

/** Starting Training Maxes (lb) for a plausible intermediate lifter. */
const START_TMS: Record<LiftId, number> = {
  press: 115,
  deadlift: 335,
  bench: 175,
  squat: 265,
};

/**
 * Wipe the database and generate `cycleCount` cycles of realistic data:
 *  - increasing TMs (via completeCycle's forward progression),
 *  - AMRAP reps 1–8 with occasional misses (drives e1RM + PR charts),
 *  - two accessories per relevant day with rep-ceiling progression,
 *  - bodyweight drifting down over time.
 *
 * The FIRST `cycleCount - 1` cycles are fully completed; the LAST cycle is left
 * active with its workouts pending, mirroring a real in-progress state. Requires
 * `cycleCount >= 1`.
 */
export async function seedDemoData(cycleCount: number): Promise<void> {
  const n = Math.max(1, Math.floor(cycleCount));
  const rng = makeRng(0x5e3d01 + n);

  if (!db.isOpen()) await db.open();

  // Everything — the wipe, the fresh init, and every played-out cycle — runs
  // inside ONE parent transaction covering every table. The repo functions
  // below open their own 'rw' transactions on these same tables, which Dexie
  // NESTS into (joins) this parent, so all writes commit together. The live
  // useLiveQuery subscriptions on the triggering screen therefore never observe
  // an intermediate empty DB (which would bounce the user into onboarding).
  await db.transaction(
    'rw',
    [
      db.settings,
      db.liftState,
      db.cycles,
      db.workouts,
      db.accessories,
      db.bodyweight,
      db.tmEvents,
      db.stretchSessions,
    ],
    async () => {
      // 1. Fresh DB. Clear every table (a full db.delete() would deadlock while
      //    live subscriptions hold the connection open — clearing does not).
      await Promise.all([
        db.settings.clear(),
        db.liftState.clear(),
        db.cycles.clear(),
        db.workouts.clear(),
        db.accessories.clear(),
        db.bodyweight.clear(),
        db.tmEvents.clear(),
        db.stretchSessions.clear(),
      ]);

      // 2. Onboarding → Cycle 1 + accessories.
      const liftIncrements = defaultLiftIncrements('lb');
      const accInc = defaultAccessoryIncrement('lb');
      await initializeFromOnboarding({
        units: 'lb',
        roundingIncrement: 5,
        tmPercent: 0.9,
        includeDeload: false,
        liftIncrements,
        trainingMaxes: { ...START_TMS },
        accessories: [
          { liftDayId: 'press', name: 'Chin-ups', sets: 3, repRangeMin: 8, repRangeMax: 12, currentWeight: 0, increment: accInc },
          { liftDayId: 'press', name: 'DB Curl', sets: 3, repRangeMin: 10, repRangeMax: 15, currentWeight: 20, increment: accInc },
          { liftDayId: 'bench', name: 'Dips', sets: 3, repRangeMin: 8, repRangeMax: 12, currentWeight: 0, increment: accInc },
          { liftDayId: 'squat', name: 'Leg Curl', sets: 3, repRangeMin: 10, repRangeMax: 15, currentWeight: 45, increment: accInc },
          { liftDayId: 'deadlift', name: 'Ab Wheel', sets: 3, repRangeMin: 8, repRangeMax: 12, currentWeight: 0, increment: accInc },
        ],
      });

      // Bodyweight baseline; drifts down ~0.3 lb per logged day.
      let bw = 205;
      const baseDate = new Date();
      baseDate.setDate(baseDate.getDate() - n * 28); // ~4 weeks per cycle back in time
      let dayCursor = 0;

      const bodyweightOn = async () => {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + dayCursor);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        bw = Math.round((bw - 0.3 + (rng() - 0.5)) * 10) / 10;
        await upsertBodyweight(iso, bw, 'lb');
      };

      // 3. Play out each cycle.
      for (let c = 1; c <= n; c++) {
        const active = await getActiveCycle();
        if (!active) break;

        // Leave the LAST cycle pending/active so the app opens on a live cycle.
        const isLast = c === n;
        if (isLast) {
          await bodyweightOn();
          break;
        }

        // DAY_ORDER is read through the wider SlLiftId element type only so the
        // now-widened `workout.liftId` type-checks. The seeder only ever builds
        // classic 5/3/1 cycles, so every id here is still a LiftId.
        const dayOrder = DAY_ORDER as readonly SlLiftId[];
        const workouts = (await getCycleWorkouts(active.id)).sort((a, b) => {
          if (a.week !== b.week) return a.week - b.week;
          return dayOrder.indexOf(a.liftId) - dayOrder.indexOf(b.liftId);
        });

        for (const w of workouts) {
          await startWorkout(w.id);

          // Log warmups at their target reps.
          for (const s of w.mainSets) {
            if (s.kind === 'warmup') await logMainSet(w.id, 'warmup', s.index, s.targetReps);
          }
          // Log work sets; the AMRAP set gets a variable rep count.
          for (const s of w.mainSets) {
            if (s.kind !== 'work') continue;
            if (s.amrap) {
              // Base AMRAP reps trend up with cycle; occasional miss (~15%).
              const miss = rng() < 0.15;
              const base = s.targetReps + 2 + Math.floor(rng() * 4) + Math.floor(c / 3);
              const reps = miss ? Math.max(1, s.targetReps - 1) : Math.min(12, base);
              await logMainSet(w.id, 'work', s.index, reps);
            } else {
              await logMainSet(w.id, 'work', s.index, s.targetReps);
            }
          }

          // Accessories: sometimes hit the ceiling on all sets → progression.
          const reload = await db.workouts.get(w.id);
          if (reload) {
            for (let ai = 0; ai < reload.accessoryWork.length; ai++) {
              const acc = reload.accessoryWork[ai]!;
              const hitCeiling = rng() < 0.5;
              for (let si = 0; si < acc.setReps.length; si++) {
                const reps = hitCeiling
                  ? acc.repRangeMax
                  : acc.repRangeMin + Math.floor(rng() * (acc.repRangeMax - acc.repRangeMin));
                await logAccessorySet(w.id, ai, si, reps);
              }
            }
          }

          if (rng() < 0.2) await setNotes(w.id, 'Felt strong.');

          await finishWorkout(w.id);

          dayCursor += 2; // ~2 days between sessions
          if (rng() < 0.4) await bodyweightOn();
        }

        // Advance to the next cycle using the real recommendation, then complete.
        const settings = await getSettings();
        const finalTms = {} as Record<LiftId, number>;
        const plan = cycleAdvancePlan(workouts, active.tms, settings!.liftIncrements);
        for (const entry of plan) finalTms[entry.liftId] = entry.recommendedTm;
        await completeCycle(finalTms);
      }
    },
  );
}
