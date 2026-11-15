import { isBodyArea, type BodyArea } from '../../core/stretch/types.ts';
import { MAX_MINUTES, MIN_MINUTES } from '../../core/stretch/generator.ts';

/**
 * Per-device conveniences for the Stretch screen (last duration, last focus,
 * mute). Stored in localStorage on purpose: losing them is harmless, so they
 * stay out of the database and the backup. Every access is guarded because
 * storage can be unavailable (private mode, blocked site data).
 */
export interface StretchPrefs {
  minutes: number;
  focusAreas: BodyArea[];
  muted: boolean;
}

const KEY = 'five31.stretch.prefs';
export const DEFAULT_MINUTES = 7;

const DEFAULTS: StretchPrefs = { minutes: DEFAULT_MINUTES, focusAreas: [], muted: false };

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
    const muted = typeof v.muted === 'boolean' ? v.muted : false;
    return { minutes, focusAreas, muted };
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
