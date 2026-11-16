import {
  EQUIPMENT,
  FLOOR_POSTURE_ORDER,
  type BodyArea,
  type Equipment,
  type FloorPosture,
  type Reps,
  type Routine,
  type RoutineMode,
  type RoutineStep,
  type Stretch,
  type StretchPosition,
  type WarmupLift,
} from './types.ts';
import { resolveStretch } from './variant.ts';
// Functions and constants from generator.ts are only used inside functions
// here (generator.ts imports this module back), never at module load.
import { TRANSITION_SEC, mulberry32, routineSeconds } from './generator.ts';

/**
 * Routine types. A routine of a non-focus mode is built from an ordered
 * TEMPLATE of slots ({@link ModeSlot}); each slot is filled by a seeded pick
 * from the mode's pool, so the routine has a deliberate shape (warm the spine
 * and hips, then the lift; neck to hamstrings at the desk; wind down to the
 * floor and finish on the back) rather than a bag of areas.
 *
 * Pool: a stretch is in a mode's pool when its kind matches (warm-up: only
 * `kind: 'dynamic'`; the others: anything but dynamic), it is `calming` when
 * the mode requires it, its RESOLVED position (see equipment below) is one
 * the mode allows, and none of its equipment is excluded.
 *
 * Equipment: a stretch's equipment is `equipment` plus the chair whenever it
 * is authored `position: 'seated'` (seated means on a chair; seated on the
 * floor is 'floor'), so chair exclusion works even on stretches without
 * metadata. A stretch needing an excluded item is left out, EXCEPT one whose
 * only excluded item is the chair and which has a `noChair` variant: it is
 * used in that variant (`step.noChair = true`) and placed by the variant's
 * position. Wind-down always excludes the chair.
 *
 * Building (deterministic per seed; recency only breaks ties):
 *   1. Core slots, by fill priority: the slot's best candidate (preferred
 *      ids, then primary-area matches, then any listed area; then the mode's
 *      preferred positions; then not done recently; then seeded) when it fits
 *      at minimum holds, else its best one-sided candidate, else the slot is
 *      trimmed for time. A slot with no candidate at all is reported in
 *      {@link Routine.skippedSlots}.
 *   2. Reps (midday 2x): a second rep for each core pick, by priority, while
 *      it fits at minimum holds. Continuous movements never repeat.
 *   3. Optional slots, by priority, while they fit at the mode's preferred
 *      hold.
 *   4. Extras: further picks, round-robin over the slots by priority, while
 *      they fit at the preferred hold; then, only if the holds' caps still
 *      cannot fill the time, while they fit at minimum holds.
 *   5. Holds: one level for every pick, clamped to each pick's range, solved
 *      so the total lands on the target, rounded and nudged by whole seconds.
 *   6. Order by the mode's rule ({@link ModeProfile.order}).
 */

/** The non-focus modes, which are built from templates. */
export type TemplateMode = Exclude<RoutineMode, 'focus'>;

/** One slot of a mode's template. */
export interface ModeSlot {
  id: string;
  /** Human label, reported in {@link Routine.skippedSlots}. */
  label: string;
  /**
   * Areas that fill it: a stretch whose primary area is listed ranks before
   * one that only lists one. Empty = any area.
   */
  areas: readonly BodyArea[];
  /** Resolved positions allowed in this slot; absent = the mode's. */
  positions?: readonly StretchPosition[];
  /** Floor postures allowed in this slot (floor stretches only); absent = any. */
  postures?: readonly FloorPosture[];
  /**
   * Positions (and floor postures) used only when nothing qualifies in the
   * slot's own positions: e.g. midday neck work on the floor when the chair is
   * left out and the neck stretches' no-chair variants are floor-seated.
   */
  fallback?: { positions: readonly StretchPosition[]; postures?: readonly FloorPosture[] };
  /** Warm-up only: candidates must list the routine's lift in `warmupFor`. */
  forLift?: true;
  /** Ids preferred over every other candidate (soft). */
  prefer?: readonly string[];
  /** Always filled when time allows; optional slots only when there is room. */
  core: boolean;
  /** Fill order (lowest first); the lowest priority is trimmed first when short. */
  priority: number;
  /** Ordered at the very end of the routine (wind-down finisher). */
  last?: true;
}

/** Everything that makes one mode what it is. */
export interface ModeProfile {
  mode: TemplateMode;
  label: string;
  minMinutes: number;
  maxMinutes: number;
  defaultMinutes: number;
  /** 'dynamic' = only dynamic movements; 'static' = anything but dynamic. */
  kind: 'static' | 'dynamic';
  /** Only `calming` stretches. */
  calmingOnly: boolean;
  /** Resolved positions the mode allows at all. */
  positions: readonly StretchPosition[];
  /** Candidate preference among allowed positions (lower first). */
  positionPreference: (pos: StretchPosition, posture?: FloorPosture) => number;
  minHold: number;
  maxHold: number;
  /** The hold optional slots and extras are sized at. */
  prefHold: number;
  /** Ceiling (and floor) for a neck-primary stretch. */
  neckMaxHold: number;
  reps: readonly Reps[];
  defaultReps: Reps;
  /** Always excluded, whatever the user picks. */
  implicitExcluded: readonly Equipment[];
  /** Routine carries the slow-breathing hint. */
  breathing: boolean;
  /** The template for an optional warm-up lift. */
  slots: (lift?: WarmupLift) => readonly ModeSlot[];
  /**
   * 'template': template order (warm-up; its lift slots form one group
   * ordered broad first, most lift-specific last).
   * 'upright-then-ground': standing/seated picks in template order, then
   * kneeling, then floor (by posture): once down, stay down.
   * 'winddown': kneeling, floor sitting, side-lying, prone, then supine, with
   * the finisher slot last.
   */
  order: 'template' | 'upright-then-ground' | 'winddown';
}

/**
 * The neck ceiling for every mode, as a literal: MODE_PROFILES is built at
 * module load, when generator.ts (which imports this module back) may not be
 * initialised yet. Kept equal to generator's NECK_MAX_HOLD_SEC (asserted in
 * the tests).
 */
export const MODE_NECK_MAX_HOLD_SEC = 30;

const UPRIGHT: readonly StretchPosition[] = ['standing', 'seated'];
const ALL_POSITIONS: readonly StretchPosition[] = ['standing', 'seated', 'kneeling', 'floor'];
const GROUND: readonly StretchPosition[] = ['kneeling', 'floor'];

const WARMUP_GENERAL: readonly ModeSlot[] = [
  { id: 'spine', label: 'Spine', areas: ['upperBack', 'lowerBack'], core: true, priority: 1 },
  { id: 'hips', label: 'Hips', areas: ['hips', 'glutes'], core: true, priority: 2 },
  {
    id: 'shoulders',
    label: 'Shoulders',
    areas: ['shoulders', 'upperBack', 'chest'],
    core: true,
    priority: 3,
  },
  {
    id: 'legs',
    label: 'Legs',
    areas: ['hamstrings', 'quads', 'calves', 'glutes'],
    core: true,
    priority: 4,
  },
];

const WARMUP_LIFT: readonly ModeSlot[] = [
  { id: 'spine', label: 'Spine', areas: ['upperBack', 'lowerBack'], core: true, priority: 3 },
  { id: 'hips', label: 'Hips', areas: ['hips', 'glutes'], core: true, priority: 4 },
  { id: 'lift-a', label: 'Lift prep', areas: [], forLift: true, core: true, priority: 1 },
  { id: 'lift-b', label: 'Lift prep 2', areas: [], forLift: true, core: true, priority: 2 },
  { id: 'lift-c', label: 'Lift prep 3', areas: [], forLift: true, core: false, priority: 5 },
];

const MIDDAY: readonly ModeSlot[] = [
  {
    id: 'neck',
    label: 'Neck',
    areas: ['neck'],
    positions: UPRIGHT,
    fallback: { positions: ['floor'], postures: ['sitting'] },
    core: true,
    priority: 1,
  },
  { id: 'upperBack', label: 'Upper back', areas: ['upperBack'], core: true, priority: 2 },
  {
    id: 'chest',
    label: 'Chest opener',
    areas: ['chest'],
    positions: UPRIGHT,
    core: true,
    priority: 3,
  },
  {
    id: 'shoulders',
    label: 'Shoulders',
    areas: ['shoulders'],
    positions: UPRIGHT,
    core: true,
    priority: 5,
  },
  { id: 'hips', label: 'Hips', areas: ['hips', 'glutes'], core: true, priority: 4 },
  {
    id: 'hamstrings',
    label: 'Hamstrings',
    areas: ['hamstrings'],
    positions: UPRIGHT,
    core: true,
    priority: 6,
  },
  {
    id: 'wrists',
    label: 'Wrists',
    areas: ['wristsForearms'],
    positions: UPRIGHT,
    core: false,
    priority: 8,
  },
  { id: 'lowerBack', label: 'Lower back', areas: ['lowerBack'], core: false, priority: 7 },
];

/** The ids a wind-down prefers to finish on (soft: any supine stretch qualifies). */
export const WINDDOWN_FINISHERS: readonly string[] = [
  'supine-twist',
  'double-knee-chest',
  'knee-to-chest',
];

const WINDDOWN: readonly ModeSlot[] = [
  { id: 'neck', label: 'Gentle neck', areas: ['neck'], core: true, priority: 3 },
  { id: 'upperBack', label: 'Upper back', areas: ['upperBack'], core: true, priority: 4 },
  { id: 'hips', label: 'Hips', areas: ['hips', 'glutes'], core: true, priority: 2 },
  { id: 'hamstrings', label: 'Hamstrings', areas: ['hamstrings'], core: true, priority: 5 },
  { id: 'lowerBack', label: 'Lower back', areas: ['lowerBack'], core: true, priority: 6 },
  {
    id: 'finish',
    label: 'Lying finish',
    areas: [],
    positions: ['floor'],
    postures: ['supine'],
    prefer: WINDDOWN_FINISHERS,
    core: true,
    priority: 1,
    last: true,
  },
];

export const MODE_PROFILES: Record<TemplateMode, ModeProfile> = {
  warmup: {
    mode: 'warmup',
    label: 'Warm-up',
    minMinutes: 3,
    maxMinutes: 6,
    defaultMinutes: 4,
    kind: 'dynamic',
    calmingOnly: false,
    positions: ALL_POSITIONS,
    // Standing and kneeling preferred; floor (and a chair) allowed.
    positionPreference: (pos) => (pos === 'standing' || pos === 'kneeling' ? 0 : 1),
    minHold: 30,
    maxHold: 45,
    prefHold: 35,
    neckMaxHold: MODE_NECK_MAX_HOLD_SEC,
    reps: [1],
    defaultReps: 1,
    implicitExcluded: [],
    breathing: false,
    slots: (lift) => (lift ? WARMUP_LIFT : WARMUP_GENERAL),
    order: 'template',
  },
  midday: {
    mode: 'midday',
    label: 'Midday',
    minMinutes: 3,
    maxMinutes: 6,
    defaultMinutes: 5,
    kind: 'static',
    calmingOnly: false,
    positions: ALL_POSITIONS,
    positionPreference: (pos) => (pos === 'standing' || pos === 'seated' ? 0 : 1),
    minHold: 20,
    maxHold: 30,
    prefHold: 25,
    neckMaxHold: MODE_NECK_MAX_HOLD_SEC,
    reps: [1, 2],
    defaultReps: 1,
    implicitExcluded: [],
    breathing: false,
    slots: () => MIDDAY,
    order: 'upright-then-ground',
  },
  winddown: {
    mode: 'winddown',
    label: 'Wind-down',
    minMinutes: 6,
    maxMinutes: 12,
    defaultMinutes: 9,
    kind: 'static',
    calmingOnly: true,
    positions: GROUND,
    positionPreference: () => 0,
    minHold: 45,
    maxHold: 60,
    prefHold: 50,
    neckMaxHold: MODE_NECK_MAX_HOLD_SEC,
    reps: [1],
    defaultReps: 1,
    implicitExcluded: ['chair'],
    breathing: true,
    slots: () => WINDDOWN,
    order: 'winddown',
  },
};

export const MODE_LABELS: Record<RoutineMode, string> = {
  warmup: 'Warm-up',
  midday: 'Midday',
  winddown: 'Wind-down',
  focus: 'Focused',
};

export const WARMUP_LIFT_LABELS: Record<WarmupLift, string> = {
  press: 'Press',
  bench: 'Bench',
  squat: 'Squat',
  deadlift: 'Deadlift',
};

export const WARMUP_LIFTS: readonly WarmupLift[] = ['press', 'bench', 'squat', 'deadlift'];

export function isWarmupLift(v: unknown): v is WarmupLift {
  return typeof v === 'string' && (WARMUP_LIFTS as readonly string[]).includes(v);
}

export function isRoutineMode(v: unknown): v is RoutineMode {
  return v === 'warmup' || v === 'midday' || v === 'winddown' || v === 'focus';
}

export function isEquipment(v: unknown): v is Equipment {
  return typeof v === 'string' && (EQUIPMENT as readonly string[]).includes(v);
}

/** Anything → a mode's whole minutes (its default when not a number). */
export function clampModeMinutes(mode: TemplateMode, minutes: unknown): number {
  const p = MODE_PROFILES[mode];
  if (typeof minutes !== 'number' || Number.isNaN(minutes)) return p.defaultMinutes;
  return Math.min(p.maxMinutes, Math.max(p.minMinutes, Math.round(minutes)));
}

/**
 * The mode the Stretch screen highlights at this local time: Midday from
 * 10:00 to 17:00, Wind-down from 20:00 until 04:00, otherwise Focused.
 * Warm-up is never suggested by the clock (training times vary).
 */
export function suggestedMode(d: Date): RoutineMode {
  const h = d.getHours();
  if (h >= 10 && h < 17) return 'midday';
  if (h >= 20 || h < 4) return 'winddown';
  return 'focus';
}

// --- Equipment and pools -------------------------------------------------------

/** What a stretch needs: its `equipment`, plus the chair when authored seated. */
export function effectiveEquipment(s: Stretch): Equipment[] {
  const eq = new Set<Equipment>(s.equipment ?? []);
  if (s.position === 'seated') eq.add('chair');
  return EQUIPMENT.filter((e) => eq.has(e));
}

/** A stretch as a routine would use it under the given exclusions. */
export interface PoolItem {
  s: Stretch;
  /** Used in its no-chair variant. */
  noChair: boolean;
  position: StretchPosition;
  posture?: FloorPosture;
}

/**
 * How `s` can be used with `excluded` equipment ruled out: as authored, in its
 * no-chair variant (only the chair is in the way and a variant exists that is
 * not itself on a chair), or not at all (null).
 */
export function usableAs(s: Stretch, excluded: ReadonlySet<Equipment>): PoolItem | null {
  const needs = effectiveEquipment(s);
  const blocked = needs.filter((e) => excluded.has(e));
  if (blocked.length === 0) {
    return { s, noChair: false, position: s.position, posture: s.posture };
  }
  if (blocked.length === 1 && blocked[0] === 'chair' && s.noChair) {
    const r = resolveStretch(s, true);
    if (r.position === 'seated') return null;
    return { s, noChair: true, position: r.position, posture: r.posture };
  }
  return null;
}

/** Normalise an exclusion list: known items only, canonical order, no repeats. */
export function normalizeExcluded(excluded: readonly unknown[] | undefined): Equipment[] {
  const set = new Set((excluded ?? []).filter(isEquipment));
  return EQUIPMENT.filter((e) => set.has(e));
}

/** Kind and calm checks for a mode, before equipment and position. */
function fitsModeKind(p: ModeProfile, s: Stretch): boolean {
  const dynamic = s.kind === 'dynamic';
  if (p.kind === 'dynamic' ? !dynamic : dynamic) return false;
  if (p.calmingOnly && s.calming !== true) return false;
  return true;
}

/** Every pool item a mode can use with these exclusions (implicit ones added). */
export function modePool(
  mode: TemplateMode,
  library: readonly Stretch[],
  excluded: readonly Equipment[] = [],
): PoolItem[] {
  const p = MODE_PROFILES[mode];
  const ex = new Set<Equipment>([...excluded, ...p.implicitExcluded]);
  const out: PoolItem[] = [];
  for (const s of library) {
    if (!fitsModeKind(p, s)) continue;
    const item = usableAs(s, ex);
    if (!item || !p.positions.includes(item.position)) continue;
    out.push(item);
  }
  return out;
}

/**
 * The equipment worth offering as an exclusion chip for a mode: what the
 * stretches it could use actually need (implicit exclusions not offered).
 * 'focus' covers every non-dynamic stretch.
 */
export function modeEquipment(mode: RoutineMode, library: readonly Stretch[]): Equipment[] {
  const seen = new Set<Equipment>();
  if (mode === 'focus') {
    for (const s of library) {
      if (!inFocusPool(s)) continue;
      for (const e of effectiveEquipment(s)) seen.add(e);
    }
    return EQUIPMENT.filter((e) => seen.has(e));
  }
  const p = MODE_PROFILES[mode];
  for (const s of library) {
    if (!fitsModeKind(p, s)) continue;
    // Usable at all with only the implicit exclusions applied?
    const item = usableAs(s, new Set(p.implicitExcluded));
    if (!item || !p.positions.includes(item.position)) continue;
    for (const e of effectiveEquipment(s)) if (!p.implicitExcluded.includes(e)) seen.add(e);
  }
  return EQUIPMENT.filter((e) => seen.has(e));
}

/**
 * Dynamic movements a focus routine still uses. Cat-cow was a staple of
 * focus routines (a slow, continuous mobility movement) before the library
 * also tagged it as a warm-up movement; the warm-up drills (leg swings, band
 * work, inchworms) stay out of stretching routines.
 */
export const FOCUS_DYNAMIC_IDS: readonly string[] = ['cat-cow'];

/** Whether the focus builder may use this stretch at all. */
export function inFocusPool(s: Stretch): boolean {
  return s.kind !== 'dynamic' || FOCUS_DYNAMIC_IDS.includes(s.id);
}

/**
 * The library a focus routine is built from: static stretches (plus
 * {@link FOCUS_DYNAMIC_IDS}) usable
 * under the exclusions, chair stretches in their no-chair variant rewritten to
 * the variant's position, plus the ids done that way.
 */
export function focusLibrary(
  library: readonly Stretch[],
  excluded: readonly Equipment[],
): { library: Stretch[]; noChairIds: Set<string> } {
  const ex = new Set(excluded);
  const out: Stretch[] = [];
  const noChairIds = new Set<string>();
  for (const s of library) {
    if (!inFocusPool(s)) continue;
    if (ex.size === 0) {
      out.push(s);
      continue;
    }
    const item = usableAs(s, ex);
    if (!item) continue;
    if (item.noChair) {
      noChairIds.add(s.id);
      const clone: Stretch = { ...s, position: item.position };
      if (item.posture) clone.posture = item.posture;
      else delete clone.posture;
      out.push(clone);
    } else {
      out.push(s);
    }
  }
  return { library: out, noChairIds };
}

// --- Template generator ------------------------------------------------------------

export interface TemplateOptions {
  mode: TemplateMode;
  minutes: number;
  seed: number;
  excluded?: readonly Equipment[];
  /** Warm-up only. */
  lift?: WarmupLift;
  reps?: Reps;
  recentStretchIds?: readonly string[];
  library: readonly Stretch[];
}

interface Pick {
  item: PoolItem;
  slot: number;
  reps: number;
  order: number;
}

/** Hold range of a pick in this mode. */
function holdRange(p: ModeProfile, s: Stretch): { lo: number; hi: number; pref: number } {
  const neck = s.areas[0] === 'neck';
  const lo = neck ? Math.min(p.minHold, p.neckMaxHold) : p.minHold;
  const hi = neck ? Math.min(p.maxHold, p.neckMaxHold) : p.maxHold;
  return { lo, hi, pref: Math.min(hi, Math.max(lo, p.prefHold)) };
}

const PREF_SLACK_SEC = 15;

/** Build a routine for a template mode. See the module doc. */
export function generateTemplateRoutine(opts: TemplateOptions): Routine {
  const p = MODE_PROFILES[opts.mode];
  const minutes = clampModeMinutes(opts.mode, opts.minutes);
  const target = minutes * 60;
  const seed = Number.isFinite(opts.seed) ? opts.seed : 0;
  const lift = opts.mode === 'warmup' && isWarmupLift(opts.lift) ? opts.lift : undefined;
  const repsWanted: Reps = opts.reps && p.reps.includes(opts.reps) ? opts.reps : p.defaultReps;
  const userExcluded = normalizeExcluded(opts.excluded);
  const excluded = normalizeExcluded([...userExcluded, ...p.implicitExcluded]);
  const recent = new Set(opts.recentStretchIds ?? []);
  const pool = modePool(opts.mode, opts.library, excluded);
  const slots = p.slots(lift);

  // One jitter value per library stretch, in library order, so the stream
  // does not depend on the order picks happen in.
  const rng = mulberry32(seed);
  const jitter = new Map<string, number>();
  for (const s of opts.library) jitter.set(s.id, rng());

  const qualifies = (slot: ModeSlot, it: PoolItem, useFallback = false): boolean => {
    const positions = useFallback ? slot.fallback!.positions : (slot.positions ?? p.positions);
    const postures = useFallback ? slot.fallback!.postures : slot.postures;
    if (!positions.includes(it.position)) return false;
    if (postures && (it.position !== 'floor' || !it.posture || !postures.includes(it.posture)))
      return false;
    if (slot.forLift && !(lift && it.s.warmupFor?.includes(lift))) return false;
    if (slot.areas.length > 0 && !it.s.areas.some((a) => slot.areas.includes(a))) return false;
    return true;
  };
  const areaTier = (slot: ModeSlot, it: PoolItem): number => {
    if (slot.prefer?.includes(it.s.id)) return 0;
    if (slot.areas.length === 0) return 1;
    return slot.areas.includes(it.s.areas[0]!) ? 1 : 2;
  };
  /** Lift slots: the most lift-specific movement first. */
  const specificity = (slot: ModeSlot, it: PoolItem) =>
    slot.forLift ? (it.s.warmupFor?.length ?? 0) : 0;
  const candidates: PoolItem[][] = slots.map((slot) => {
    let fits = pool.filter((it) => qualifies(slot, it));
    if (fits.length === 0 && slot.fallback) fits = pool.filter((it) => qualifies(slot, it, true));
    return fits.sort(
      (a, b) =>
        areaTier(slot, a) - areaTier(slot, b) ||
        specificity(slot, a) - specificity(slot, b) ||
        p.positionPreference(a.position, a.posture) - p.positionPreference(b.position, b.posture) ||
        (recent.has(a.s.id) ? 1 : 0) - (recent.has(b.s.id) ? 1 : 0) ||
        (jitter.get(b.s.id) ?? 0) - (jitter.get(a.s.id) ?? 0),
    );
  });

  const picks: Pick[] = [];
  const used = new Set<string>();
  const sides = (s: Stretch) => (s.bilateral ? 2 : 1);
  const costAt = (which: 'lo' | 'hi' | 'pref', extra?: { item: PoolItem; reps: number }) => {
    let n = 0;
    const add = (s: Stretch, reps: number) => {
      n += sides(s) * reps * (holdRange(p, s)[which] + TRANSITION_SEC);
    };
    for (const pk of picks) add(pk.item.s, pk.reps);
    if (extra) add(extra.item.s, extra.reps);
    return n;
  };
  const repsFor = (s: Stretch) => (s.continuous || s.kind === 'dynamic' ? 1 : repsWanted);
  const add = (slot: number, item: PoolItem, reps: number) => {
    picks.push({ item, slot, reps, order: picks.length });
    used.add(item.s.id);
  };
  const free = (slot: number) => candidates[slot]!.filter((it) => !used.has(it.s.id));

  const byPriority = slots
    .map((slot, i) => ({ slot, i }))
    .sort((a, b) => a.slot.priority - b.slot.priority || a.i - b.i);
  const skipped = new Set<number>();
  for (let i = 0; i < slots.length; i++) if (candidates[i]!.length === 0) skipped.add(i);

  // 1. Core slots, at minimum holds and one rep.
  for (const { slot, i } of byPriority) {
    if (!slot.core) continue;
    const cands = free(i);
    const first = cands[0];
    if (!first) continue;
    const fits = (it: PoolItem) => costAt('lo', { item: it, reps: 1 }) <= target;
    const choice = fits(first) ? first : cands.find((it) => !it.s.bilateral && fits(it));
    if (choice) add(i, choice, 1);
  }

  // 2. Further reps for the core picks, by slot priority.
  if (repsWanted > 1) {
    const prio = (pk: Pick) => slots[pk.slot]!.priority;
    for (const pk of [...picks].sort((a, b) => prio(a) - prio(b) || a.order - b.order)) {
      const want = repsFor(pk.item.s);
      while (pk.reps < want) {
        const more = sides(pk.item.s) * (holdRange(p, pk.item.s).lo + TRANSITION_SEC);
        if (costAt('lo') + more > target) break;
        pk.reps++;
      }
    }
  }

  const fitsPref = (it: PoolItem, reps: number) =>
    costAt('pref', { item: it, reps }) <= target + PREF_SLACK_SEC &&
    costAt('lo', { item: it, reps }) <= target;
  /** Entering reps for a new pick: the wanted reps when they fit, else one. */
  const entryReps = (it: PoolItem, test: (it: PoolItem, r: number) => boolean) => {
    const r = repsFor(it.s);
    if (test(it, r)) return r;
    return r > 1 && test(it, 1) ? 1 : 0;
  };

  // 3. Optional slots.
  for (const { slot, i } of byPriority) {
    if (slot.core) continue;
    for (const it of free(i)) {
      const r = entryReps(it, fitsPref);
      if (r > 0) {
        add(i, it, r);
        break;
      }
    }
  }

  // 4. Extras, round-robin over the slots by priority.
  const extras = (test: (it: PoolItem, r: number) => boolean, until: () => boolean) => {
    let cursor = 0;
    for (let guard = 0; guard < pool.length + 1 && !until(); guard++) {
      let added = false;
      for (let k = 0; k < byPriority.length; k++) {
        const { i } = byPriority[(cursor + k) % byPriority.length]!;
        const it = free(i).find((x) => entryReps(x, test) > 0);
        if (!it) continue;
        add(i, it, entryReps(it, test));
        cursor = (cursor + k + 1) % byPriority.length;
        added = true;
        break;
      }
      if (!added) break;
    }
  };
  extras(fitsPref, () => false);
  extras(
    (it, r) => costAt('lo', { item: it, reps: r }) <= target,
    () => costAt('hi') >= target,
  );

  // 5. Holds: one level L for every pick, clamped to its range.
  const steps = picks.reduce((n, pk) => n + sides(pk.item.s) * pk.reps, 0);
  const H = target - TRANSITION_SEC * steps;
  const ranges = new Map(picks.map((pk) => [pk.item.s.id, holdRange(p, pk.item.s)]));
  const stepsOf = (pk: Pick) => sides(pk.item.s) * pk.reps;
  const at = (L: number, pk: Pick) => {
    const r = ranges.get(pk.item.s.id)!;
    return Math.min(r.hi, Math.max(r.lo, L));
  };
  let a = 0;
  let z = 200;
  for (let k = 0; k < 60; k++) {
    const m = (a + z) / 2;
    if (picks.reduce((n, pk) => n + stepsOf(pk) * at(m, pk), 0) < H) a = m;
    else z = m;
  }
  const holdOf = new Map<string, number>();
  for (const pk of picks) holdOf.set(pk.item.s.id, Math.round(at(z, pk)));
  let diff = H - picks.reduce((n, pk) => n + stepsOf(pk) * holdOf.get(pk.item.s.id)!, 0);
  for (let guard = 0; guard < 400 && diff !== 0; guard++) {
    const dirn = diff > 0 ? 1 : -1;
    const pk = picks.find((x) => {
      const h = holdOf.get(x.item.s.id)!;
      const r = ranges.get(x.item.s.id)!;
      return stepsOf(x) <= Math.abs(diff) && (dirn > 0 ? h < r.hi : h > r.lo);
    });
    if (!pk) break;
    holdOf.set(pk.item.s.id, holdOf.get(pk.item.s.id)! + dirn);
    diff -= dirn * stepsOf(pk);
  }

  // 6. Order.
  const display = (pk: Pick) => {
    const slot = slots[pk.slot]!;
    // Warm-up lift slots form one group at the first lift slot's place.
    if (slot.forLift) return slots.findIndex((s) => s.forLift);
    return pk.slot;
  };
  const groundRank = (pk: Pick) => {
    const it = pk.item;
    if (it.position === 'kneeling') return 0;
    if (it.position === 'floor') return 1 + FLOOR_POSTURE_ORDER.indexOf(it.posture ?? 'sitting');
    return -1;
  };
  const winddownRank = (pk: Pick) => {
    const it = pk.item;
    if (it.position !== 'floor') return 0;
    switch (it.posture) {
      case 'supine':
        return 4;
      case 'prone':
        return 3;
      case 'sideLying':
        return 2;
      default:
        return 1;
    }
  };
  const key = (pk: Pick): number[] => {
    const slot = slots[pk.slot]!;
    const spec = slot.forLift ? -(pk.item.s.warmupFor?.length ?? 0) : 0;
    switch (p.order) {
      case 'template':
        return [display(pk), spec, pk.order];
      case 'upright-then-ground': {
        const g = groundRank(pk);
        return [g < 0 ? 0 : 1, g, display(pk), pk.order];
      }
      case 'winddown':
        return [slot.last ? 1 : 0, winddownRank(pk), display(pk), pk.order];
    }
  };
  const cmp = (x: Pick, y: Pick) => {
    const kx = key(x);
    const ky = key(y);
    for (let k = 0; k < kx.length; k++) if (kx[k] !== ky[k]) return kx[k]! - ky[k]!;
    return 0;
  };
  const ordered = [...picks].sort(cmp);

  const out: RoutineStep[] = [];
  for (const pk of ordered) {
    const s = pk.item.s;
    const holdSec = holdOf.get(s.id)!;
    const nc = pk.item.noChair ? { noChair: true as const } : {};
    for (let rep = 1; rep <= pk.reps; rep++) {
      const r = pk.reps > 1 ? { rep, repOf: pk.reps } : {};
      if (s.bilateral) {
        out.push({ stretchId: s.id, side: 'left', holdSec, ...r, ...nc });
        out.push({ stretchId: s.id, side: 'right', holdSec, ...r, ...nc });
      } else {
        out.push({ stretchId: s.id, holdSec, ...r, ...nc });
      }
    }
  }

  const routine: Routine = {
    minutes,
    focusAreas: [],
    seed: opts.seed,
    mode: opts.mode,
    excluded,
    reps: repsWanted,
    steps: out,
    totalSec: routineSeconds(out),
    droppedAreas: [],
    skippedSlots: [...skipped].sort((x, y) => x - y).map((i) => slots[i]!.label),
  };
  if (lift) routine.lift = lift;
  if (p.breathing) routine.breathing = true;
  return routine;
}
