import { describe, it, expect } from 'vitest';
import { STRETCHES } from '../library.ts';
import { BASE_POSE_IDS, POSES, POSE_BASE, POSE_SPECS } from '../poses.ts';
import {
  BREATHE_AMP,
  BREATHE_MS,
  CANONICAL_LENGTH,
  FLOOR_Y,
  HEAD_R,
  LOOP_MS,
  SEGMENTS,
  SETTLE_FROM,
  SETTLE_MS,
  VIEW_H,
  VIEW_W,
  animT,
  blendPose,
  buildPose,
  dist,
  shiftSpec,
  specFromPose,
  type JointName,
  type Pose,
  type PoseSpec,
  type SegmentName,
} from '../pose.ts';

/** Same tolerance as the authored-pose proportion test. */
const TOL = 0.04;

interface Pair {
  label: string;
  a: PoseSpec;
  b: PoseSpec;
  /** Fractions the figure actually shows. */
  shown: readonly number[];
}

/** Every animated pair the figure can draw: dynamic loops and base ease-ins. */
function animatedPairs(): Pair[] {
  const pairs: Pair[] = [];
  const settle = (poseId: string, label: string) => {
    const base = POSE_BASE[poseId];
    if (!base) return;
    const a = shiftSpec(
      POSE_SPECS[base]!,
      POSES[poseId]!.joints.hip[0] - POSES[base]!.joints.hip[0],
    );
    pairs.push({
      label,
      a,
      b: POSE_SPECS[poseId]!,
      shown: [SETTLE_FROM, 0.8, 0.85, 0.9, 0.95, 1 - BREATHE_AMP, 1],
    });
  };
  for (const s of STRETCHES) {
    if (s.poseFrom) {
      pairs.push({
        label: s.id,
        a: POSE_SPECS[s.poseFrom]!,
        b: POSE_SPECS[s.pose]!,
        shown: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1],
      });
    } else settle(s.pose, s.id);
    if (s.noChair) settle(s.noChair.pose, `${s.id} (no chair)`);
  }
  return pairs;
}

function maxSegmentDeviation(p: Pose): { dev: number; seg: SegmentName } {
  let worst = { dev: 0, seg: 'neck' as SegmentName };
  for (const seg of Object.keys(SEGMENTS) as SegmentName[]) {
    const [a, b] = SEGMENTS[seg];
    const len = dist(p.joints[a], p.joints[b]);
    const dev = Math.abs(len - CANONICAL_LENGTH[seg] * p.fs[seg]) / CANONICAL_LENGTH[seg];
    if (dev > worst.dev) worst = { dev, seg };
  }
  return worst;
}

describe('pose animation', () => {
  const pairs = animatedPairs();

  it('animates every dynamic movement and most static holds', () => {
    const dynamic = STRETCHES.filter((s) => s.kind === 'dynamic').length;
    expect(pairs.length).toBeGreaterThan(dynamic + 30);
  });

  it('keeps segment lengths on the skeleton at t = 0.25, 0.5, 0.75 for every pair', () => {
    let worst = { dev: 0, where: '' };
    for (const { label, a, b } of pairs) {
      for (const t of [0.25, 0.5, 0.75]) {
        const p = blendPose(a, b, t);
        const { dev, seg } = maxSegmentDeviation(p);
        expect(dev, `${label} t=${t} ${seg}`).toBeLessThan(TOL);
        for (const f of Object.values(p.fs)) {
          expect(f, label).toBeGreaterThanOrEqual(0.3);
          expect(f, label).toBeLessThanOrEqual(1);
        }
        if (dev > worst.dev) worst = { dev, where: `${label} t=${t} ${seg}` };
      }
    }
    // Lengths come from the skeleton itself (angles and IK), so the error is float noise.
    expect(worst.dev, worst.where).toBeLessThan(1e-6);
  });

  it('reproduces both end poses exactly at t = 0 and t = 1', () => {
    for (const { label, a, b } of pairs) {
      const pa = buildPose(a);
      const pb = buildPose(b);
      const p0 = blendPose(a, b, 0);
      const p1 = blendPose(a, b, 1);
      for (const j of Object.keys(pa.joints) as JointName[]) {
        expect(dist(p0.joints[j], pa.joints[j]), `${label} start ${j}`).toBeLessThan(0.01);
        expect(dist(p1.joints[j], pb.joints[j]), `${label} end ${j}`).toBeLessThan(0.01);
      }
    }
  });

  // Mid-blend frames may dip a little more than authored poses (1.5): up to
  // half a limb's drawn width. They may also leave the 200 x 160 canvas by a
  // few units, which is harmless because the figure frames the union of all
  // its frames; anything far outside would still mean a broken blend.
  it('never sinks through the floor (or flies off the canvas) in any frame shown', () => {
    for (const { label, a, b, shown } of pairs) {
      for (const t of shown) {
        const p = blendPose(a, b, t);
        for (const [name, [x, y]] of Object.entries(p.joints)) {
          const r = name === 'head' ? HEAD_R : 0;
          const at = `${label} t=${t} ${name}`;
          if (p.floor) expect(y + r, at).toBeLessThanOrEqual(FLOOR_Y + 3);
          expect(x - r, at).toBeGreaterThanOrEqual(-5);
          expect(x + r, at).toBeLessThanOrEqual(VIEW_W + 5);
          expect(y - r, at).toBeGreaterThanOrEqual(-5);
          expect(y + r, at).toBeLessThanOrEqual(VIEW_H + 5);
        }
      }
    }
  });

  it('keeps hands and feet planted when both poses target the same floor or wall point', () => {
    const END = { la: 'lHand', ra: 'rHand', ll: 'lFoot', rl: 'rFoot' } as const;
    for (const { label, a, b } of pairs) {
      for (const k of ['la', 'ra', 'll', 'rl'] as const) {
        const la = a[k];
        const lb = b[k];
        if (!('to' in la) || !('to' in lb) || la.bend !== lb.bend) continue;
        if (!Array.isArray(la.to) || !Array.isArray(lb.to)) continue;
        const ta = la.to as readonly [number, number];
        const tb = lb.to as readonly [number, number];
        if (dist(ta, tb) > 0.5) continue;
        const mid = blendPose(a, b, 0.5);
        expect(dist(mid.joints[END[k]], ta), `${label}.${k}`).toBeLessThan(1);
      }
    }
  });
});

describe('base poses', () => {
  it('every static pose (and no-chair pose) declares a base or an explicit opt-out', () => {
    for (const s of STRETCHES) {
      if (s.kind === 'dynamic') {
        expect(POSE_BASE[s.pose], s.id).toBeUndefined();
        continue;
      }
      expect(s.pose in POSE_BASE, s.id).toBe(true);
      if (s.noChair) expect(s.noChair.pose in POSE_BASE, s.id).toBe(true);
    }
  });

  it('bases exist, are base poses, and share the view of the pose they lead into', () => {
    for (const [id, base] of Object.entries(POSE_BASE)) {
      expect(POSES[id], id).toBeDefined();
      if (base === null) continue;
      expect(BASE_POSE_IDS, id).toContain(base);
      expect(POSES[base]!.view, id).toBe(POSES[id]!.view);
    }
  });

  it('every base pose is used by some pose', () => {
    const used = new Set(Object.values(POSE_BASE));
    for (const b of BASE_POSE_IDS) expect(used.has(b), b).toBe(true);
  });
});

describe('specFromPose', () => {
  it('rebuilds every resolved pose exactly', () => {
    for (const [id, pose] of Object.entries(POSES)) {
      const re = buildPose(specFromPose(pose));
      for (const j of Object.keys(pose.joints) as JointName[]) {
        expect(dist(re.joints[j], pose.joints[j]), `${id}.${j}`).toBeLessThan(1e-6);
      }
      expect(re.face, id).toBe(pose.face);
    }
  });
});

describe('animT', () => {
  it('loop: start -> end -> start, eased, periodic', () => {
    expect(animT('loop', 0)).toBeCloseTo(0, 9);
    expect(animT('loop', LOOP_MS / 2)).toBeCloseTo(1, 9);
    expect(animT('loop', LOOP_MS)).toBeCloseTo(0, 9);
    expect(animT('loop', LOOP_MS * 3 + 123)).toBeCloseTo(animT('loop', 123), 9);
    // Eased: slow near the ends.
    expect(animT('loop', LOOP_MS / 20)).toBeLessThan(0.05);
    expect(LOOP_MS).toBeGreaterThanOrEqual(3000);
    expect(LOOP_MS).toBeLessThanOrEqual(4000);
  });

  it('settle: eases in from SETTLE_FROM, then breathes just short of the stretch', () => {
    expect(SETTLE_FROM).toBeGreaterThanOrEqual(0.7);
    expect(SETTLE_FROM).toBeLessThanOrEqual(0.8);
    expect(animT('settle', 0)).toBeCloseTo(SETTLE_FROM, 9);
    expect(animT('settle', SETTLE_MS)).toBeCloseTo(1, 9);
    let prev = animT('settle', 0);
    for (let ms = 10; ms <= SETTLE_MS; ms += 10) {
      const t = animT('settle', ms);
      expect(t).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = t;
    }
    for (let ms = SETTLE_MS; ms < SETTLE_MS + 3 * BREATHE_MS; ms += 37) {
      const t = animT('settle', ms);
      expect(t).toBeLessThanOrEqual(1 + 1e-12);
      expect(t).toBeGreaterThanOrEqual(1 - BREATHE_AMP - 1e-12);
    }
    expect(animT('settle', SETTLE_MS + BREATHE_MS / 2)).toBeCloseTo(1 - BREATHE_AMP, 9);
    // Smooth hand-off (no jump at the end of the ease-in).
    expect(Math.abs(animT('settle', SETTLE_MS - 1) - animT('settle', SETTLE_MS + 1))).toBeLessThan(
      1e-4,
    );
  });
});
