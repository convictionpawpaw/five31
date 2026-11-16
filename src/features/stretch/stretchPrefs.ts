import { isBodyArea, type BodyArea, type Reps } from '../../core/stretch/types.ts';
import { DEFAULT_REPS, MAX_MINUTES, MIN_MINUTES } from '../../core/stretch/generator.ts';

/**
 * Per-device conveniences for the Stretch screen (last duration, last focus,
 * repeats, mute). Stored in localStorage on purpose: losing them is harmless, so they
 * stay out of the database and the backup. Every access is guarded because
 * storage can be unavailable (private mode, blocked site data).
 */
export interface StretchPrefs {
  minutes: number;
  focusAreas: BodyArea[];
  /** Repeats per stretch (1x / 2x / 3x). */
  reps: Reps;
  muted: boolean;
}

const KEY = 'five31.stretch.prefs';
export const DEFAULT_MINUTES = 7;

const DEFAULTS: StretchPrefs = {
  minutes: DEFAULT_MINUTES,
  focusAreas: [],
  reps: DEFAULT_REPS,
  muted: false,
};

/** Read prefs, falling back to defaults for anything missing or malformed. */
export function loadStretchPrefs(): StretchPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const v = JSON.parse(raw) as Partial<Record<keyof StretchPrefs, unknown>>;
    const minutes =
      typeof v.minutes === 'number' && v.minutes >= MIN_MINUTES && v.minutes <= MAX_MINUTES
        ? Math.round(v.minutes)
        : DEFAULTS.minutes;
    const focusAreas = Array.isArray(v.focusAreas) ? v.focusAreas.filter(isBodyArea) : [];
    const reps: Reps = v.reps === 1 || v.reps === 2 || v.reps === 3 ? v.reps : DEFAULTS.reps;
    const muted = typeof v.muted === 'boolean' ? v.muted : false;
    return { minutes, focusAreas, reps, muted };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Merge and persist a partial update; silently ignores storage failures. */
export function saveStretchPrefs(patch: Partial<StretchPrefs>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadStretchPrefs(), ...patch }));
  } catch {
    // Storage unavailable: preferences just won't stick.
  }
}
