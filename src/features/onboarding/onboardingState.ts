import type { LiftId, Units } from '../../core/types.ts';
import type { OnboardingAccessoryInput } from '../../db/repo/onboardingRepo.ts';
import {
  defaultAccessoryIncrement,
  defaultLiftIncrements,
  defaultRoundingIncrement,
} from '../../core/units.ts';
import { roundToIncrement } from '../../core/rounding.ts';
import { DAY_ORDER } from '../../core/scheme.ts';

/** How the user is entering each lift's Training Max in the TM step. */
export type TmMode = 'oneRm' | 'direct';

/** Per-lift TM entry state (draft — not yet resolved to a TM number). */
export interface TmEntry {
  mode: TmMode;
  /** Estimated 1RM the user typed (used when mode === 'oneRm'). */
  oneRm: number;
  /** TM the user typed directly (used when mode === 'direct'). */
  directTm: number;
}

/** A draft accessory row in the accessories step (before payload mapping). */
export interface AccessoryDraft {
  liftDayId: LiftId;
  name: string;
  sets: number;
  repRangeMin: number;
  repRangeMax: number;
  currentWeight: number;
  increment: number;
}

/** The full mutable state the wizard threads through its steps. */
export interface OnboardingState {
  units: Units;
  roundingIncrement: number;
  /** 0.85 | 0.90 — the % of 1RM used to derive TMs. */
  tmPercent: number;
  includeDeload: boolean;
  liftIncrements: Record<LiftId, number>;
  tmEntries: Record<LiftId, TmEntry>;
  accessories: AccessoryDraft[];
}

/** Human labels for each lift, in DAY_ORDER. */
export const LIFT_LABELS: Record<LiftId, string> = {
  press: 'Overhead Press',
  deadlift: 'Deadlift',
  bench: 'Bench Press',
  squat: 'Squat',
};

/** The four lifts, in canonical training order. */
export const LIFTS: readonly LiftId[] = DAY_ORDER;

/** Resolve one lift's Training Max from its entry, given the current units + %. */
export function resolveTm(entry: TmEntry, tmPercent: number, roundingIncrement: number): number {
  if (entry.mode === 'direct') return entry.directTm;
  return roundToIncrement(entry.oneRm * tmPercent, roundingIncrement);
}

/** Resolve all four TMs into the `Record<LiftId, number>` the payload needs. */
export function resolveAllTms(state: OnboardingState): Record<LiftId, number> {
  const out = {} as Record<LiftId, number>;
  for (const lift of LIFTS) {
    out[lift] = resolveTm(state.tmEntries[lift], state.tmPercent, state.roundingIncrement);
  }
  return out;
}

/** Fresh default wizard state for a given unit system. */
export function initialOnboardingState(units: Units = 'lb'): OnboardingState {
  const rounding = defaultRoundingIncrement(units);
  const emptyEntry = (): TmEntry => ({ mode: 'oneRm', oneRm: 0, directTm: 0 });
  return {
    units,
    roundingIncrement: rounding,
    tmPercent: 0.9,
    includeDeload: true,
    liftIncrements: defaultLiftIncrements(units),
    tmEntries: {
      press: emptyEntry(),
      deadlift: emptyEntry(),
      bench: emptyEntry(),
      squat: emptyEntry(),
    },
    accessories: [],
  };
}

/**
 * When the unit system flips, reset unit-derived defaults (rounding increment,
 * per-lift TM bumps, accessory increments) and clear numeric TM/accessory
 * entries — cross-unit numbers would be meaningless.
 */
export function applyUnitChange(state: OnboardingState, units: Units): OnboardingState {
  if (units === state.units) return state;
  const fresh = initialOnboardingState(units);
  return {
    ...fresh,
    // Preserve the user's non-numeric structural choices.
    tmPercent: state.tmPercent,
    includeDeload: state.includeDeload,
    // Keep accessory rows but reset their unit-derived weight/increment.
    accessories: state.accessories.map((a) => ({
      ...a,
      currentWeight: 0,
      increment: defaultAccessoryIncrement(units),
    })),
  };
}

/** A blank accessory row for a given day. */
export function newAccessoryDraft(liftDayId: LiftId, units: Units): AccessoryDraft {
  return {
    liftDayId,
    name: '',
    sets: 3,
    repRangeMin: 8,
    repRangeMax: 12,
    currentWeight: 0,
    increment: defaultAccessoryIncrement(units),
  };
}

/** Map validated accessory drafts to the payload's accessory input shape. */
export function toAccessoryInputs(drafts: readonly AccessoryDraft[]): OnboardingAccessoryInput[] {
  return drafts
    .filter((a) => a.name.trim().length > 0)
    .map((a) => ({
      liftDayId: a.liftDayId,
      name: a.name.trim(),
      sets: a.sets,
      repRangeMin: a.repRangeMin,
      repRangeMax: a.repRangeMax,
      currentWeight: a.currentWeight,
      increment: a.increment,
    }));
}

/** Count accessories assigned to a given day. */
export function accessoriesForDay(state: OnboardingState, liftDayId: LiftId): AccessoryDraft[] {
  return state.accessories.filter((a) => a.liftDayId === liftDayId);
}
