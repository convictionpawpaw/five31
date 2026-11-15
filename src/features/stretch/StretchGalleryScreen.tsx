import { Link } from 'react-router-dom';
import { BODY_AREAS, BODY_AREA_LABELS } from '../../core/stretch/types.ts';
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

/**
 * Every stretch in the library with its figure, areas and cues, grouped by
 * primary area. Doubles as the visual QA page for the illustrations.
 */
export function StretchGalleryScreen() {
  const groups = BODY_AREAS.map((area) => ({
    area,
    stretches: STRETCHES.filter((s) => s.areas[0] === area),
  })).filter((g) => g.stretches.length > 0);

  return (
    <div className="stretch safe-top">
      <header className="stretch__head">
        <h1 className="stretch__title label label-hi">All stretches</h1>
        <Link to="/stretch" className="stretch__link label">
          ← Stretch
        </Link>
      </header>
      <p className="stretch__disclaimer">
        {STRETCHES.length} stretches. Amber marks where you should feel it. General flexibility
        guidance, not medical advice; stop any stretch that causes pain.
      </p>

      {groups.map((g) => (
        <section key={g.area} className="sgallery__group">
          <h2 className="sgallery__heading label text-cyan">{BODY_AREA_LABELS[g.area]}</h2>
          {g.stretches.map((s) => (
            <HudPanel key={s.id} className="sgallery__card" id={`stretch-${s.id}`}>
              <StretchFigure pose={s.pose} title={s.name} className="sgallery__figure" />
              <div className="sgallery__body">
                <h3 className="sgallery__name">{s.name}</h3>
                <p className="label">{s.areas.map((a) => BODY_AREA_LABELS[a]).join(' · ')}</p>
                <p className="label text-low">
                  {POSITION_LABEL[s.position]} · {s.bilateral ? 'Each side' : 'Once'} · {s.holdSec}s
                </p>
                <ul className="sgallery__cues">
                  {s.cues.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            </HudPanel>
          ))}
        </section>
      ))}
    </div>
  );
}
