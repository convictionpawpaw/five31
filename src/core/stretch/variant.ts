import type { FloorPosture, RoutineStep, Stretch, StretchPosition } from './types.ts';

/** A stretch as one step actually performs it (its no-chair variant applied). */
export interface ResolvedStretch {
  pose: string;
  position: StretchPosition;
  posture?: FloorPosture;
  cues: string[];
}

/**
 * Resolve how a stretch is done: the no-chair variant when `noChair` is set
 * and the stretch has one, otherwise the stretch as authored. The single
 * place the preview, player and generator read pose, position and cues from.
 */
export function resolveStretch(stretch: Stretch, noChair = false): ResolvedStretch {
  const v = noChair ? stretch.noChair : undefined;
  if (!v) {
    return {
      pose: stretch.pose,
      position: stretch.position,
      posture: stretch.posture,
      cues: stretch.cues,
    };
  }
  return { pose: v.pose, position: v.position, posture: v.posture, cues: v.cues ?? stretch.cues };
}

/** {@link resolveStretch} for a routine step. */
export function resolveStep(stretch: Stretch, step: Pick<RoutineStep, 'noChair'>): ResolvedStretch {
  return resolveStretch(stretch, step.noChair === true);
}
