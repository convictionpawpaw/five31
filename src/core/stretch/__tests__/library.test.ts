import { describe, it, expect } from 'vitest';
import { STRETCHES, getStretch } from '../library.ts';
import { BASE_POSE_IDS, POSES, POSE_SPECS } from '../poses.ts';
import {
  CANONICAL_LENGTH,
  FLOOR_Y,
  HEAD_R,
  SEGMENTS,
  SKELETON,
  VIEW_H,
  VIEW_W,
  dist,
  solveTwoBone,
  type SegmentName,
} from '../pose.ts';
import { BODY_AREAS, isBodyArea, type BodyArea, type WarmupLift } from '../types.ts';

describe('stretch library integrity', () => {
  it('has 35 to 45 static stretches, 12 to 20 dynamic movements, all with unique ids', () => {
    const dynamic = STRETCHES.filter((s) => s.kind === 'dynamic').length;
    const statics = STRETCHES.length - dynamic;
    expect(statics).toBeGreaterThanOrEqual(35);
    expect(statics).toBeLessThanOrEqual(45);
    expect(dynamic).toBeGreaterThanOrEqual(12);
    expect(dynamic).toBeLessThanOrEqual(20);
    const ids = STRETCHES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of STRETCHES) expect(getStretch(s.id)).toBe(s);
  });

  it('every body area has at least 3 stretches', () => {
    for (const area of BODY_AREAS) {
      const n = STRETCHES.filter((s) => s.areas.includes(area)).length;
      expect(n, area).toBeGreaterThanOrEqual(3);
    }
  });

  it('is deepest in the back-and-neck areas (>= 6 each counting any listed area)', () => {
    for (const area of ['neck', 'upperBack', 'lowerBack', 'chest', 'hips', 'hamstrings'] as const) {
      const n = STRETCHES.filter((s) => s.areas.includes(area)).length;
      expect(n, area).toBeGreaterThanOrEqual(6);
    }
  });

  it('every stretch has valid areas, 2-3 cues, a sane hold and an existing pose', () => {
    for (const s of STRETCHES) {
      expect(s.areas.length, s.id).toBeGreaterThan(0);
      expect(new Set(s.areas).size, s.id).toBe(s.areas.length);
      for (const a of s.areas) expect(isBodyArea(a), `${s.id}:${a}`).toBe(true);
      expect(s.cues.length, s.id).toBeGreaterThanOrEqual(2);
      expect(s.cues.length, s.id).toBeLessThanOrEqual(3);
      for (const c of s.cues) expect(c.trim().length, s.id).toBeGreaterThan(0);
      expect(s.holdSec, s.id).toBeGreaterThanOrEqual(20);
      expect(s.holdSec, s.id).toBeLessThanOrEqual(45);
      expect(POSES[s.pose], s.id).toBeDefined();
    }
  });

  it('every pose is used by some stretch (pose, poseFrom or no-chair variant) or is a base pose', () => {
    const used = new Set<string>(BASE_POSE_IDS);
    for (const s of STRETCHES) {
      used.add(s.pose);
      if (s.poseFrom) used.add(s.poseFrom);
      if (s.noChair) used.add(s.noChair.pose);
    }
    for (const id of Object.keys(POSES)) expect(used.has(id), id).toBe(true);
  });

  it('no neck stretch uses circles (gentle neck work only)', () => {
    for (const s of STRETCHES) {
      if (!s.areas.includes('neck')) continue;
      expect(/circle/i.test(s.name + s.cues.join(' ')), s.id).toBe(false);
    }
  });

  it('neck and back cues never cue looking up, pulling the head or hands on the head for weight', () => {
    for (const s of STRETCHES) {
      const text = s.cues.join(' ').toLowerCase();
      if (!s.areas.some((a) => a === 'neck' || a === 'upperBack' || a === 'lowerBack')) continue;
      expect(
        /(?<!not )look (slightly )?up|tilt .*back|their weight is enough/.test(text),
        s.id,
      ).toBe(false);
      // "pull" may only appear negated ("never pull", "no pulling").
      for (const m of text.matchAll(/\bpull\w*/g)) {
        const before = text.slice(Math.max(0, m.index! - 12), m.index!);
        expect(/never|no|not/.test(before), `${s.id}: "${before}${m[0]}"`).toBe(true);
      }
    }
    const flex = getStretch('neck-flexion')!.cues.join(' ');
    expect(flex).toMatch(/lap/);
    expect(getStretch('scalene')!.cues.join(' ')).toMatch(/Do not look up/);
    expect(getStretch('thoracic-ext-chair')!.cues.join(' ')).toMatch(/chin/);
    expect(getStretch('thoracic-ext-chair')!.cues.join(' ')).toMatch(/stable chair/i);
    expect(getStretch('soleus-calf')!.cues.join(' ')).not.toMatch(/same as/i);
  });

  it('every floor stretch declares a posture, and only floor stretches do', () => {
    for (const s of STRETCHES) {
      if (s.position === 'floor') expect(s.posture, s.id).toBeDefined();
      else expect(s.posture, s.id).toBeUndefined();
    }
  });
});

describe('pose proportions', () => {
  const TOL = 0.04; // 4% of canonical length

  it('every segment matches the canonical skeleton (times its declared foreshortening)', () => {
    for (const [id, pose] of Object.entries(POSES)) {
      for (const seg of Object.keys(SEGMENTS) as SegmentName[]) {
        const [a, b] = SEGMENTS[seg];
        const len = dist(pose.joints[a], pose.joints[b]);
        const fs = pose.fs[seg];
        expect(fs, `${id}.${seg} foreshortening`).toBeGreaterThanOrEqual(0.3);
        expect(fs, `${id}.${seg} foreshortening`).toBeLessThanOrEqual(1);
        const want = CANONICAL_LENGTH[seg] * fs;
        expect(
          Math.abs(len - want) / CANONICAL_LENGTH[seg],
          `${id}.${seg} len ${len}`,
        ).toBeLessThan(TOL);
      }
    }
  });

  it('shoulders and hips are attached to the spine at canonical offsets', () => {
    for (const [id, pose] of Object.entries(POSES)) {
      const j = pose.joints;
      if (pose.view === 'side') {
        expect(dist(j.lShoulder, j.neck), id).toBeCloseTo(SKELETON.shoulderDrop, 3);
        expect(dist(j.lShoulder, j.rShoulder), id).toBeCloseTo(0, 6);
        expect(dist(j.lHip, j.hip), id).toBeCloseTo(0, 6);
      } else {
        const sw = Math.hypot(SKELETON.shoulderHalf, SKELETON.shoulderDrop);
        expect(dist(j.lShoulder, j.neck), id).toBeCloseTo(sw, 3);
        expect(dist(j.rShoulder, j.neck), id).toBeCloseTo(sw, 3);
        expect(dist(j.lHip, j.hip), id).toBeCloseTo(SKELETON.hipHalf, 3);
        expect(dist(j.rHip, j.hip), id).toBeCloseTo(SKELETON.hipHalf, 3);
      }
    }
  });

  it('keeps foreshortening rare (at most 4 shortened segments per pose)', () => {
    for (const [id, pose] of Object.entries(POSES)) {
      const n = Object.values(pose.fs).filter((f) => f < 1).length;
      expect(n, id).toBeLessThanOrEqual(4);
    }
  });

  it('every joint (and the head circle) stays inside the viewBox', () => {
    for (const [id, pose] of Object.entries(POSES)) {
      for (const [name, [x, y]] of Object.entries(pose.joints)) {
        const r = name === 'head' ? HEAD_R : 0;
        expect(x - r, `${id}.${name}.x`).toBeGreaterThanOrEqual(0);
        expect(x + r, `${id}.${name}.x`).toBeLessThanOrEqual(VIEW_W);
        expect(y - r, `${id}.${name}.y`).toBeGreaterThanOrEqual(0);
        expect(y + r, `${id}.${name}.y`).toBeLessThanOrEqual(VIEW_H);
      }
    }
  });

  it('nothing sinks through the floor in floor-line poses', () => {
    for (const [id, pose] of Object.entries(POSES)) {
      if (!pose.floor) continue;
      for (const [name, [, y]] of Object.entries(pose.joints)) {
        const r = name === 'head' ? HEAD_R : 0;
        expect(y + r, `${id}.${name}`).toBeLessThanOrEqual(FLOOR_Y + 1.5);
      }
    }
  });

  // Every limb authored with a target (a hand on the floor, a wall, a knee,
  // a foot; a heel on the floor) must actually reach it: the IK clamps an
  // out-of-reach target silently, which draws hands hovering short of props.
  it('every targeted hand/foot reaches its target (contact points)', () => {
    const END = { la: 'lHand', ra: 'rHand', ll: 'lFoot', rl: 'rFoot' } as const;
    for (const [id, spec] of Object.entries(POSE_SPECS)) {
      const pose = POSES[id]!;
      for (const k of ['la', 'ra', 'll', 'rl'] as const) {
        const limb = spec[k];
        if (!('to' in limb)) continue;
        const t = limb.to;
        const target: readonly [number, number] = Array.isArray(t)
          ? (t as readonly [number, number])
          : (() => {
              const r = t as { ref: keyof typeof pose.joints; dx?: number; dy?: number };
              const base = pose.joints[r.ref];
              return [base[0] + (r.dx ?? 0), base[1] + (r.dy ?? 0)] as const;
            })();
        expect(dist(pose.joints[END[k]], target), `${id}.${k}`).toBeLessThan(1);
      }
    }
  });

  it('has a spec for every resolved pose', () => {
    expect(Object.keys(POSE_SPECS).sort()).toEqual(Object.keys(POSES).sort());
  });
});

describe('solveTwoBone', () => {
  it('keeps both bone lengths exact when the target is reachable', () => {
    const { mid, end } = solveTwoBone([0, 0], [30, 30], 26, 24, 1);
    expect(dist([0, 0], mid)).toBeCloseTo(26, 6);
    expect(dist(mid, end)).toBeCloseTo(24, 6);
    expect(end[0]).toBeCloseTo(30, 6);
    expect(end[1]).toBeCloseTo(30, 6);
  });

  it('straightens toward an out-of-reach target without stretching', () => {
    const { mid, end } = solveTwoBone([0, 0], [200, 0], 26, 24, -1);
    expect(dist([0, 0], mid)).toBeCloseTo(26, 3);
    expect(dist(mid, end)).toBeCloseTo(24, 3);
    expect(end[0]).toBeCloseTo(50, 3);
  });

  it('bend picks the side: 1 is screen-left of the root-to-target line', () => {
    // Pointing right, screen-left is up (smaller y).
    expect(solveTwoBone([0, 0], [40, 0], 26, 24, 1).mid[1]).toBeLessThan(0);
    expect(solveTwoBone([0, 0], [40, 0], 26, 24, -1).mid[1]).toBeGreaterThan(0);
  });
});

describe('equipment, variants and calming', () => {
  /** Chair stretches with deliberately no chairless version. */
  const NO_CHAIR_EXEMPT = ['thoracic-ext-chair', 'chair-hamstring'];

  it('every chair stretch (seated position or chair prop) is tagged chair, and only those', () => {
    for (const s of STRETCHES) {
      const chairProp = POSES[s.pose]!.props.some(
        (p) => p.kind === 'chair' || p.kind === 'chairFront',
      );
      if (s.position === 'seated' || chairProp) expect(s.equipment, s.id).toContain('chair');
      else expect(s.equipment ?? [], s.id).not.toContain('chair');
    }
  });

  it('wall, doorway, band, roller and bar props match the equipment tags', () => {
    const PROP_EQ: Record<string, string> = {
      wall: 'wall',
      wallBehind: 'wall',
      doorway: 'doorway',
      band: 'band',
      roller: 'roller',
      bar: 'bar',
    };
    for (const s of STRETCHES) {
      for (const id of [s.pose, s.poseFrom].filter((x): x is string => !!x)) {
        for (const p of POSES[id]!.props) {
          const eq = PROP_EQ[p.kind];
          if (eq) expect(s.equipment as string[] | undefined, `${s.id}:${p.kind}`).toContain(eq);
        }
      }
    }
  });

  it('every chair stretch has a no-chair variant unless deliberately exempt', () => {
    for (const s of STRETCHES) {
      if (!s.equipment?.includes('chair') || NO_CHAIR_EXEMPT.includes(s.id)) {
        expect(s.noChair, s.id).toBeUndefined();
      } else {
        expect(s.noChair, s.id).toBeDefined();
      }
    }
    for (const id of NO_CHAIR_EXEMPT) expect(getStretch(id)!.equipment, id).toContain('chair');
  });

  it('no-chair variants: an existing chair-free pose, consistent position/posture, valid cues', () => {
    for (const s of STRETCHES) {
      const v = s.noChair;
      if (!v) continue;
      const pose = POSES[v.pose];
      expect(pose, s.id).toBeDefined();
      expect(
        pose!.props.some((p) => p.kind === 'chair' || p.kind === 'chairFront'),
        s.id,
      ).toBe(false);
      expect(v.position, s.id).not.toBe('seated');
      if (v.position === 'floor') expect(v.posture, s.id).toBeDefined();
      else expect(v.posture, s.id).toBeUndefined();
      const cues = v.cues ?? s.cues;
      expect(cues.join(' '), s.id).not.toMatch(/chair/i);
      expect(cues.length, s.id).toBeGreaterThanOrEqual(2);
      expect(cues.length, s.id).toBeLessThanOrEqual(3);
    }
  });

  it('neck stretches have floor-sitting no-chair variants and are calming (before-sleep routine)', () => {
    for (const s of STRETCHES) {
      if (s.areas[0] !== 'neck') continue;
      expect(s.noChair?.position, s.id).toBe('floor');
      expect(s.noChair?.posture, s.id).toBe('sitting');
      expect(s.calming, s.id).toBe(true);
    }
  });

  it('at least 12 calming stretches spanning the stiff areas, 3+ lying on the back', () => {
    const calm = STRETCHES.filter((s) => s.calming);
    expect(calm.length).toBeGreaterThanOrEqual(12);
    const areas: BodyArea[] = ['neck', 'upperBack', 'lowerBack', 'hips', 'hamstrings'];
    for (const a of areas)
      expect(
        calm.some((s) => s.areas.includes(a)),
        a,
      ).toBe(true);
    expect(calm.filter((s) => s.posture === 'supine').length).toBeGreaterThanOrEqual(3);
  });

  it('calming stretches are static and never done standing (with any no-chair variant applied)', () => {
    for (const s of STRETCHES) {
      if (!s.calming) continue;
      expect(s.kind, s.id).not.toBe('dynamic');
      expect(s.noChair?.position ?? s.position, s.id).not.toBe('standing');
    }
    expect(getStretch('downward-dog')!.calming).toBeUndefined();
  });
});

describe('dynamic warm-up movements', () => {
  const dynamic = STRETCHES.filter((s) => s.kind === 'dynamic');
  const LIFTS: WarmupLift[] = ['press', 'bench', 'squat', 'deadlift'];

  it('cat-cow is one of them', () => {
    expect(getStretch('cat-cow')!.kind).toBe('dynamic');
  });

  it('each is continuous, 30-40 s, with both poses (same view) and warmupFor', () => {
    for (const s of dynamic) {
      expect(s.continuous, s.id).toBe(true);
      expect(s.holdSec, s.id).toBeGreaterThanOrEqual(30);
      expect(s.holdSec, s.id).toBeLessThanOrEqual(40);
      expect(s.poseFrom, s.id).toBeDefined();
      expect(POSES[s.poseFrom!], s.id).toBeDefined();
      expect(s.poseFrom, s.id).not.toBe(s.pose);
      expect(POSES[s.poseFrom!]!.view, s.id).toBe(POSES[s.pose]!.view);
      expect(s.warmupFor?.length, s.id).toBeGreaterThan(0);
      expect(new Set(s.warmupFor).size, s.id).toBe(s.warmupFor!.length);
      expect(s.noChair, s.id).toBeUndefined();
      expect(s.calming, s.id).toBeUndefined();
    }
  });

  it('only dynamic movements carry warmupFor or poseFrom', () => {
    for (const s of STRETCHES) {
      if (s.kind === 'dynamic') continue;
      expect(s.warmupFor, s.id).toBeUndefined();
      expect(s.poseFrom, s.id).toBeUndefined();
    }
  });

  it('every lift has at least 5 equipment-free movements', () => {
    for (const lift of LIFTS) {
      const free = dynamic.filter(
        (s) => s.warmupFor!.includes(lift) && (s.equipment ?? []).length === 0,
      );
      expect(free.length, lift).toBeGreaterThanOrEqual(5);
    }
  });

  it('band, roller and bar movements exist as extras', () => {
    for (const eq of ['band', 'roller', 'bar'] as const) {
      expect(
        dynamic.some((s) => s.equipment?.includes(eq)),
        eq,
      ).toBe(true);
    }
  });

  it('cues describe a slow, controlled, pain-free movement (nothing ballistic)', () => {
    for (const s of dynamic) {
      const text = s.cues.join(' ').toLowerCase();
      expect(/slow|control|smooth|gentl|steady/.test(text), s.id).toBe(true);
      expect(/pain|pinch|comfort|easy|complain|as far as|as deep as/.test(text), s.id).toBe(true);
      expect(
        /\b(bounce|bouncing|jump|explosive|fast)\b/.test(text.replace(/no bouncing/g, '')),
        s.id,
      ).toBe(false);
    }
  });

  it('nothing loads the neck: no neck area, no hands pulling on the head', () => {
    for (const s of dynamic) {
      expect(s.areas, s.id).not.toContain('neck');
    }
  });
});
