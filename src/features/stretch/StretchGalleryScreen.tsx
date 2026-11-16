import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BODY_AREAS,
  BODY_AREA_LABELS,
  type Equipment,
  type Stretch,
  type WarmupLift,
} from '../../core/stretch/types.ts';
import { STRETCHES } from '../../core/stretch/library.ts';
import { HudPanel } from '../../components/index.ts';
import { StretchFigure } from './StretchFigure.tsx';
import './stretch.css';

const POSITION_LABEL = {
  standing: 'Standing',
  seated: 'Chair',
  kneeling: 'Kneeling',
  floor: 'Floor',
} as const;

const EQUIPMENT_LABEL: Record<Equipment, string> = {
  chair: 'chair',
  wall: 'wall',
  doorway: 'doorway',
  band: 'band',
  roller: 'foam roller',
  bar: 'pull-up bar',
};

const LIFT_LABEL: Record<WarmupLift, string> = {
  press: 'Press',
  bench: 'Bench',
  squat: 'Squat',
  deadlift: 'Deadlift',
};

/**
 * Every stretch in the library with its figure, areas and cues: static holds
 * grouped by primary area, then the dynamic warm-up movements. A chair
 * stretch with a no-chair variant shows both figures. Doubles as the visual
 * QA page for the illustrations; the Animate switch plays every figure.
 */
export function StretchGalleryScreen() {
  const [animate, setAnimate] = useState(false);
  const statics = STRETCHES.filter((s) => s.kind !== 'dynamic');
  const dynamic = STRETCHES.filter((s) => s.kind === 'dynamic');
  const groups = BODY_AREAS.map((area) => ({
    key: area as string,
    title: BODY_AREA_LABELS[area],
    stretches: statics.filter((s) => s.areas[0] === area),
  }))
    .filter((g) => g.stretches.length > 0)
    .concat(
      dynamic.length > 0 ? [{ key: 'warmup', title: 'Warm-up movements', stretches: dynamic }] : [],
    );

  return (
    <div className="stretch safe-top">
      <header className="stretch__head">
        <h1 className="stretch__title label label-hi">All stretches</h1>
        <Link to="/stretch" className="stretch__link label">
          ← Stretch
        </Link>
      </header>
      <p className="stretch__disclaimer">
        {statics.length} stretches and {dynamic.length} warm-up movements. Amber marks where you
        should feel it. General flexibility guidance, not medical advice; stop any stretch that
        causes pain.
      </p>
      <label className="sgallery__animate label">
        <input
          type="checkbox"
          checked={animate}
          onChange={(e) => setAnimate(e.currentTarget.checked)}
        />
        Animate
      </label>

      {groups.map((g) => (
        <section key={g.key} className="sgallery__group">
          <h2 className="sgallery__heading label text-cyan">{g.title}</h2>
          {g.stretches.map((s) => (
            <GalleryCard key={s.id} stretch={s} animate={animate} />
          ))}
        </section>
      ))}
    </div>
  );
}

function GalleryCard({ stretch: s, animate }: { stretch: Stretch; animate: boolean }) {
  const v = s.noChair;
  const tags = [
    ...(s.equipment ?? []).map((e) => EQUIPMENT_LABEL[e]),
    ...(s.calming ? ['calming'] : []),
  ];
  return (
    <HudPanel
      className={`sgallery__card${v ? ' sgallery__card--pair' : ''}`}
      id={`stretch-${s.id}`}
    >
      {v ? (
        <div className="sgallery__pair">
          <figure className="sgallery__fig">
            <StretchFigure
              pose={s.pose}
              title={s.name}
              animate={animate}
              className="sgallery__figure"
            />
            <figcaption className="label text-low">Chair</figcaption>
          </figure>
          <figure className="sgallery__fig">
            <StretchFigure
              pose={v.pose}
              title={`${s.name}, no chair`}
              animate={animate}
              className="sgallery__figure"
            />
            <figcaption className="label text-low">
              No chair · {POSITION_LABEL[v.position]}
            </figcaption>
          </figure>
        </div>
      ) : (
        <StretchFigure
          pose={s.pose}
          poseFrom={s.poseFrom}
          title={s.name}
          animate={animate}
          className="sgallery__figure"
        />
      )}
      <div className="sgallery__body">
        <h3 className="sgallery__name">{s.name}</h3>
        <p className="label">{s.areas.map((a) => BODY_AREA_LABELS[a]).join(' · ')}</p>
        <p className="label text-low">
          {POSITION_LABEL[s.position]} · {s.bilateral ? 'Each side' : 'Once'} · {s.holdSec}s
          {tags.length > 0 && ` · ${tags.join(' · ')}`}
        </p>
        {s.warmupFor && (
          <p className="label text-low">
            Warms up: {s.warmupFor.map((l) => LIFT_LABEL[l]).join(' · ')}
          </p>
        )}
        <ul className="sgallery__cues">
          {s.cues.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        {v?.cues && (
          <>
            <p className="label text-low">Without a chair:</p>
            <ul className="sgallery__cues">
              {v.cues.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </HudPanel>
  );
}
