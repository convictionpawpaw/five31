import { describe, it, expect } from 'vitest';
import { STRETCHES, getStretch } from '../library.ts';
import { POSES, POSE_SPECS } from '../poses.ts';
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
import { BODY_AREAS, isBodyArea } from '../types.ts';

describe('stretch library integrity', () => {
  it('has 35 to 45 stretches with unique ids', () => {
    expect(STRETCHES.length).toBeGreaterThanOrEqual(35);
    expect(STRETCHES.length).toBeLessThanOrEqual(45);
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

  it('every pose is used by some stretch', () => {
    const used = new Set(STRETCHES.map((s) => s.pose));
    for (const id of Object.keys(POSES)) expect(used.has(id), id).toBe(true);
  });

  it('no neck stretch uses circles (gentle neck work only)', () => {
    for (const s of STRETCHES) {
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
