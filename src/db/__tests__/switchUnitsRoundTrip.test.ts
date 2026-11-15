import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetDb, lbOnboardingPayload } from './setup.ts';
import { initializeFromOnboarding } from '../repo/onboardingRepo.ts';
import { getActiveCycle, getCycleWorkouts } from '../repo/cycleRepo.ts';
import { applyTmOverride } from '../repo/tmOverrideRepo.ts';
import { restoredTm, switchUnits } from '../repo/unitsRepo.ts';
import { getLiftState } from '../repo/liftStateRepo.ts';
import { convertWeight } from '../../core/units.ts';
import { roundToIncrement } from '../../core/rounding.ts';
import type { TmEvent } from '../../core/types.ts';

// Each step gets its own millisecond so event timestamps (and the ULIDs, which
// embed Date.now()) are strictly ordered, exactly as they are on a real phone.
let clock = Date.parse('2026-07-01T08:00:00.000Z');
function tick(): void {
  clock += 60_000;
  vi.setSystemTime(clock);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  tick();
  await resetDb();
});
afterEach(() => {
  vi.useRealTimers();
});

async function onboard135(): Promise<void> {
  await initializeFromOnboarding(
    lbOnboardingPayload({
      trainingMaxes: { press: 135, bench: 200, squat: 300, deadlift: 350 },
    }),
  );
}

describe('switchUnits round trip — training maxes', () => {
  it('lb → kg → lb restores the exact original TM (135 stays 135, not 130)', async () => {
    await onboard135();
    tick();
    await switchUnits('kg');
    expect((await getLiftState('press'))!.trainingMax).toBe(60); // 61.23 kg rounded to 2.5
    tick();
    await switchUnits('lb');
    expect((await getLiftState('press'))!.trainingMax).toBe(135);
    // Every lift round-trips exactly, and the cycle snapshot + regenerated
    // pending workouts follow the restored TM.
    expect((await getLiftState('bench'))!.trainingMax).toBe(200);
    expect((await getLiftState('squat'))!.trainingMax).toBe(300);
    expect((await getLiftState('deadlift'))!.trainingMax).toBe(350);
    const cycle = await getActiveCycle();
    expect(cycle!.tms.press).toBe(135);
    const pressWk1 = (await getCycleWorkouts(cycle!.id)).find(
      (w) => w.liftId === 'press' && w.week === 1,
    )!;
    expect(pressWk1.units).toBe('lb');
    expect(pressWk1.tmUsed).toBe(135);
  });

  it('stays exact over repeated switching (lb → kg → lb → kg)', async () => {
    await onboard135();
    tick();
    await switchUnits('kg');
    tick();
    await switchUnits('lb');
    tick();
    await switchUnits('kg');
    expect((await getLiftState('press'))!.trainingMax).toBe(60);
    tick();
    await switchUnits('lb');
    expect((await getLiftState('press'))!.trainingMax).toBe(135);
  });

  it('converts normally when the TM was changed in between', async () => {
    await onboard135();
    tick();
    await switchUnits('kg');
    tick();
    await applyTmOverride('press', 62.5);
    tick();
    await switchUnits('lb');
    const expected = roundToIncrement(convertWeight(62.5, 'kg', 'lb'), 5);
    expect((await getLiftState('press'))!.trainingMax).toBe(expected);
    expect(expected).toBe(140);
    // The untouched lifts still restore exactly.
    expect((await getLiftState('bench'))!.trainingMax).toBe(200);
  });
});

describe('restoredTm', () => {
  const ev = (over: Partial<TmEvent>): TmEvent => ({
    id: '01J0000000000000000000000A',
    liftId: 'press',
    cycleId: null,
    timestamp: '2026-07-01T09:00:00.000Z',
    type: 'unit_conversion',
    fromValue: 135,
    toValue: 60,
    note: 'lb→kg',
    ...over,
  });

  it('restores only a direct, untouched switch back', () => {
    expect(restoredTm(60, [ev({})], 'kg', 'lb')).toBe(135);
    // Wrong direction / unknown note: not trusted.
    expect(restoredTm(60, [ev({})], 'lb', 'kg')).toBeNull();
    expect(restoredTm(60, [ev({ note: undefined })], 'kg', 'lb')).toBeNull();
    // TM rewritten without an event (e.g. an import): convert normally.
    expect(restoredTm(62.5, [ev({})], 'kg', 'lb')).toBeNull();
    // A later non-conversion event wins.
    const later = ev({
      id: '01J0000000000000000000000B',
      timestamp: '2026-07-01T10:00:00.000Z',
      type: 'manual_override',
      fromValue: 60,
      toValue: 60,
      note: undefined,
    });
    expect(restoredTm(60, [ev({}), later], 'kg', 'lb')).toBeNull();
    expect(restoredTm(60, [], 'kg', 'lb')).toBeNull();
  });
});
