import { describe, expect, it } from 'vitest';
import { NECK_MAX_HOLD_SEC, TOLERANCE_SEC, generateRoutine } from '../generator.ts';
import {
  FOCUS_DYNAMIC_IDS,
  MODE_NECK_MAX_HOLD_SEC,
  MODE_PROFILES,
  WARMUP_LIFTS,
  effectiveEquipment,
  modeEquipment,
  modePool,
  suggestedMode,
  type TemplateMode,
} from '../modes.ts';
import { STRETCHES } from '../library.ts';
import { resolveStep } from '../variant.ts';
import {
  FLOOR_POSTURE_ORDER,
  type Equipment,
  type Routine,
  type Stretch,
  type WarmupLift,
} from '../types.ts';

const HEAVY = { timeout: 120_000 };

/** Minimal stretch with sensible defaults for fixtures. */
function st(p: Partial<Stretch> & Pick<Stretch, 'id' | 'areas' | 'position'>): Stretch {
  return { name: p.id, bilateral: false, holdSec: 30, cues: ['c'], pose: p.id, ...p };
}
const dyn = (p: Partial<Stretch> & Pick<Stretch, 'id' | 'areas' | 'position'>): Stretch =>
  st({ kind: 'dynamic', continuous: true, holdSec: 40, ...p });

/** A fixture library with full metadata: dynamics, calming floor work, chair variants. */
const FIX: Stretch[] = [
  // Dynamic warm-up movements.
  dyn({
    id: 'd-cat-camel',
    areas: ['upperBack', 'lowerBack'],
    position: 'kneeling',
    warmupFor: ['press', 'bench', 'squat', 'deadlift'],
  }),
  dyn({
    id: 'd-tspine-rot',
    areas: ['upperBack'],
    position: 'kneeling',
    bilateral: true,
    warmupFor: ['press', 'bench'],
  }),
  dyn({
    id: 'd-hip-circle',
    areas: ['hips'],
    position: 'standing',
    bilateral: true,
    warmupFor: ['squat', 'deadlift'],
  }),
  dyn({
    id: 'd-worlds-greatest',
    areas: ['hips', 'hamstrings'],
    position: 'standing',
    bilateral: true,
    warmupFor: ['squat', 'deadlift'],
  }),
  dyn({
    id: 'd-band-pull-apart',
    areas: ['shoulders', 'upperBack'],
    position: 'standing',
    equipment: ['band'],
    warmupFor: ['press', 'bench'],
  }),
  dyn({
    id: 'd-band-dislocate',
    areas: ['shoulders'],
    position: 'standing',
    equipment: ['band'],
    warmupFor: ['press'],
  }),
  dyn({
    id: 'd-arm-circle',
    areas: ['shoulders'],
    position: 'standing',
    warmupFor: ['press', 'bench'],
  }),
  dyn({ id: 'd-bw-squat', areas: ['quads', 'hips'], position: 'standing', warmupFor: ['squat'] }),
  dyn({ id: 'd-hip-hinge', areas: ['hamstrings'], position: 'standing', warmupFor: ['deadlift'] }),
  dyn({
    id: 'd-leg-swing',
    areas: ['hamstrings', 'hips'],
    position: 'standing',
    bilateral: true,
    equipment: ['wall'],
    warmupFor: ['squat', 'deadlift'],
  }),
  dyn({
    id: 'd-roller-tspine',
    areas: ['upperBack'],
    position: 'floor',
    posture: 'supine',
    equipment: ['roller'],
    warmupFor: ['bench', 'press'],
  }),
  dyn({
    id: 'd-scap-pull',
    areas: ['shoulders'],
    position: 'standing',
    equipment: ['bar'],
    warmupFor: ['press', 'bench'],
  }),
  dyn({
    id: 'd-pushup-plus',
    areas: ['chest', 'shoulders'],
    position: 'kneeling',
    warmupFor: ['bench'],
  }),
  dyn({
    id: 'd-glute-bridge',
    areas: ['glutes'],
    position: 'floor',
    posture: 'supine',
    warmupFor: ['deadlift', 'squat'],
  }),
  // Static, upright.
  st({
    id: 'chin-tuck',
    areas: ['neck', 'upperBack'],
    position: 'seated',
    holdSec: 20,
    equipment: ['chair'],
    noChair: { pose: 'chin-tuck-stand', position: 'standing' },
  }),
  st({
    id: 'f-levator',
    areas: ['neck', 'upperBack'],
    position: 'seated',
    bilateral: true,
    equipment: ['chair'],
    calming: true,
    noChair: { pose: 'levator-floor', position: 'floor', posture: 'sitting', cues: ['floor cue'] },
  }),
  st({
    id: 'f-neck-rot',
    areas: ['neck'],
    position: 'seated',
    bilateral: true,
    holdSec: 20,
    calming: true,
    noChair: { pose: 'neck-rot-kneel', position: 'kneeling' },
  }),
  st({
    id: 'f-chair-twist',
    areas: ['upperBack', 'lowerBack'],
    position: 'seated',
    bilateral: true,
    equipment: ['chair'],
  }),
  st({ id: 'f-upper-reach', areas: ['upperBack', 'shoulders'], position: 'standing' }),
  st({
    id: 'f-doorway',
    areas: ['chest', 'shoulders'],
    position: 'standing',
    bilateral: true,
    equipment: ['doorway'],
  }),
  st({
    id: 'f-wall-pec',
    areas: ['chest', 'shoulders'],
    position: 'standing',
    bilateral: true,
    equipment: ['wall'],
  }),
  st({ id: 'f-clasped', areas: ['chest', 'shoulders'], position: 'standing', holdSec: 25 }),
  st({
    id: 'f-cross-body',
    areas: ['shoulders', 'upperBack'],
    position: 'standing',
    bilateral: true,
  }),
  st({
    id: 'f-overhead-tri',
    areas: ['shoulders'],
    position: 'standing',
    bilateral: true,
    holdSec: 25,
  }),
  st({ id: 'f-band-shoulder', areas: ['shoulders'], position: 'standing', equipment: ['band'] }),
  st({
    id: 'f-fig4-seated',
    areas: ['glutes', 'hips'],
    position: 'seated',
    bilateral: true,
    noChair: { pose: 'fig4-supine', position: 'floor', posture: 'supine' },
  }),
  st({
    id: 'f-standing-ham',
    areas: ['hamstrings', 'calves'],
    position: 'standing',
    bilateral: true,
  }),
  st({
    id: 'f-chair-ham',
    areas: ['hamstrings'],
    position: 'seated',
    bilateral: true,
    noChair: { pose: 'ham-stand', position: 'standing' },
  }),
  st({ id: 'f-forward-fold', areas: ['hamstrings', 'lowerBack'], position: 'standing' }),
  st({
    id: 'f-wrist',
    areas: ['wristsForearms'],
    position: 'seated',
    bilateral: true,
    holdSec: 25,
    noChair: { pose: 'wrist-stand', position: 'standing' },
  }),
  st({ id: 'f-prayer', areas: ['wristsForearms'], position: 'standing', holdSec: 20 }),
  // Static, ground.
  st({
    id: 'f-thread',
    areas: ['upperBack', 'shoulders'],
    position: 'kneeling',
    bilateral: true,
    calming: true,
  }),
  st({ id: 'f-puppy', areas: ['upperBack', 'chest'], position: 'kneeling', calming: true }),
  st({
    id: 'f-cat-cow',
    areas: ['upperBack', 'lowerBack'],
    position: 'kneeling',
    continuous: true,
    holdSec: 40,
  }),
  st({
    id: 'f-hip-flexor',
    areas: ['hips', 'quads'],
    position: 'kneeling',
    bilateral: true,
    calming: true,
  }),
  st({ id: 'f-butterfly', areas: ['hips'], position: 'floor', posture: 'sitting', calming: true }),
  st({
    id: 'f-fig4-supine',
    areas: ['glutes', 'hips'],
    position: 'floor',
    posture: 'supine',
    bilateral: true,
    calming: true,
  }),
  st({
    id: 'f-seated-ham',
    areas: ['hamstrings', 'lowerBack'],
    position: 'floor',
    posture: 'sitting',
    bilateral: true,
    calming: true,
  }),
  st({
    id: 'f-supine-ham',
    areas: ['hamstrings'],
    position: 'floor',
    posture: 'supine',
    bilateral: true,
    calming: true,
    equipment: ['band'],
  }),
  st({
    id: 'f-child',
    areas: ['lowerBack', 'upperBack', 'hips'],
    position: 'kneeling',
    holdSec: 40,
    calming: true,
  }),
  st({ id: 'f-sphinx', areas: ['lowerBack'], position: 'floor', posture: 'prone', calming: true }),
  st({
    id: 'f-side-quad',
    areas: ['quads', 'hips'],
    position: 'floor',
    posture: 'sideLying',
    bilateral: true,
    calming: true,
  }),
  st({
    id: 'f-open-book',
    areas: ['upperBack', 'chest'],
    position: 'floor',
    posture: 'sideLying',
    bilateral: true,
    calming: true,
  }),
  st({
    id: 'supine-twist',
    areas: ['lowerBack', 'glutes'],
    position: 'floor',
    posture: 'supine',
    bilateral: true,
    calming: true,
  }),
  st({
    id: 'double-knee-chest',
    areas: ['lowerBack', 'glutes'],
    position: 'floor',
    posture: 'supine',
    calming: true,
  }),
  st({
    id: 'f-roller-back',
    areas: ['upperBack'],
    position: 'floor',
    posture: 'supine',
    equipment: ['roller'],
  }),
];

const SEEDS = Array.from({ length: 30 }, (_, i) => i * 7919 + 3);
const EXCLUSIONS: Equipment[][] = [
  [],
  ['chair'],
  ['band', 'roller', 'bar'],
  ['wall', 'doorway'],
  ['chair', 'wall', 'doorway', 'band', 'roller', 'bar'],
];
const MODES: TemplateMode[] = ['warmup', 'midday', 'winddown'];

function minutesOf(mode: TemplateMode): number[] {
  const p = MODE_PROFILES[mode];
  return Array.from({ length: p.maxMinutes - p.minMinutes + 1 }, (_, i) => p.minMinutes + i);
}

interface Case {
  mode: TemplateMode;
  minutes: number;
  seed: number;
  excluded: Equipment[];
  lift?: WarmupLift;
  reps?: 1 | 2;
}

function allCases(): Case[] {
  const out: Case[] = [];
  for (const mode of MODES) {
    const lifts: (WarmupLift | undefined)[] =
      mode === 'warmup' ? [undefined, ...WARMUP_LIFTS] : [undefined];
    const repsList: (1 | 2)[] = mode === 'midday' ? [1, 2] : [1];
    for (const minutes of minutesOf(mode))
      for (const excluded of EXCLUSIONS)
        for (const lift of lifts)
          for (const reps of repsList)
            for (const seed of SEEDS) out.push({ mode, minutes, seed, excluded, lift, reps });
  }
  return out;
}

function gen(c: Case, library: readonly Stretch[]): Routine {
  return generateRoutine({ ...c, focusAreas: [], library });
}

/** Every invariant of a template routine; returns the violations. */
function violations(c: Case, r: Routine, library: readonly Stretch[]): string[] {
  const p = MODE_PROFILES[c.mode];
  const byId = new Map(library.map((s) => [s.id, s]));
  const errs: string[] = [];
  const ex = new Set<Equipment>([...c.excluded, ...p.implicitExcluded]);
  // No repeats: each stretch's steps form one contiguous run.
  const seen = new Set<string>();
  r.steps.forEach((step, i) => {
    if (i > 0 && r.steps[i - 1]!.stretchId === step.stretchId) return;
    if (seen.has(step.stretchId)) errs.push(`repeat ${step.stretchId}`);
    seen.add(step.stretchId);
  });
  let groundSeen = false;
  let lastRank = -1;
  for (const step of r.steps) {
    const s = byId.get(step.stretchId)!;
    const res = resolveStep(s, step);
    const neck = s.areas[0] === 'neck';
    const lo = neck ? Math.min(p.minHold, NECK_MAX_HOLD_SEC) : p.minHold;
    const hi = neck ? Math.min(p.maxHold, NECK_MAX_HOLD_SEC) : p.maxHold;
    if (step.holdSec < lo || step.holdSec > hi)
      errs.push(`hold ${s.id} ${step.holdSec} not in ${lo}-${hi}`);
    if (!p.positions.includes(res.position)) errs.push(`position ${s.id} ${res.position}`);
    // Excluded equipment never appears (the chair only through a variant).
    const needs = effectiveEquipment(s).filter((e) => !(step.noChair && e === 'chair'));
    for (const e of needs) if (ex.has(e)) errs.push(`excluded ${e} in ${s.id}`);
    if (ex.has('chair') && res.position === 'seated') errs.push(`chair seat ${s.id}`);
    if (step.noChair && !s.noChair) errs.push(`noChair without variant ${s.id}`);
    if (c.mode === 'warmup') {
      if (s.kind !== 'dynamic') errs.push(`warmup static ${s.id}`);
      if (step.repOf !== undefined) errs.push(`warmup reps ${s.id}`);
    } else if (s.kind === 'dynamic') errs.push(`${c.mode} dynamic ${s.id}`);
    if (c.mode === 'winddown') {
      if (!s.calming) errs.push(`winddown not calming ${s.id}`);
      if (step.repOf !== undefined) errs.push(`winddown reps ${s.id}`);
    }
    if (c.mode === 'midday') {
      const ground = res.position === 'kneeling' || res.position === 'floor';
      if (groundSeen && !ground) errs.push(`midday back up after floor: ${s.id}`);
      groundSeen ||= ground;
      if (s.continuous && step.repOf !== undefined) errs.push(`continuous repeated ${s.id}`);
    }
    if (c.mode === 'winddown') {
      const rank =
        res.position === 'kneeling'
          ? 0
          : res.posture === 'supine'
            ? 4
            : res.posture === 'prone'
              ? 3
              : res.posture === 'sideLying'
                ? 2
                : 1;
      if (rank < lastRank) errs.push(`winddown order ${s.id}`);
      lastRank = rank;
    }
  }
  if (c.mode === 'winddown' && r.steps.length > 0) {
    const last = r.steps.at(-1)!;
    const res = resolveStep(byId.get(last.stretchId)!, last);
    if (res.posture !== 'supine') errs.push(`winddown ends ${res.position}/${res.posture}`);
  }
  if (r.mode !== c.mode) errs.push('mode not recorded');
  for (const e of c.excluded) if (!r.excluded?.includes(e)) errs.push(`excluded ${e} not recorded`);
  return errs;
}

interface Stats {
  n: number;
  maxOff: number;
  empty: number;
  overTol: number;
  holdsMin: number;
  holdsMax: number;
  steps: [number, number];
}

function measure(library: readonly Stretch[], cases: readonly Case[]) {
  const bad: string[] = [];
  const stats: Record<string, Stats> = {};
  for (const c of cases) {
    const r = gen(c, library);
    const v = violations(c, r, library);
    if (v.length > 0) bad.push(`${JSON.stringify(c)}: ${v.join('; ')}`);
    const k = c.mode;
    stats[k] ??= {
      n: 0,
      maxOff: 0,
      empty: 0,
      overTol: 0,
      holdsMin: Infinity,
      holdsMax: 0,
      steps: [Infinity, 0],
    };
    const s = stats[k]!;
    s.n++;
    if (r.steps.length === 0) {
      s.empty++;
      continue;
    }
    const off = Math.abs(r.totalSec - r.minutes * 60);
    s.maxOff = Math.max(s.maxOff, off);
    if (off > TOLERANCE_SEC) s.overTol++;
    for (const step of r.steps) {
      s.holdsMin = Math.min(s.holdsMin, step.holdSec);
      s.holdsMax = Math.max(s.holdsMax, step.holdSec);
    }
    s.steps = [Math.min(s.steps[0], r.steps.length), Math.max(s.steps[1], r.steps.length)];
  }
  return { bad, stats };
}

describe('mode profiles', () => {
  it('share the generator neck ceiling', () => {
    expect(MODE_NECK_MAX_HOLD_SEC).toBe(NECK_MAX_HOLD_SEC);
  });

  it('suggest a mode by local time (warm-up never)', () => {
    const at = (h: number) => suggestedMode(new Date(2026, 0, 5, h, 30));
    expect(at(7)).toBe('focus');
    expect(at(10)).toBe('midday');
    expect(at(16)).toBe('midday');
    expect(at(18)).toBe('focus');
    expect(at(20)).toBe('winddown');
    expect(at(1)).toBe('winddown');
  });
});

describe('template routines on a fixture library', () => {
  it('hold every invariant across modes, lengths, exclusions, lifts and seeds', HEAVY, () => {
    const { bad, stats } = measure(FIX, allCases());
    expect(bad.slice(0, 5)).toEqual([]);
    for (const m of MODES) {
      expect(stats[m]!.empty).toBe(0);
      expect(stats[m]!.overTol).toBe(0);
    }
    console.info('fixture stats', JSON.stringify(stats));
  });

  it('is deterministic per seed', () => {
    for (const mode of MODES) {
      const c: Case = {
        mode,
        minutes: MODE_PROFILES[mode].defaultMinutes,
        seed: 42,
        excluded: ['chair'],
        lift: mode === 'warmup' ? 'squat' : undefined,
      };
      expect(gen(c, FIX)).toEqual(gen(c, FIX));
    }
  });

  it('warm-up: general mobilisers first, most lift-specific last', () => {
    for (const lift of WARMUP_LIFTS) {
      for (const seed of SEEDS) {
        const r = gen({ mode: 'warmup', minutes: 4, seed, excluded: [], lift }, FIX);
        const first = FIX.find((s) => s.id === r.steps[0]!.stretchId)!;
        expect(['upperBack', 'lowerBack', 'hips', 'glutes']).toContain(first.areas[0]);
        const last = FIX.find((s) => s.id === r.steps.at(-1)!.stretchId)!;
        expect(last.warmupFor).toContain(lift);
        // No lift movement after the last one is more specific than it.
        const liftIds = [...new Set(r.steps.map((x) => x.stretchId))]
          .map((id) => FIX.find((s) => s.id === id)!)
          .filter((s) => s.warmupFor?.includes(lift));
        const lens = liftIds.map((s) => s.warmupFor!.length);
        expect(Math.min(...lens)).toBe(last.warmupFor!.length);
        expect(r.lift).toBe(lift);
      }
    }
  });

  it('warm-up without a lift is a general full-body set', () => {
    const r = gen({ mode: 'warmup', minutes: 4, seed: 1, excluded: [] }, FIX);
    expect(r.lift).toBeUndefined();
    expect(r.steps.length).toBeGreaterThan(0);
    expect(r.skippedSlots).toEqual([]);
  });

  it('midday uses no-chair variants when the chair is excluded', () => {
    let variants = 0;
    for (const seed of SEEDS) {
      const r = gen({ mode: 'midday', minutes: 6, seed, excluded: ['chair'] }, FIX);
      for (const step of r.steps) {
        const s = FIX.find((x) => x.id === step.stretchId)!;
        expect(s.id).not.toBe('f-chair-twist');
        if (step.noChair) {
          variants++;
          expect(resolveStep(s, step).position).not.toBe('seated');
        }
      }
    }
    expect(variants).toBeGreaterThan(0);
  });

  it('wind-down: neck done in its floor variant, breathing hint, chair implicitly excluded', () => {
    const r = gen({ mode: 'winddown', minutes: 12, seed: 5, excluded: [] }, FIX);
    expect(r.breathing).toBe(true);
    expect(r.excluded).toContain('chair');
    const neck = r.steps.find((s) => FIX.find((x) => x.id === s.stretchId)!.areas[0] === 'neck');
    expect(neck?.noChair).toBe(true);
    expect(neck!.holdSec).toBeLessThanOrEqual(30);
  });

  it('midday 2x repeats static stretches back to back', () => {
    const r = gen({ mode: 'midday', minutes: 6, seed: 9, excluded: [], reps: 2 }, FIX);
    expect(r.reps).toBe(2);
    expect(r.steps.some((s) => s.repOf === 2)).toBe(true);
  });

  it('reports a slot exclusions leave unfillable, and skips it', () => {
    const noChest = FIX.filter((s) => s.id !== 'f-clasped' && s.id !== 'f-puppy');
    const r = gen({ mode: 'midday', minutes: 5, seed: 1, excluded: ['wall', 'doorway'] }, noChest);
    expect(r.skippedSlots).toContain('Chest opener');
    expect(r.steps.length).toBeGreaterThan(0);
    const noSupine = FIX.filter((s) => s.posture !== 'supine' && !s.noChair?.posture);
    const w = gen({ mode: 'winddown', minutes: 9, seed: 1, excluded: [] }, noSupine);
    expect(w.skippedSlots).toContain('Lying finish');
  });

  it('degrades to an empty routine when the pool is empty', () => {
    const statics = FIX.filter((s) => s.kind !== 'dynamic');
    const r = gen({ mode: 'warmup', minutes: 4, seed: 1, excluded: [], lift: 'bench' }, statics);
    expect(r.steps).toEqual([]);
    expect(r.totalSec).toBe(0);
    expect(r.skippedSlots!.length).toBeGreaterThan(0);
    const w = gen({ mode: 'winddown', minutes: 9, seed: 1, excluded: [] }, []);
    expect(w.steps).toEqual([]);
  });

  it('offers equipment chips only for what the mode could use', () => {
    expect(modeEquipment('winddown', FIX)).toEqual(['band']);
    expect(modeEquipment('warmup', FIX)).toEqual(['wall', 'band', 'roller', 'bar']);
    expect(modeEquipment('midday', FIX)).toContain('chair');
    expect(modePool('warmup', FIX, ['band']).some((it) => it.s.equipment?.includes('band'))).toBe(
      false,
    );
  });
});

describe('focus mode', () => {
  it('explicit focus equals the default apart from the mode tag', () => {
    const a = generateRoutine({ minutes: 7, focusAreas: ['neck'], seed: 3 });
    const b = generateRoutine({ minutes: 7, focusAreas: ['neck'], seed: 3, mode: 'focus' });
    expect(b.mode).toBe('focus');
    expect({ ...b, mode: undefined }).toEqual({ ...a, mode: undefined });
    expect(a.mode).toBeUndefined();
    expect(a.excluded).toBeUndefined();
  });

  it('never uses dynamic movements, and honours exclusions with variants', () => {
    for (const seed of SEEDS) {
      const r = generateRoutine({
        minutes: 8,
        focusAreas: [],
        seed,
        library: FIX,
        excluded: ['chair', 'band'],
      });
      expect(r.excluded).toEqual(['chair', 'band']);
      for (const step of r.steps) {
        const s = FIX.find((x) => x.id === step.stretchId)!;
        expect(s.kind !== 'dynamic' || FOCUS_DYNAMIC_IDS.includes(s.id)).toBe(true);
        expect(resolveStep(s, step).position).not.toBe('seated');
        expect(s.equipment ?? []).not.toContain('band');
      }
      const positions = r.steps.map((step) => {
        const s = FIX.find((x) => x.id === step.stretchId)!;
        return ['standing', 'seated', 'kneeling', 'floor'].indexOf(resolveStep(s, step).position);
      });
      expect([...positions].sort((x, y) => x - y)).toEqual(positions);
    }
  });
});

const LANDED = STRETCHES.some((s) => s.kind === 'dynamic') && STRETCHES.some((s) => s.calming);

describe.runIf(LANDED)('template routines on the real library', () => {
  it('hold every invariant', HEAVY, () => {
    const { bad, stats } = measure(STRETCHES, allCases());
    console.info('real library stats', JSON.stringify(stats));
    console.info('real library violations', bad.length, bad.slice(0, 5));
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

// Floor-posture order reference, kept here so a change to it is noticed.
it('floor posture order is sitting, supine, side-lying, prone', () => {
  expect(FLOOR_POSTURE_ORDER).toEqual(['sitting', 'supine', 'sideLying', 'prone']);
});
