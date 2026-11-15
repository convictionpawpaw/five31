/**
 * Stick-figure pose model for stretch illustrations. Pure.
 *
 * A {@link Pose} is a set of named joint coordinates in a fixed 200 x 160
 * viewBox (y grows downward, the floor line sits at y = 150) plus optional
 * props, arrows and highlighted segments. Poses are AUTHORED as a compact
 * {@link PoseSpec} (pelvis position, segment angles, or a target point a hand
 * or foot should reach) and resolved into coordinates by {@link buildPose}
 * using the canonical skeleton below, so every figure keeps the same body
 * proportions. A segment may only differ from canonical length through an
 * explicitly declared foreshortening factor (a limb pointing toward the
 * viewer looks shorter), which the integrity test checks.
 *
 * Angles are absolute degrees on screen: 0 = straight up, 90 = right
 * (+x), 180 = straight down, 270 = left.
 */

export type Pt = readonly [number, number];

/** viewBox size. */
export const VIEW_W = 200;
export const VIEW_H = 160;
/** y of the floor line. */
export const FLOOR_Y = 150;
/** Head circle radius. */
export const HEAD_R = 10;

/** Canonical segment lengths (viewBox units). */
export const SKELETON = {
  /** neck base to head centre */
  neck: 16,
  /** hip to mid-spine, and mid-spine to neck base */
  torsoHalf: 25,
  upperArm: 26,
  forearm: 24,
  thigh: 36,
  shin: 34,
  /** front/top view: half shoulder width */
  shoulderHalf: 14,
  /** front/top view: half pelvis width */
  hipHalf: 8,
  /** how far the shoulder joint sits below the neck base, along the spine */
  shoulderDrop: 6,
} as const;

/**
 * - side: profile, figure faces right (+x) before mirroring. The figure's LEFT
 *   limbs are the near side (drawn bright), right limbs the far side (dim).
 * - front: facing the viewer; the figure's left is on screen-right.
 * - top: seen from above, lying face-up (same geometry as front).
 */
export type PoseView = 'side' | 'front' | 'top';

export type JointName =
  | 'head'
  | 'neck'
  | 'mid'
  | 'hip'
  | 'lShoulder'
  | 'rShoulder'
  | 'lElbow'
  | 'rElbow'
  | 'lHand'
  | 'rHand'
  | 'lHip'
  | 'rHip'
  | 'lKnee'
  | 'rKnee'
  | 'lFoot'
  | 'rFoot';

/** Drawable segments, each a [from, to] joint pair. */
export type SegmentName =
  | 'neck'
  | 'upperTorso'
  | 'lowerTorso'
  | 'lUpperArm'
  | 'lForearm'
  | 'rUpperArm'
  | 'rForearm'
  | 'lThigh'
  | 'lShin'
  | 'rThigh'
  | 'rShin';

export const SEGMENTS: Record<SegmentName, readonly [JointName, JointName]> = {
  neck: ['neck', 'head'],
  upperTorso: ['mid', 'neck'],
  lowerTorso: ['hip', 'mid'],
  lUpperArm: ['lShoulder', 'lElbow'],
  lForearm: ['lElbow', 'lHand'],
  rUpperArm: ['rShoulder', 'rElbow'],
  rForearm: ['rElbow', 'rHand'],
  lThigh: ['lHip', 'lKnee'],
  lShin: ['lKnee', 'lFoot'],
  rThigh: ['rHip', 'rKnee'],
  rShin: ['rKnee', 'rFoot'],
};

/** Canonical length of each drawable segment. */
export const CANONICAL_LENGTH: Record<SegmentName, number> = {
  neck: SKELETON.neck,
  upperTorso: SKELETON.torsoHalf,
  lowerTorso: SKELETON.torsoHalf,
  lUpperArm: SKELETON.upperArm,
  lForearm: SKELETON.forearm,
  rUpperArm: SKELETON.upperArm,
  rForearm: SKELETON.forearm,
  lThigh: SKELETON.thigh,
  lShin: SKELETON.shin,
  rThigh: SKELETON.thigh,
  rShin: SKELETON.shin,
};

/** Equipment and surfaces drawn behind the figure. */
export type Prop =
  | { kind: 'wall'; x: number }
  | { kind: 'doorway'; x: number }
  /** Side-view chair: seat from x to x + 40 at seatY, backrest at x. */
  | { kind: 'chair'; x: number; seatY: number }
  /** Front-view chair: seat centred on x. */
  | { kind: 'chairFront'; x: number; seatY: number }
  /** Top-view mat outline. */
  | { kind: 'mat' };

/** A highlighted direction arrow; `bend` offsets the curve's control point. */
export interface Arrow {
  from: Pt;
  to: Pt;
  bend?: number;
}

/** A point, or a joint (already resolved) plus an offset. */
export type Target = Pt | { ref: JointName; dx?: number; dy?: number };

/**
 * A limb: either the absolute angles of its upper and lower segment, or a
 * target the end (hand/foot) should reach with the middle joint bent to one
 * side. bend 1 puts the elbow/knee to the LEFT of the root-to-target line as
 * seen on screen (e.g. a knee forward on a right-facing standing leg), -1 to
 * the right. `fs` scales the two segments for foreshortening.
 */
export type LimbSpec =
  | { a: readonly [number, number]; fs?: readonly [number, number] }
  | { to: Target; bend: 1 | -1; fs?: readonly [number, number] };

export interface PoseSpec {
  view?: PoseView;
  /** Pelvis centre. */
  hip: Pt;
  /** Spine angle, or [lower half, upper half] angles for a curved back. */
  torso: number | readonly [number, number];
  /** Neck-to-head angle; defaults to the upper spine angle. */
  head?: number;
  /** Direction the face points (nose tick); null for none. Side default: head + 90. */
  face?: number | null;
  la: LimbSpec;
  ra: LimbSpec;
  ll: LimbSpec;
  rl: LimbSpec;
  props?: Prop[];
  arrows?: Arrow[];
  /** Segments drawn in the highlight colour (the stretched region). */
  hl?: SegmentName[];
  /** Draw the floor line (default true). */
  floor?: boolean;
  /** Optional short finger stub angles from each hand (wrist stretches). */
  fingers?: { l?: number; r?: number };
}

/** A resolved pose: what StretchFigure renders. */
export interface Pose {
  view: PoseView;
  joints: Record<JointName, Pt>;
  /** Declared foreshortening per segment (1 = canonical length). */
  fs: Record<SegmentName, number>;
  face: number | null;
  props: Prop[];
  arrows: Arrow[];
  hl: SegmentName[];
  floor: boolean;
  /** Finger stub angles, or null for none. */
  fingers: { l: number | null; r: number | null };
}

/** Length of a finger stub (not part of the skeleton check). */
export const FINGER_LEN = 9;

/** Unit vector for an absolute angle (0 = up, 90 = right). */
export function dir(angleDeg: number): Pt {
  const r = (angleDeg * Math.PI) / 180;
  return [Math.sin(r), -Math.cos(r)];
}

function add(p: Pt, v: Pt, k = 1): Pt {
  return [p[0] + v[0] * k, p[1] + v[1] * k];
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * Two-bone IK: place the middle joint so the chain root → mid → end reaches
 * `target` (or points straight at it when out of reach). Segment lengths are
 * always exactly l1 and l2.
 */
export function solveTwoBone(
  root: Pt,
  target: Pt,
  l1: number,
  l2: number,
  bend: 1 | -1,
): { mid: Pt; end: Pt } {
  const dx = target[0] - root[0];
  const dy = target[1] - root[1];
  const raw = Math.hypot(dx, dy);
  const ux = raw > 1e-9 ? dx / raw : 0;
  const uy = raw > 1e-9 ? dy / raw : 1;
  const minD = Math.abs(l1 - l2) + 1e-6;
  const maxD = l1 + l2 - 1e-6;
  const d = Math.min(Math.max(raw, minD), maxD);
  // Distance along root→target to the foot of the mid joint, and the offset.
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // Screen-left normal of (ux, uy) is (uy, -ux).
  const nx = uy * bend;
  const ny = -ux * bend;
  const mid: Pt = [root[0] + ux * a + nx * h, root[1] + uy * a + ny * h];
  const end: Pt = [root[0] + ux * d, root[1] + uy * d];
  return { mid, end };
}

function resolveTarget(t: Target, joints: Partial<Record<JointName, Pt>>): Pt {
  if (Array.isArray(t)) return t as Pt;
  const ref = t as { ref: JointName; dx?: number; dy?: number };
  const base = joints[ref.ref];
  if (!base) throw new Error(`Pose target references unresolved joint '${ref.ref}'`);
  return [base[0] + (ref.dx ?? 0), base[1] + (ref.dy ?? 0)];
}

function limb(
  root: Pt,
  spec: LimbSpec,
  l1: number,
  l2: number,
  joints: Partial<Record<JointName, Pt>>,
): { mid: Pt; end: Pt; fs: readonly [number, number] } {
  const fs = spec.fs ?? [1, 1];
  const s1 = l1 * fs[0];
  const s2 = l2 * fs[1];
  if ('a' in spec) {
    const mid = add(root, dir(spec.a[0]), s1);
    const end = add(mid, dir(spec.a[1]), s2);
    return { mid, end, fs };
  }
  const { mid, end } = solveTwoBone(root, resolveTarget(spec.to, joints), s1, s2, spec.bend);
  return { mid, end, fs };
}

/** Resolve a {@link PoseSpec} into joint coordinates on the canonical skeleton. */
export function buildPose(spec: PoseSpec): Pose {
  const view = spec.view ?? 'side';
  const [tl, tu] = typeof spec.torso === 'number' ? [spec.torso, spec.torso] : spec.torso;
  const headAngle = spec.head ?? tu;
  const S = SKELETON;

  const hip = spec.hip;
  const mid = add(hip, dir(tl), S.torsoHalf);
  const neck = add(mid, dir(tu), S.torsoHalf);
  const head = add(neck, dir(headAngle), S.neck);
  const shoulderBase = add(neck, dir(tu), -S.shoulderDrop);

  let lShoulder: Pt;
  let rShoulder: Pt;
  let lHip: Pt;
  let rHip: Pt;
  if (view === 'side') {
    lShoulder = shoulderBase;
    rShoulder = shoulderBase;
    lHip = hip;
    rHip = hip;
  } else {
    lShoulder = add(shoulderBase, dir(tu + 90), S.shoulderHalf);
    rShoulder = add(shoulderBase, dir(tu - 90), S.shoulderHalf);
    lHip = add(hip, dir(tl + 90), S.hipHalf);
    rHip = add(hip, dir(tl - 90), S.hipHalf);
  }

  const joints: Partial<Record<JointName, Pt>> = {
    head,
    neck,
    mid,
    hip,
    lShoulder,
    rShoulder,
    lHip,
    rHip,
  };

  // Resolve limbs in dependency order: a limb whose target references another
  // limb's joint (a hand holding a foot, an ankle resting on a knee) waits
  // until that joint exists. Default order is legs, then arms.
  type LimbKey = 'll' | 'rl' | 'la' | 'ra';
  const LIMBS: Record<
    LimbKey,
    { root: Pt; l1: number; l2: number; mid: JointName; end: JointName }
  > = {
    ll: { root: lHip, l1: S.thigh, l2: S.shin, mid: 'lKnee', end: 'lFoot' },
    rl: { root: rHip, l1: S.thigh, l2: S.shin, mid: 'rKnee', end: 'rFoot' },
    la: { root: lShoulder, l1: S.upperArm, l2: S.forearm, mid: 'lElbow', end: 'lHand' },
    ra: { root: rShoulder, l1: S.upperArm, l2: S.forearm, mid: 'rElbow', end: 'rHand' },
  };
  const resolved: Partial<Record<LimbKey, readonly [number, number]>> = {};
  const pending: LimbKey[] = ['ll', 'rl', 'la', 'ra'];
  while (pending.length > 0) {
    const idx = pending.findIndex((k) => {
      const sp = spec[k];
      if ('a' in sp || Array.isArray(sp.to)) return true;
      return joints[(sp.to as { ref: JointName }).ref] !== undefined;
    });
    if (idx < 0) throw new Error('Pose limb targets form a cycle');
    const key = pending.splice(idx, 1)[0]!;
    const L = LIMBS[key];
    const r = limb(L.root, spec[key], L.l1, L.l2, joints);
    joints[L.mid] = r.mid;
    joints[L.end] = r.end;
    resolved[key] = r.fs;
  }
  const ll = { fs: resolved.ll! };
  const rl = { fs: resolved.rl! };
  const la = { fs: resolved.la! };
  const ra = { fs: resolved.ra! };

  const fs: Record<SegmentName, number> = {
    neck: 1,
    upperTorso: 1,
    lowerTorso: 1,
    lUpperArm: la.fs[0],
    lForearm: la.fs[1],
    rUpperArm: ra.fs[0],
    rForearm: ra.fs[1],
    lThigh: ll.fs[0],
    lShin: ll.fs[1],
    rThigh: rl.fs[0],
    rShin: rl.fs[1],
  };

  const face = spec.face !== undefined ? spec.face : view === 'side' ? headAngle + 90 : null;

  return {
    view,
    joints: joints as Record<JointName, Pt>,
    fs,
    face,
    props: spec.props ?? [],
    arrows: spec.arrows ?? [],
    hl: spec.hl ?? [],
    floor: spec.floor ?? true,
    fingers: { l: spec.fingers?.l ?? null, r: spec.fingers?.r ?? null },
  };
}
