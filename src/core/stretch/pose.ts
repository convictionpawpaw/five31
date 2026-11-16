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
  | { kind: 'mat' }
  /** Front view: the wall behind the figure (a pale panel). */
  | { kind: 'wallBehind' }
  /** Resistance band stretched between two joints (drawn over the figure). */
  | { kind: 'band'; a: JointName; b: JointName }
  /** Foam roller seen end-on: a circle resting on the floor, centred on x. */
  | { kind: 'roller'; x: number }
  /** Pull-up bar seen end-on (side view) at a point. */
  | { kind: 'bar'; x: number; y: number };

/** Foam roller radius (viewBox units). */
export const ROLLER_R = 7;

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

// --- Animation -----------------------------------------------------------------
//
// A figure animates by blending two RESOLVED poses in joint space and running
// the result back through buildPose, so every frame is drawn on the canonical
// skeleton: segment lengths never change mid-motion (only a declared
// foreshortening factor, itself interpolated). Spine, head and limb angles are
// interpolated RELATIVE to their parent segment along the shorter arc (author
// any movement as an arc under 180 degrees per joint). A limb whose end is
// targeted in both poses at the same kind of target (the same joint, or two
// floor/wall points) with the same bend keeps using IK toward the
// interpolated target, so planted hands and feet stay planted; one resting on
// the floor in both poses slides along the floor the same way.

/** Absolute angle (0 = up, 90 = right) of the vector from a to b. */
export function angleOf(a: Pt, b: Pt): number {
  return (Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180) / Math.PI;
}

/** Wrap an angle difference into [-180, 180). */
export function wrap180(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => a + wrap180(b - a) * t;

/** The angle-form spec that rebuilds a resolved pose exactly. */
export function specFromPose(p: Pose): PoseSpec {
  const j = p.joints;
  const limbA = (root: Pt, m: Pt, end: Pt, f1: number, f2: number): LimbSpec => ({
    a: [angleOf(root, m), angleOf(m, end)],
    fs: [f1, f2],
  });
  return {
    view: p.view,
    hip: j.hip,
    torso: [angleOf(j.hip, j.mid), angleOf(j.mid, j.neck)],
    head: angleOf(j.neck, j.head),
    face: p.face,
    la: limbA(j.lShoulder, j.lElbow, j.lHand, p.fs.lUpperArm, p.fs.lForearm),
    ra: limbA(j.rShoulder, j.rElbow, j.rHand, p.fs.rUpperArm, p.fs.rForearm),
    ll: limbA(j.lHip, j.lKnee, j.lFoot, p.fs.lThigh, p.fs.lShin),
    rl: limbA(j.rHip, j.rKnee, j.rFoot, p.fs.rThigh, p.fs.rShin),
    props: p.props,
    arrows: p.arrows,
    hl: p.hl,
    floor: p.floor,
    fingers: { l: p.fingers.l ?? undefined, r: p.fingers.r ?? undefined },
  };
}

/** Move a spec sideways: pelvis, absolute targets, arrows and props. */
export function shiftSpec(spec: PoseSpec, dx: number): PoseSpec {
  if (dx === 0) return spec;
  const sh = (p: Pt): Pt => [p[0] + dx, p[1]];
  const limbShift = (l: LimbSpec): LimbSpec =>
    'to' in l && Array.isArray(l.to) ? { ...l, to: sh(l.to as Pt) } : l;
  return {
    ...spec,
    hip: sh(spec.hip),
    la: limbShift(spec.la),
    ra: limbShift(spec.ra),
    ll: limbShift(spec.ll),
    rl: limbShift(spec.rl),
    arrows: spec.arrows?.map((a) => ({ ...a, from: sh(a.from), to: sh(a.to) })),
    props: spec.props?.map((p): Prop => {
      switch (p.kind) {
        case 'wall':
        case 'doorway':
        case 'chair':
        case 'chairFront':
        case 'roller':
        case 'bar':
          return { ...p, x: p.x + dx };
        default:
          return p;
      }
    }),
  };
}

type BlendLimb = 'la' | 'ra' | 'll' | 'rl';
const LIMB_JOINTS: Record<BlendLimb, readonly [JointName, JointName, JointName]> = {
  la: ['lShoulder', 'lElbow', 'lHand'],
  ra: ['rShoulder', 'rElbow', 'rHand'],
  ll: ['lHip', 'lKnee', 'lFoot'],
  rl: ['rHip', 'rKnee', 'rFoot'],
};

type RefTarget = { ref: JointName; dx?: number; dy?: number };

/** A side-view joint resting on (within a few units of) the floor line. */
function grounded(p: Pose, j: JointName): boolean {
  return p.floor && p.view === 'side' && p.joints[j][1] >= FLOOR_Y - 5;
}

/** Which side of the root → end line the middle joint sits on (see solveTwoBone). */
function bendSide(root: Pt, mid: Pt, end: Pt): 1 | -1 {
  const ux = end[0] - root[0];
  const uy = end[1] - root[1];
  return (mid[0] - root[0]) * uy - (mid[1] - root[1]) * ux >= 0 ? 1 : -1;
}

/**
 * The spec of the pose a fraction `t` of the way from `a` to `b` (t = 0 is
 * `a`, t = 1 is `b`). Both must share a view. Props, arrows, highlights and
 * the floor come from `b` (the pose being moved into). Pass the resolved
 * poses when already built, to skip rebuilding them.
 */
export function blendSpecs(
  a: PoseSpec,
  b: PoseSpec,
  t: number,
  pa: Pose = buildPose(a),
  pb: Pose = buildPose(b),
): PoseSpec {
  if (pa.view !== pb.view) {
    throw new Error(`Cannot blend a ${pa.view} pose with a ${pb.view} pose`);
  }
  const ja = pa.joints;
  const jb = pb.joints;

  const tlA = angleOf(ja.hip, ja.mid);
  const tlB = angleOf(jb.hip, jb.mid);
  const tuA = angleOf(ja.mid, ja.neck);
  const tuB = angleOf(jb.mid, jb.neck);
  const hA = angleOf(ja.neck, ja.head);
  const hB = angleOf(jb.neck, jb.head);

  const tl = lerpAngle(tlA, tlB, t);
  const tu = tl + lerpAngle(wrap180(tuA - tlA), wrap180(tuB - tlB), t);
  const head = tu + lerpAngle(wrap180(hA - tuA), wrap180(hB - tuB), t);

  let face: number | null;
  if (pb.face === null) face = pa.face === null || t >= 0.5 ? null : head + wrap180(pa.face - hA);
  else if (pa.face === null) face = head + wrap180(pb.face - hB);
  else face = head + lerpAngle(wrap180(pa.face - hA), wrap180(pb.face - hB), t);

  const parentA = { arm: tuA, leg: tlA };
  const parentB = { arm: tuB, leg: tlB };
  const parentT = { arm: tu, leg: tl };

  const limbAt = (k: BlendLimb): LimbSpec => {
    const sa = a[k];
    const sb = b[k];
    const fa = sa.fs ?? [1, 1];
    const fb = sb.fs ?? [1, 1];
    const fs: readonly [number, number] = [lerp(fa[0], fb[0], t), lerp(fa[1], fb[1], t)];
    if ('to' in sa && 'to' in sb && sa.bend === sb.bend) {
      if (Array.isArray(sa.to) && Array.isArray(sb.to)) {
        const pA = sa.to as Pt;
        const pB = sb.to as Pt;
        return { to: [lerp(pA[0], pB[0], t), lerp(pA[1], pB[1], t)], bend: sb.bend, fs };
      }
      if (!Array.isArray(sa.to) && !Array.isArray(sb.to)) {
        const ra = sa.to as RefTarget;
        const rb = sb.to as RefTarget;
        if (ra.ref === rb.ref) {
          return {
            to: {
              ref: rb.ref,
              dx: lerp(ra.dx ?? 0, rb.dx ?? 0, t),
              dy: lerp(ra.dy ?? 0, rb.dy ?? 0, t),
            },
            bend: sb.bend,
            fs,
          };
        }
      }
    }
    const [root, m, end] = LIMB_JOINTS[k];
    // A hand or foot resting on the floor at both ends slides along it (IK to
    // the interpolated contact, bending to the end pose's side) instead of
    // swinging through the floor.
    if (grounded(pa, end) && grounded(pb, end)) {
      const ea = ja[end];
      const eb = jb[end];
      const side = bendSide(jb[root], jb[m], eb);
      if (bendSide(ja[root], ja[m], ea) === side) {
        return { to: [lerp(ea[0], eb[0], t), lerp(ea[1], eb[1], t)], bend: side, fs };
      }
    }
    const kind = k === 'la' || k === 'ra' ? 'arm' : 'leg';
    const a1A = angleOf(ja[root], ja[m]);
    const a2A = angleOf(ja[m], ja[end]);
    const a1B = angleOf(jb[root], jb[m]);
    const a2B = angleOf(jb[m], jb[end]);
    const a1 =
      parentT[kind] + lerpAngle(wrap180(a1A - parentA[kind]), wrap180(a1B - parentB[kind]), t);
    const a2 = a1 + lerpAngle(wrap180(a2A - a1A), wrap180(a2B - a1B), t);
    return { a: [a1, a2], fs };
  };

  const fingers = (fa: number | null, fb: number | null) =>
    fa !== null && fb !== null ? lerpAngle(fa, fb, t) : (fb ?? undefined);

  return {
    view: pb.view,
    hip: [lerp(ja.hip[0], jb.hip[0], t), lerp(ja.hip[1], jb.hip[1], t)],
    torso: [tl, tu],
    head,
    face,
    la: limbAt('la'),
    ra: limbAt('ra'),
    ll: limbAt('ll'),
    rl: limbAt('rl'),
    props: pb.props,
    arrows: pb.arrows,
    hl: pb.hl,
    floor: pb.floor,
    fingers: { l: fingers(pa.fingers.l, pb.fingers.l), r: fingers(pa.fingers.r, pb.fingers.r) },
  };
}

/** {@link blendSpecs}, resolved. */
export function blendPose(a: PoseSpec, b: PoseSpec, t: number, pa?: Pose, pb?: Pose): Pose {
  return buildPose(blendSpecs(a, b, t, pa, pb));
}

/** One start → end → start cycle of a dynamic movement (ms). */
export const LOOP_MS = 3600;
/** A static hold eases in from this fraction of the way from its base pose. */
export const SETTLE_FROM = 0.75;
/** Length of the static ease-in (ms). */
export const SETTLE_MS = 1500;
/** Breathing once settled: depth (fraction of base → stretch) and period (ms). */
export const BREATHE_AMP = 0.035;
export const BREATHE_MS = 4000;

/**
 * Blend fraction at `ms` into the animation. 'loop': a dynamic movement,
 * eased start → end → start. 'settle': a static hold easing in from
 * {@link SETTLE_FROM} to the stretch, then breathing a little short of it and
 * back (it never passes the authored stretch).
 */
export function animT(mode: 'loop' | 'settle', ms: number): number {
  const m = Math.max(0, ms);
  if (mode === 'loop') {
    const u = (m % LOOP_MS) / LOOP_MS;
    return (1 - Math.cos(2 * Math.PI * u)) / 2;
  }
  if (m < SETTLE_MS) {
    const e = (1 - Math.cos((Math.PI * m) / SETTLE_MS)) / 2;
    return SETTLE_FROM + (1 - SETTLE_FROM) * e;
  }
  const v = ((m - SETTLE_MS) % BREATHE_MS) / BREATHE_MS;
  return 1 - (BREATHE_AMP * (1 - Math.cos(2 * Math.PI * v))) / 2;
}
