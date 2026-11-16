import { describe, it, expect } from 'vitest';
import {
  defaultRoutineName,
  distinctStretchCount,
  missingStretchIds,
  repLabel,
  routineReps,
  stepRuns,
  transitionKind,
} from '../routineFormat.ts';
import { generateRoutine } from '../../../core/stretch/generator.ts';
import { ROUTINE_NAME_MAX } from '../../../db/repo/stretchRepo.ts';
import { BODY_AREAS, type RoutineStep } from '../../../core/stretch/types.ts';

const steps: RoutineStep[] = [
  { stretchId: 'chin-tuck', holdSec: 20, rep: 1, repOf: 2 },
  { stretchId: 'chin-tuck', holdSec: 20, rep: 2, repOf: 2 },
  { stretchId: 'upper-trap', side: 'left', holdSec: 25, rep: 1, repOf: 2 },
  { stretchId: 'upper-trap', side: 'right', holdSec: 25, rep: 1, repOf: 2 },
  { stretchId: 'upper-trap', side: 'left', holdSec: 25, rep: 2, repOf: 2 },
  { stretchId: 'upper-trap', side: 'right', holdSec: 25, rep: 2, repOf: 2 },
  { stretchId: 'cat-cow', holdSec: 40 },
];

describe('routine format helpers', () => {
  it('groups steps into one run per stretch with sides and reps', () => {
    expect(stepRuns(steps)).toEqual([
      { stretchId: 'chin-tuck', firstStep: 0, bilateral: false, repOf: 2, holdSec: 20 },
      { stretchId: 'upper-trap', firstStep: 2, bilateral: true, repOf: 2, holdSec: 25 },
      { stretchId: 'cat-cow', firstStep: 6, bilateral: false, repOf: 1, holdSec: 40 },
    ]);
    expect(distinctStretchCount({ steps })).toBe(3);
    expect(routineReps({ steps })).toBe(2);
    expect(routineReps({ steps: [steps[6]!] })).toBe(1);
  });

  it('labels reps and classifies each transition', () => {
    expect(repLabel(steps[1])).toBe('Rep 2 of 2');
    expect(repLabel(steps[6])).toBeNull();
    expect(repLabel(undefined)).toBeNull();
    expect(steps.map((_, i) => transitionKind(steps, i))).toEqual([
      'new',
      'again',
      'new',
      'switch',
      'switch',
      'switch',
      'new',
    ]);
  });

  it('defaults the save name from the focus and length, within the limit', () => {
    const owner = generateRoutine({
      minutes: 7,
      focusAreas: ['chest', 'neck', 'upperBack', 'lowerBack'],
      seed: 1,
    });
    expect(defaultRoutineName(owner)).toBe('Neck + back + chest · 7 min');
    expect(defaultRoutineName({ minutes: 5, focusAreas: [] })).toBe('Well-rounded · 5 min');
    expect(defaultRoutineName({ minutes: 8, focusAreas: ['hamstrings', 'hips'] })).toBe(
      'Hips + Hamstrings · 8 min',
    );
    const many = defaultRoutineName({ minutes: 10, focusAreas: [...BODY_AREAS] });
    expect(many).toBe('11 areas · 10 min');
    expect(many.length).toBeLessThanOrEqual(ROUTINE_NAME_MAX);
  });

  it('finds stretch ids the library no longer has', () => {
    expect(missingStretchIds({ steps })).toEqual([]);
    expect(missingStretchIds({ steps: [...steps, { stretchId: 'retired', holdSec: 20 }] })).toEqual(
      ['retired'],
    );
  });
});
