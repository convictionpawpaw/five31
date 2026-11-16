import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import {
  FINGER_LEN,
  FLOOR_Y,
  HEAD_R,
  ROLLER_R,
  SEGMENTS,
  VIEW_H,
  VIEW_W,
  animT,
  blendSpecs,
  buildPose,
  dir,
  shiftSpec,
  specFromPose,
  SETTLE_FROM,
  type Arrow,
  type Pose,
  type PoseSpec,
  type Prop,
  type Pt,
  type SegmentName,
} from '../../core/stretch/pose.ts';
import { POSES, POSE_BASE, POSE_SPECS } from '../../core/stretch/poses.ts';
import './figure.css';

export interface StretchFigureProps {
  /** A pose id (key of POSES) or a resolved pose. */
  pose: string | Pose;
  /**
   * Start pose of a dynamic movement. With `animate`, the figure loops
   * poseFrom → pose → poseFrom. Pass a stable value (an id, or a memoised
   * pose): a new object every render restarts the animation.
   */
  poseFrom?: string | Pose;
  /**
   * Animate the figure (default false: a still drawing, exactly as before).
   * A dynamic movement (poseFrom given) loops between its two poses; a static
   * hold eases in from its neutral base pose and then breathes slightly.
   * Ignored under prefers-reduced-motion (the end pose is drawn).
   */
  animate?: boolean;
  /** Mirror horizontally (the right-side step of a bilateral stretch). */
  mirrored?: boolean;
  /** Accessible label; omit for a decorative thumbnail. */
  title?: string;
  className?: string;
}

/** Segment draw groups, back to front. */
const SIDE_FAR: SegmentName[] = ['rThigh', 'rShin', 'rUpperArm', 'rForearm'];
const SIDE_NEAR_LEGS: SegmentName[] = ['lThigh', 'lShin'];
const SIDE_NEAR_ARMS: SegmentName[] = ['lUpperArm', 'lForearm'];
const FRONT_LEGS: SegmentName[] = ['lThigh', 'lShin', 'rThigh', 'rShin'];
const FRONT_ARMS: SegmentName[] = ['lUpperArm', 'lForearm', 'rUpperArm', 'rForearm'];
const TORSO: SegmentName[] = ['lowerTorso', 'upperTorso'];

/** Tapered limb widths: heavier trunk and thighs read as a body, not a stick. */
const WIDTH: Partial<Record<SegmentName, number>> = {
  lowerTorso: 13,
  upperTorso: 14,
  neck: 5.5,
  lThigh: 8.5,
  rThigh: 8.5,
  lShin: 6.5,
  rShin: 6.5,
  lUpperArm: 6.5,
  rUpperArm: 6.5,
  lForearm: 5.5,
  rForearm: 5.5,
};

/** Tightest zoom allowed, so small floor poses don't become all head. */
const MAX_ZOOM = 1.7;
const FIT_PAD = 12;
/** Animation frame cap (about 30 fps). */
const FRAME_MS = 1000 / 30;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The view box that frames a pose: the bounds of the figure, its arrows
 * and props, padded, grown to the canonical aspect ratio and capped at
 * {@link MAX_ZOOM}. A fixed frame left crouched and lying poses tiny.
 * `extra` adds more joint sets (an animation's other frames) so the frame
 * holds still while the figure moves; props, arrows and the floor come
 * from `p`.
 */
function fitBox(p: Pose, extra: readonly Pose[] = []): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number, r = 0) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    x0 = Math.min(x0, x - r);
    y0 = Math.min(y0, y - r);
    x1 = Math.max(x1, x + r);
    y1 = Math.max(y1, y + r);
  };
  for (const q of [p, ...extra]) {
    for (const [name, pt] of Object.entries(q.joints) as [string, Pt][]) {
      add(pt[0], pt[1], name === 'head' ? HEAD_R + 4 : 7);
    }
  }
  for (const a of p.arrows) {
    add(a.from[0], a.from[1], 6);
    add(a.to[0], a.to[1], 8);
  }
  for (const prop of p.props) {
    if (prop.kind === 'wall') add(prop.x + 4, y0, 6);
    else if (prop.kind === 'doorway') add(prop.x - 3, y0, 6);
    else if (prop.kind === 'chair') {
      add(prop.x - 5, prop.seatY - 46);
      add(prop.x + 40, FLOOR_Y);
    } else if (prop.kind === 'chairFront') {
      add(prop.x - 28, prop.seatY - 56);
      add(prop.x + 28, FLOOR_Y);
    } else if (prop.kind === 'roller') {
      add(prop.x, FLOOR_Y - ROLLER_R, ROLLER_R);
    } else if (prop.kind === 'bar') {
      add(prop.x, prop.y, 6);
    }
  }
  if (p.floor) add((x0 + x1) / 2, FLOOR_Y, 2);
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: VIEW_W, h: VIEW_H };

  let w = x1 - x0 + FIT_PAD * 2;
  let h = y1 - y0 + FIT_PAD * 2;
  const aspect = VIEW_W / VIEW_H;
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  if (w < VIEW_W / MAX_ZOOM) {
    w = VIEW_W / MAX_ZOOM;
    h = VIEW_H / MAX_ZOOM;
  }
  const cx = (x0 + x1) / 2;
  // Floor poses sit on the bottom edge of the frame rather than floating.
  const y = p.floor
    ? Math.min((y0 + y1) / 2 - h / 2, FLOOR_Y + FIT_PAD - h)
    : (y0 + y1) / 2 - h / 2;
  return { x: cx - w / 2, y, w, h };
}

// --- Animation plan ---------------------------------------------------------------

interface Plan {
  mode: 'loop' | 'settle';
  a: PoseSpec;
  b: PoseSpec;
  pa: Pose;
  pb: Pose;
  /** Frame fixed for the whole animation (union of sampled frames). */
  box: Box;
}

function resolve(p: string | Pose): { spec: PoseSpec; pose: Pose } | null {
  if (typeof p === 'string') {
    const pose = POSES[p];
    const spec = POSE_SPECS[p];
    return pose && spec ? { spec, pose } : null;
  }
  return { spec: specFromPose(p), pose: p };
}

/**
 * How a figure animates, or null to draw it still: no `poseFrom` and no base
 * listed for the pose (or opted out), or the two poses cannot be blended.
 */
function makePlan(pose: string | Pose, poseFrom: string | Pose | undefined): Plan | null {
  const end = resolve(pose);
  if (!end) return null;
  let mode: Plan['mode'];
  let start: { spec: PoseSpec; pose: Pose } | null;
  if (poseFrom !== undefined) {
    mode = 'loop';
    start = resolve(poseFrom);
  } else {
    mode = 'settle';
    const baseId = typeof pose === 'string' ? POSE_BASE[pose] : null;
    const base = baseId ? resolve(baseId) : null;
    if (base) {
      // Line the base up under the stretch so the ease-in never slides sideways.
      const spec = shiftSpec(base.spec, end.pose.joints.hip[0] - base.pose.joints.hip[0]);
      start = { spec, pose: buildPose(spec) };
    } else start = null;
  }
  if (!start || start.pose.view !== end.pose.view) return null;
  try {
    const ts =
      mode === 'loop'
        ? [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]
        : [SETTLE_FROM, SETTLE_FROM + (1 - SETTLE_FROM) / 2];
    const frames = ts.map((t) =>
      buildPose(blendSpecs(start.spec, end.spec, t, start.pose, end.pose)),
    );
    return {
      mode,
      a: start.spec,
      b: end.spec,
      pa: start.pose,
      pb: end.pose,
      box: fitBox(end.pose, frames),
    };
  } catch {
    return null;
  }
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(REDUCED_MOTION);
  mq.addEventListener?.('change', onChange);
  return () => mq.removeEventListener?.('change', onChange);
}
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(REDUCED_MOTION).matches
  );
}

/**
 * Elapsed animation time for `plan`, advanced by requestAnimationFrame at up
 * to {@link FRAME_MS}. Paused while the document is hidden or the figure is
 * scrolled out of view; restarts from 0 when the plan changes.
 */
function usePlanClock(plan: Plan | null, el: RefObject<SVGSVGElement | null>): number {
  const [clock, setClock] = useState<{ plan: Plan | null; ms: number }>({ plan: null, ms: 0 });
  useEffect(() => {
    if (!plan) return;
    let raf = 0;
    let last = -1;
    let lastPaint = -Infinity;
    let ms = 0;
    let inView = true;
    const tick = (now: number) => {
      raf = 0;
      if (last >= 0) ms += Math.min(now - last, 100);
      last = now;
      if (now - lastPaint >= FRAME_MS - 2) {
        lastPaint = now;
        setClock({ plan, ms });
      }
      schedule();
    };
    const schedule = () => {
      if (!raf && inView && !document.hidden) raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      last = -1;
    };
    const onVisibility = () => (document.hidden ? stop() : schedule());
    document.addEventListener('visibilitychange', onVisibility);
    let io: IntersectionObserver | undefined;
    const node = el.current;
    if (node && typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((entries) => {
        inView = entries.some((e) => e.isIntersecting);
        if (inView) schedule();
        else stop();
      });
      io.observe(node);
    }
    schedule();
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      io?.disconnect();
    };
  }, [plan, el]);
  return clock.plan === plan ? clock.ms : 0;
}

/**
 * Stick/capsule figure for a stretch, drawn from pose data as inline SVG and
 * themed with the app tokens: body in --text-hi, the far-side limbs of a
 * profile in --cyan, the stretched region and direction arrows in --amber.
 */
export function StretchFigure({
  pose,
  poseFrom,
  animate = false,
  mirrored = false,
  title,
  className,
}: StretchFigureProps) {
  const rawId = useId();
  const markerId = `sfig-arrow-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const reduced = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
  const plan = useMemo(
    () => (animate && !reduced ? makePlan(pose, poseFrom) : null),
    [animate, reduced, pose, poseFrom],
  );
  const ms = usePlanClock(plan, svgRef);

  const still = typeof pose === 'string' ? POSES[pose] : pose;
  if (!still) return null;

  const p = plan
    ? buildPose(blendSpecs(plan.a, plan.b, animT(plan.mode, ms), plan.pa, plan.pb))
    : still;
  const box = plan ? plan.box : fitBox(still);

  const j = p.joints;
  const hl = new Set(p.hl);
  const side = p.view === 'side';

  const seg = (name: SegmentName, far = false) => {
    const [a, b] = SEGMENTS[name];
    const cls = hl.has(name) ? 'sfig__hl' : far ? 'sfig__far' : 'sfig__body';
    return (
      <line
        key={name}
        className={cls}
        x1={j[a][0]}
        y1={j[a][1]}
        x2={j[b][0]}
        y2={j[b][1]}
        strokeWidth={WIDTH[name] ?? 6}
      />
    );
  };

  const fingers = (hand: Pt, angle: number | null, far: boolean, key: string) => {
    if (angle === null) return null;
    const v = dir(angle);
    return (
      <line
        key={key}
        className={far ? 'sfig__far' : 'sfig__body'}
        x1={hand[0]}
        y1={hand[1]}
        x2={hand[0] + v[0] * FINGER_LEN}
        y2={hand[1] + v[1] * FINGER_LEN}
        strokeWidth={3}
      />
    );
  };

  const headEl = (
    <g key="head">
      <circle
        className={hl.has('neck') ? 'sfig__head sfig__head--hl' : 'sfig__head'}
        cx={j.head[0]}
        cy={j.head[1]}
        r={HEAD_R}
      />
      {p.face !== null && (
        <line
          className="sfig__face"
          x1={j.head[0] + dir(p.face)[0] * (HEAD_R - 3)}
          y1={j.head[1] + dir(p.face)[1] * (HEAD_R - 3)}
          x2={j.head[0] + dir(p.face)[0] * (HEAD_R + 4)}
          y2={j.head[1] + dir(p.face)[1] * (HEAD_R + 4)}
          strokeWidth={4}
        />
      )}
    </g>
  );

  const girdles = side ? null : (
    <g key="girdles">
      <line
        className="sfig__body"
        x1={j.lShoulder[0]}
        y1={j.lShoulder[1]}
        x2={j.rShoulder[0]}
        y2={j.rShoulder[1]}
        strokeWidth={7}
      />
      <line
        className="sfig__body"
        x1={j.lHip[0]}
        y1={j.lHip[1]}
        x2={j.rHip[0]}
        y2={j.rHip[1]}
        strokeWidth={7}
      />
    </g>
  );

  const body = side ? (
    <>
      {SIDE_FAR.map((s) => seg(s, true))}
      {fingers(j.rHand, p.fingers.r, true, 'rf')}
      {TORSO.map((s) => seg(s))}
      {seg('neck')}
      {headEl}
      {SIDE_NEAR_LEGS.map((s) => seg(s))}
      {SIDE_NEAR_ARMS.map((s) => seg(s))}
      {fingers(j.lHand, p.fingers.l, false, 'lf')}
    </>
  ) : (
    <>
      {FRONT_LEGS.map((s) => seg(s))}
      {TORSO.map((s) => seg(s))}
      {girdles}
      {seg('neck')}
      {headEl}
      {FRONT_ARMS.map((s) => seg(s))}
      {fingers(j.lHand, p.fingers.l, false, 'lf')}
      {fingers(j.rHand, p.fingers.r, false, 'rf')}
    </>
  );

  return (
    <svg
      ref={svgRef}
      className={['sfig', plan ? 'sfig--animated' : '', className ?? ''].filter(Boolean).join(' ')}
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="4.5"
          markerHeight="4.5"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" className="sfig__arrowhead" />
        </marker>
      </defs>
      <g transform={mirrored ? `matrix(-1 0 0 1 ${2 * box.x + box.w} 0)` : undefined}>
        {p.props.map((prop, i) => (
          <PropShape key={i} prop={prop} box={box} />
        ))}
        {p.floor && (
          <line
            className="sfig__floor"
            x1={box.x + 4}
            y1={FLOOR_Y}
            x2={box.x + box.w - 4}
            y2={FLOOR_Y}
          />
        )}
        <g strokeLinecap="round" strokeLinejoin="round">
          {body}
        </g>
        {p.props.map((prop, i) =>
          prop.kind === 'band' ? (
            <line
              key={`band${i}`}
              className="sfig__band"
              x1={j[prop.a][0]}
              y1={j[prop.a][1]}
              x2={j[prop.b][0]}
              y2={j[prop.b][1]}
            />
          ) : null,
        )}
        {p.arrows.map((a, i) => (
          <ArrowShape key={i} arrow={a} markerId={markerId} />
        ))}
      </g>
    </svg>
  );
}

function ArrowShape({ arrow, markerId }: { arrow: Arrow; markerId: string }) {
  const [x1, y1] = arrow.from;
  const [x2, y2] = arrow.to;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  // Screen-left normal of the from→to direction.
  const nx = (y2 - y1) / len;
  const ny = -(x2 - x1) / len;
  const bend = arrow.bend ?? 0;
  const cx = mx + nx * bend;
  const cy = my + ny * bend;
  return (
    <path
      className="sfig__arrow"
      style={{ strokeWidth: 3.5 }}
      d={`M${x1},${y1} Q${cx},${cy} ${x2},${y2}`}
      markerEnd={`url(#${markerId})`}
    />
  );
}

function PropShape({ prop, box }: { prop: Prop; box: Box }) {
  const top = box.y + 4;
  switch (prop.kind) {
    case 'wall':
      return <rect className="sfig__prop" x={prop.x} y={top} width={8} height={FLOOR_Y - top} />;
    case 'doorway':
      return (
        <g className="sfig__prop">
          <rect x={prop.x - 6} y={top} width={6} height={FLOOR_Y - top} />
          <rect x={prop.x - 30} y={top} width={30} height={5} />
        </g>
      );
    case 'chair':
      return (
        <g className="sfig__prop">
          <rect x={prop.x - 5} y={prop.seatY - 46} width={5} height={50} />
          <rect x={prop.x} y={prop.seatY} width={40} height={5} />
          <rect x={prop.x + 2} y={prop.seatY + 5} width={4} height={FLOOR_Y - prop.seatY - 5} />
          <rect x={prop.x + 34} y={prop.seatY + 5} width={4} height={FLOOR_Y - prop.seatY - 5} />
        </g>
      );
    case 'chairFront':
      return (
        <g className="sfig__prop">
          <rect
            x={prop.x - 24}
            y={prop.seatY - 56}
            width={48}
            height={56}
            className="sfig__prop-back"
          />
          <rect x={prop.x - 28} y={prop.seatY} width={56} height={5} />
          <rect x={prop.x - 26} y={prop.seatY + 5} width={4} height={FLOOR_Y - prop.seatY - 5} />
          <rect x={prop.x + 22} y={prop.seatY + 5} width={4} height={FLOOR_Y - prop.seatY - 5} />
        </g>
      );
    case 'mat':
      return (
        <rect
          className="sfig__mat"
          x={box.x + 4}
          y={box.y + 4}
          width={box.w - 8}
          height={box.h - 8}
          rx={6}
        />
      );
    case 'wallBehind':
      return (
        <rect
          className="sfig__wall-behind"
          x={box.x + 4}
          y={top}
          width={box.w - 8}
          height={FLOOR_Y - top}
        />
      );
    case 'roller':
      return <circle className="sfig__roller" cx={prop.x} cy={FLOOR_Y - ROLLER_R} r={ROLLER_R} />;
    case 'bar':
      return <circle className="sfig__bar" cx={prop.x} cy={prop.y} r={4.5} />;
    case 'band':
      // Drawn over the figure, after the body.
      return null;
  }
}
