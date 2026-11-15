import { useId } from 'react';
import {
  FINGER_LEN,
  FLOOR_Y,
  HEAD_R,
  SEGMENTS,
  VIEW_H,
  VIEW_W,
  dir,
  type Arrow,
  type Pose,
  type Prop,
  type Pt,
  type SegmentName,
} from '../../core/stretch/pose.ts';
import { POSES } from '../../core/stretch/poses.ts';

export interface StretchFigureProps {
  /** A pose id (key of POSES) or a resolved pose. */
  pose: string | Pose;
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

const WIDTH: Partial<Record<SegmentName, number>> = { lowerTorso: 10, upperTorso: 10, neck: 5 };

/**
 * Stick/capsule figure for a stretch, drawn from pose data as inline SVG and
 * themed with the app tokens: body in --text-hi, the far-side limbs of a
 * profile in --cyan, the stretched region and direction arrows in --amber.
 */
export function StretchFigure({ pose, mirrored = false, title, className }: StretchFigureProps) {
  const rawId = useId();
  const markerId = `sfig-arrow-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const p = typeof pose === 'string' ? POSES[pose] : pose;
  if (!p) return null;

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
      className={['sfig', className ?? ''].filter(Boolean).join(' ')}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
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
          markerWidth="4"
          markerHeight="4"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" className="sfig__arrowhead" />
        </marker>
      </defs>
      <g transform={mirrored ? `matrix(-1 0 0 1 ${VIEW_W} 0)` : undefined}>
        {p.props.map((prop, i) => (
          <PropShape key={i} prop={prop} />
        ))}
        {p.floor && (
          <line className="sfig__floor" x1={4} y1={FLOOR_Y} x2={VIEW_W - 4} y2={FLOOR_Y} />
        )}
        <g strokeLinecap="round" strokeLinejoin="round">
          {body}
        </g>
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
      d={`M${x1},${y1} Q${cx},${cy} ${x2},${y2}`}
      markerEnd={`url(#${markerId})`}
    />
  );
}

function PropShape({ prop }: { prop: Prop }) {
  switch (prop.kind) {
    case 'wall':
      return <rect className="sfig__prop" x={prop.x} y={8} width={8} height={FLOOR_Y - 8} />;
    case 'doorway':
      return (
        <g className="sfig__prop">
          <rect x={prop.x - 6} y={8} width={6} height={FLOOR_Y - 8} />
          <rect x={prop.x - 30} y={8} width={30} height={5} />
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
        <rect className="sfig__mat" x={6} y={8} width={VIEW_W - 12} height={VIEW_H - 16} rx={6} />
      );
  }
}
