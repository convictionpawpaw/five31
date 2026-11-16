import {
  ROUTINE_MODES,
  isBodyArea,
  type BodyArea,
  type Equipment,
  type Reps,
  type RoutineMode,
} from '../../core/stretch/types.ts';
import { DEFAULT_REPS, MAX_MINUTES, MIN_MINUTES } from '../../core/stretch/generator.ts';
import {
  MODE_PROFILES,
  clampModeMinutes,
  normalizeExcluded,
  type TemplateMode,
} from '../../core/stretch/modes.ts';

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
  /** Minutes per template mode (focus keeps `minutes`). */
  modeMinutes: Record<TemplateMode, number>;
  /** Equipment left out, remembered per mode. */
  excluded: Record<RoutineMode, Equipment[]>;
  /** Midday repeats (1x / 2x). */
  middayReps: Reps;
}

const KEY = 'five31.stretch.prefs';
export const DEFAULT_MINUTES = 7;

const TEMPLATE_MODES: readonly TemplateMode[] = ['warmup', 'midday', 'winddown'];

function defaultModeMinutes(): Record<TemplateMode, number> {
  return {
    warmup: MODE_PROFILES.warmup.defaultMinutes,
    midday: MODE_PROFILES.midday.defaultMinutes,
    winddown: MODE_PROFILES.winddown.defaultMinutes,
  };
}

function noExclusions(): Record<RoutineMode, Equipment[]> {
  return { warmup: [], midday: [], winddown: [], focus: [] };
}

const DEFAULTS: StretchPrefs = {
  minutes: DEFAULT_MINUTES,
  focusAreas: [],
  reps: DEFAULT_REPS,
  muted: false,
  modeMinutes: defaultModeMinutes(),
  excluded: noExclusions(),
  middayReps: MODE_PROFILES.midday.defaultReps,
};

function fresh(): StretchPrefs {
  return { ...DEFAULTS, modeMinutes: defaultModeMinutes(), excluded: noExclusions() };
}

/** Read prefs, falling back to defaults for anything missing or malformed. */
export function loadStretchPrefs(): StretchPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const v = JSON.parse(raw) as Partial<Record<keyof StretchPrefs, unknown>>;
    const minutes =
      typeof v.minutes === 'number' && v.minutes >= MIN_MINUTES && v.minutes <= MAX_MINUTES
        ? Math.round(v.minutes)
        : DEFAULTS.minutes;
    const focusAreas = Array.isArray(v.focusAreas) ? v.focusAreas.filter(isBodyArea) : [];
    const reps: Reps = v.reps === 1 || v.reps === 2 || v.reps === 3 ? v.reps : DEFAULTS.reps;
    const muted = typeof v.muted === 'boolean' ? v.muted : false;
    const modeMinutes = defaultModeMinutes();
    const mm = v.modeMinutes as Partial<Record<TemplateMode, unknown>> | undefined;
    for (const m of TEMPLATE_MODES) {
      if (mm && typeof mm === 'object' && typeof mm[m] === 'number') {
        modeMinutes[m] = clampModeMinutes(m, mm[m]);
      }
    }
    const excluded = noExclusions();
    const ex = v.excluded as Partial<Record<RoutineMode, unknown>> | undefined;
    for (const m of ROUTINE_MODES) {
      const list = ex && typeof ex === 'object' ? ex[m] : undefined;
      if (Array.isArray(list)) excluded[m] = normalizeExcluded(list);
    }
    const middayReps: Reps = v.middayReps === 1 || v.middayReps === 2 ? v.middayReps : 1;
    return { minutes, focusAreas, reps, muted, modeMinutes, excluded, middayReps };
  } catch {
    return fresh();
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
