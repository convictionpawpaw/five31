import type { RoutineStep } from '../../core/stretch/types.ts';
import { TRANSITION_SEC } from '../../core/stretch/generator.ts';

/**
 * The player's timeline, as pure functions of elapsed milliseconds. The
 * player keeps only timestamps (never accumulated ticks), so whatever the
 * tab was throttled to, position = elapsed wall-clock time, and the current
 * phase is looked up here.
 *
 * Each step is a 'prep' phase (the "get ready" lead-in for the first step, a
 * transition showing the next stretch otherwise) followed by its 'hold'.
 */

export type PhaseKind = 'prep' | 'hold';

export interface Phase {
  kind: PhaseKind;
  stepIndex: number;
  startMs: number;
  durMs: number;
}

export interface Timeline {
  phases: Phase[];
  totalMs: number;
}

export interface Position {
  /** Index into phases; phases.length when done. */
  index: number;
  phase: Phase | null;
  phaseElapsedMs: number;
  remainingMs: number;
  done: boolean;
}

export function buildTimeline(steps: readonly RoutineStep[], prepSec = TRANSITION_SEC): Timeline {
  const phases: Phase[] = [];
  let t = 0;
  steps.forEach((st, i) => {
    phases.push({ kind: 'prep', stepIndex: i, startMs: t, durMs: prepSec * 1000 });
    t += prepSec * 1000;
    phases.push({ kind: 'hold', stepIndex: i, startMs: t, durMs: st.holdSec * 1000 });
    t += st.holdSec * 1000;
  });
  return { phases, totalMs: t };
}

/** Where `elapsedMs` falls on the timeline. */
export function locate(tl: Timeline, elapsedMs: number): Position {
  const e = Math.max(0, elapsedMs);
  if (e >= tl.totalMs) {
    return { index: tl.phases.length, phase: null, phaseElapsedMs: 0, remainingMs: 0, done: true };
  }
  // Phases are few (< 50); a linear scan is plenty.
  for (let i = 0; i < tl.phases.length; i++) {
    const ph = tl.phases[i]!;
    if (e < ph.startMs + ph.durMs) {
      const phaseElapsedMs = e - ph.startMs;
      return {
        index: i,
        phase: ph,
        phaseElapsedMs,
        remainingMs: ph.durMs - phaseElapsedMs,
        done: false,
      };
    }
  }
  return { index: tl.phases.length, phase: null, phaseElapsedMs: 0, remainingMs: 0, done: true };
}

function prepStart(tl: Timeline, stepIndex: number): number {
  const ph = tl.phases.find((p) => p.kind === 'prep' && p.stepIndex === stepIndex);
  return ph ? ph.startMs : tl.totalMs;
}

/** Skip: jump to the transition into the next step (or the end). */
export function skipTarget(tl: Timeline, elapsedMs: number): number {
  const pos = locate(tl, elapsedMs);
  if (pos.done || !pos.phase) return tl.totalMs;
  return prepStart(tl, pos.phase.stepIndex + 1);
}

/**
 * Back: restart the current step (from its get-ready) if more than 3 s into
 * its hold, otherwise go to the previous step's get-ready.
 */
export function backTarget(tl: Timeline, elapsedMs: number): number {
  const pos = locate(tl, elapsedMs);
  if (pos.done || !pos.phase) {
    const last = tl.phases[tl.phases.length - 1];
    return last ? prepStart(tl, last.stepIndex) : 0;
  }
  const { stepIndex, kind } = pos.phase;
  if (kind === 'hold' && pos.phaseElapsedMs > 3000) return prepStart(tl, stepIndex);
  return prepStart(tl, Math.max(0, stepIndex - 1));
}
