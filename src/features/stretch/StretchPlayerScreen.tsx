import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Routine, RoutineStep } from '../../core/stretch/types.ts';
import { getStretch } from '../../core/stretch/library.ts';
import { computeStreak } from '../../core/stretch/streak.ts';
import { localIsoDate } from '../../core/localDate.ts';
import { addSavedRoutine, addStretchSession, listStretchSessions } from '../../db/repo/index.ts';
import { Button, HudPanel, Modal, useToast } from '../../components/index.ts';
import { useWakeLock } from '../workout/useWakeLock.ts';
import { StretchFigure } from './StretchFigure.tsx';
import { StreakPanel } from './StreakPanel.tsx';
import { backTarget, buildTimeline, locate, skipTarget } from './playerTimeline.ts';
import {
  catchUpClock,
  freezeClock,
  hideClock,
  pauseClock,
  pausedClock,
  readClock,
  resumeClock,
  seekClock,
  startClock,
  type Clock,
} from './playerClock.ts';
import { clearAutostart, isAutostartFresh } from './playerLaunch.ts';
import {
  audioRunning,
  cueDone,
  cueHoldEnd,
  cueHoldStart,
  cueTick,
  onAudioStateChange,
  resumeAudio,
} from './stretchAudio.ts';
import { loadStretchPrefs, saveStretchPrefs } from './stretchPrefs.ts';
import { fmtClock } from './stretchFormat.ts';
import { defaultRoutineName, repLabel, transitionKind } from './routineFormat.ts';
import { RoutineNameModal } from './RoutineNameModal.tsx';
import { useToday } from './useToday.ts';
import './stretch.css';

/**
 * Router state for /stretch/play. `done` marks a routine already saved;
 * `fromSaved` a routine started from the saved list.
 */
interface PlayState {
  routine?: Routine;
  done?: boolean;
  fromSaved?: boolean;
}

/** Validate router state into a playable routine (every stretch id known). */
function parseRoutine(state: unknown): Routine | null {
  const r = (state as PlayState | null)?.routine;
  if (!r || !Array.isArray(r.steps) || r.steps.length === 0) return null;
  for (const st of r.steps) {
    if (!st || typeof st.holdSec !== 'number' || !getStretch(st.stretchId)) return null;
  }
  return r;
}

/**
 * Guided stretch player (/stretch/play). The routine arrives as router state
 * from the Stretch screen; opened without one (a bookmark, a cleared history
 * entry) or on an entry whose routine was already saved (a reload on the
 * completion view) it redirects back to /stretch.
 */
export function StretchPlayerScreen() {
  const location = useLocation();
  const routine = useMemo(() => parseRoutine(location.state), [location.state]);
  // Read once at mount: the completion view itself marks the entry done.
  const [alreadyDone] = useState(() => (location.state as PlayState | null)?.done === true);
  const [fromSaved] = useState(() => (location.state as PlayState | null)?.fromSaved === true);
  if (!routine || alreadyDone) return <Navigate to="/stretch" replace />;
  return <Player routine={routine} fromSaved={fromSaved} />;
}

interface Finished {
  actualSec: number;
  /** Local day the session was saved under (the day it was started). */
  date: string;
}

/** Why a paused player is paused, for the copy. */
type PauseReason = 'start' | 'away' | 'user' | null;

interface ConfirmEnd {
  /** Resume when the dialog is dismissed. */
  resume: boolean;
  /** Raised by a blocked navigation (tab, back swipe) rather than End. */
  viaBlocker: boolean;
}

/** A gap this long between renders while running means the page was frozen. */
const STALL_MS = 4000;
/** Body class that hides the tab bar while a routine is in progress. */
const PLAYING_CLASS = 'stretch-playing';

function Player({ routine, fromSaved }: { routine: Routine; fromSaved: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const timeline = useMemo(() => buildTimeline(routine.steps), [routine]);
  const totalMs = timeline.totalMs;
  const [startedAt] = useState(() => Date.now());

  // Auto-start only when mounted straight from the Start tap; any other mount
  // (reload, history forward) waits paused on the get-ready step.
  const [autostart] = useState(() => isAutostartFresh());
  useEffect(() => clearAutostart(), []);

  // The clock lives in a ref (read at tap time) mirrored into state (render).
  const [clock, setClockState] = useState<Clock>(() =>
    autostart ? startClock(Date.now()) : pausedClock(),
  );
  const clockRef = useRef(clock);
  const setClock = useCallback((fn: (c: Clock) => Clock) => {
    clockRef.current = fn(clockRef.current);
    setClockState(clockRef.current);
  }, []);

  const [now, setNow] = useState(() => Date.now());
  const lastSeenRef = useRef(Date.now());
  const [pauseReason, setPauseReason] = useState<PauseReason>(autostart ? null : 'start');
  const [muted, setMuted] = useState(() => loadStretchPrefs().muted);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState<ConfirmEnd | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [finished, setFinished] = useState<Finished | null>(null);
  /** Set once a finish (save or discard) has begun: nothing may start another. */
  const finishedRef = useRef(false);
  const mutedRef = useRef(muted);
  const heldIds = useRef(new Set<string>());
  /** Set by Back so its phase change plays no "hold end" cue. */
  const seekCauseRef = useRef<'back' | 'skip' | null>(null);

  const reading = readClock(clock, now, totalMs);
  const running = reading.running;
  const elapsed = reading.elapsedMs;
  const activeSec = Math.round(reading.activeMs / 1000);
  const pos = locate(timeline, elapsed);
  const phase = pos.phase;
  const phaseKey = pos.done ? -1 : pos.index;
  const secLeft = Math.ceil(pos.remainingMs / 1000);

  const inProgress = finished === null && !finishing;
  const inProgressRef = useRef(inProgress);
  useEffect(() => {
    inProgressRef.current = inProgress;
  }, [inProgress]);

  useWakeLock(running && !pos.done && inProgress);

  /** Seconds actually stretched, read from the clock at this instant. */
  const activeSecNow = useCallback(
    () => Math.round(readClock(clockRef.current, Date.now(), totalMs).activeMs / 1000),
    [totalMs],
  );

  // --- Audio --------------------------------------------------------------------
  /** Try to bring audio up; flag it when sound is wanted but unavailable. */
  const kickAudio = useCallback(() => {
    void resumeAudio().then((ok) => setSoundBlocked(!ok));
  }, []);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    // Started from the Start tap: the context was unlocked there; confirm it.
    if (autostart) kickAudio();
  }, [autostart, kickAudio]);

  // Track context state changes (an iOS interruption, a resume). Re-subscribed
  // when the flag or running state changes, since the context may only have
  // been created by a later tap.
  useEffect(
    () => onAudioStateChange(() => setSoundBlocked(!audioRunning())),
    [soundBlocked, running],
  );

  // --- Clock driving ---------------------------------------------------------------
  /** Pause because the page went away; time while hidden never counts. */
  const pauseAway = useCallback(
    (at: number) => {
      if (finishedRef.current || clockRef.current.since === null) return;
      setClock((c) => hideClock(c, at, totalMs));
      setPauseReason('away');
      setNow(at);
    },
    [setClock, totalMs],
  );

  /** Guard for a missed hide event: pause at the last moment we were seen. */
  const checkStall = useCallback(
    (t: number): boolean => {
      const { clock: next, stalled } = catchUpClock(
        clockRef.current,
        lastSeenRef.current,
        t,
        STALL_MS,
        totalMs,
      );
      lastSeenRef.current = t;
      if (!stalled || finishedRef.current) return false;
      setClock(() => next);
      setPauseReason('away');
      return true;
    },
    [setClock, totalMs],
  );

  // Re-render from the clock; the interval only triggers renders, it never
  // accumulates time (so throttling can't make the timer drift).
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const t = Date.now();
      checkStall(t);
      setNow(t);
    }, 200);
    return () => clearInterval(id);
  }, [running, checkStall]);

  // Hidden (lock, app switch, tab close) pauses at that instant. Coming back
  // stays paused until the user taps Resume.
  useEffect(() => {
    const onVis = () => {
      const t = Date.now();
      if (document.visibilityState === 'hidden') {
        pauseAway(t);
      } else {
        checkStall(t);
        setNow(t);
        if (!mutedRef.current) kickAudio();
      }
    };
    const onPageHide = () => pauseAway(Date.now());
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [pauseAway, checkStall, kickAudio]);

  // Hide the tab bar while a routine is in progress (it sits right under End).
  useEffect(() => {
    if (finished !== null) return;
    document.body.classList.add(PLAYING_CLASS);
    return () => document.body.classList.remove(PLAYING_CLASS);
  }, [finished]);

  // --- Progress tracking and cues ------------------------------------------------
  // Track which stretches were actually reached (a hold was entered).
  useEffect(() => {
    if (phase?.kind === 'hold') {
      const st = routine.steps[phase.stepIndex];
      if (st) heldIds.current.add(st.stretchId);
    }
  }, [phase, routine]);

  // Cue at every phase change (not on the initial get-ready, never after a
  // finish has begun, and no "hold end" when Back left the hold).
  const lastPhase = useRef(phaseKey);
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    if (lastPhase.current === phaseKey) return;
    lastPhase.current = phaseKey;
    const cause = seekCauseRef.current;
    seekCauseRef.current = null;
    if (finishedRef.current || phase === null) return;
    // Visual cue for silent mode / no haptics on iOS.
    setFlash((n) => n + 1);
    if (phase.kind === 'hold') cueHoldStart(!mutedRef.current);
    else if (cause !== 'back') cueHoldEnd(!mutedRef.current);
  }, [phaseKey, phase]);

  // 3-2-1 ticks at the end of each hold: once per (phase, second), so pausing
  // and resuming inside the last 3 s does not tick again.
  const lastTick = useRef<string | null>(null);
  useEffect(() => {
    if (!running || finishedRef.current) return;
    if (phase?.kind === 'hold' && secLeft >= 1 && secLeft <= 3) {
      const k = `${phaseKey}:${secLeft}`;
      if (lastTick.current === k) return;
      lastTick.current = k;
      cueTick(!mutedRef.current);
    }
  }, [secLeft, phaseKey, phase, running]);

  // --- Finish -------------------------------------------------------------------
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      inProgressRef.current &&
      !finishedRef.current &&
      currentLocation.pathname !== nextLocation.pathname,
  );
  const blockerRef = useRef(blocker);
  useEffect(() => {
    blockerRef.current = blocker;
  }, [blocker]);

  const sessionRecord = useCallback(
    (actualSec: number) => ({
      date: localIsoDate(new Date(startedAt)),
      startedAt,
      completedAt: Date.now(),
      plannedSec: routine.totalSec,
      actualSec,
      minutes: routine.minutes,
      focusAreas: routine.focusAreas,
      stretchIds: [...new Set(routine.steps.map((s) => s.stretchId))].filter((id) =>
        heldIds.current.has(id),
      ),
    }),
    [routine, startedAt],
  );

  /**
   * Save (at least half done) or discard. `leave` continues a blocked
   * navigation afterwards instead of showing the completion view.
   */
  const finish = useCallback(
    async (reason: 'complete' | 'ended', actualSec: number, leave: boolean) => {
      finishedRef.current = true;
      inProgressRef.current = false;
      // Freeze where it ended so the display doesn't snap back and no cue fires.
      setClock((c) => freezeClock(c, Date.now(), totalMs));
      setFinishing(true);
      const exit = () => {
        const b = blockerRef.current;
        if (leave && b.state === 'blocked') b.proceed();
        else navigate('/stretch', { replace: true });
      };
      if (actualSec * 2 < routine.totalSec) {
        toast.show(
          reason === 'ended'
            ? 'Ended before halfway: session not saved'
            : 'Less than half was done: session not saved',
          'info',
        );
        exit();
        return;
      }
      const record = sessionRecord(actualSec);
      try {
        await addStretchSession(record);
      } catch {
        toast.show('Could not save the session', 'danger');
        exit();
        return;
      }
      cueDone(!mutedRef.current);
      if (leave) {
        toast.show('Stretch session saved', 'info');
        exit();
        return;
      }
      setFinished({ actualSec, date: record.date });
      // Mark this history entry done so a reload lands on /stretch instead of
      // replaying the routine.
      const state: PlayState = { routine, done: true, fromSaved };
      navigate('/stretch/play', { replace: true, state });
    },
    [routine, fromSaved, totalMs, toast, navigate, setClock, sessionRecord],
  );

  // Natural completion.
  useEffect(() => {
    if (!pos.done || finishedRef.current) return;
    void finish('complete', activeSecNow(), false);
  }, [pos.done, finish, activeSecNow]);

  // Unmounted mid-routine without a navigation we saw (best effort): keep a
  // session that was at least half done. Strict Mode's mount/unmount check
  // runs at ~0 s, so it never saves there.
  const unmountSaveRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    unmountSaveRef.current = () => {
      if (finishedRef.current || !inProgressRef.current) return;
      const a = activeSecNow();
      if (a * 2 < routine.totalSec) return;
      finishedRef.current = true;
      void addStretchSession(sessionRecord(a)).catch(() => undefined);
    };
  }, [activeSecNow, routine, sessionRecord]);
  useEffect(() => () => unmountSaveRef.current(), []);

  // --- Controls -----------------------------------------------------------------
  /** Every control tap: retry audio (a gesture, so iOS allows it). */
  const onTap = () => {
    if (!mutedRef.current) kickAudio();
  };

  const seek = (to: (elapsedMs: number) => number, cause: 'back' | 'skip') => {
    if (finishedRef.current) return;
    onTap();
    const t = Date.now();
    // Position at tap time, not the (up to 200 ms stale) render.
    const cur = readClock(clockRef.current, t, totalMs).elapsedMs;
    seekCauseRef.current = cause;
    setClock((c) => seekClock(c, t, to(cur), totalMs));
    lastSeenRef.current = t;
    setNow(t);
  };

  const pause = (reason: PauseReason = 'user'): boolean => {
    const t = Date.now();
    const wasRunning = clockRef.current.since !== null;
    if (wasRunning) {
      setClock((c) => pauseClock(c, t, totalMs));
      setPauseReason(reason);
    }
    setNow(t);
    return wasRunning;
  };

  const resume = () => {
    if (finishedRef.current) return;
    onTap();
    const t = Date.now();
    setClock((c) => resumeClock(c, t));
    setPauseReason(null);
    lastSeenRef.current = t;
    setNow(t);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    mutedRef.current = next;
    saveStretchPrefs({ muted: next });
    if (!next) kickAudio();
  };

  const askEnd = () => {
    if (finishedRef.current) return;
    onTap();
    setConfirmEnd({ resume: pause(), viaBlocker: false });
  };

  // A tab tap or back swipe mid-routine: pause and ask, same as End.
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (finishedRef.current) {
      blocker.proceed();
      return;
    }
    const t = Date.now();
    const wasRunning = clockRef.current.since !== null;
    if (wasRunning) {
      setClock((c) => pauseClock(c, t, totalMs));
      setPauseReason('user');
    }
    setNow(t);
    setConfirmEnd((prev) => ({ resume: prev?.resume ?? wasRunning, viaBlocker: true }));
  }, [blocker, setClock, totalMs]);

  const keepGoing = () => {
    if (!confirmEnd) return;
    const { resume: r, viaBlocker } = confirmEnd;
    setConfirmEnd(null);
    const b = blockerRef.current;
    if (viaBlocker && b.state === 'blocked') b.reset();
    if (r) resume();
  };

  const confirmEndNow = () => {
    const viaBlocker = confirmEnd?.viaBlocker ?? false;
    setConfirmEnd(null);
    if (finishedRef.current) return;
    void finish('ended', activeSecNow(), viaBlocker);
  };

  if (finished) {
    return <Completion routine={routine} finished={finished} fromSaved={fromSaved} />;
  }

  // --- Render -------------------------------------------------------------------
  const stepIndex = phase?.stepIndex ?? routine.steps.length - 1;
  const step: RoutineStep = routine.steps[stepIndex]!;
  const stretch = getStretch(step.stretchId)!;
  const nextStep = routine.steps[stepIndex + 1];
  const nextStretch = nextStep ? getStretch(nextStep.stretchId) : undefined;
  const isPrep = phase?.kind === 'prep';
  const ringFrac = phase ? Math.min(1, pos.phaseElapsedMs / phase.durMs) : 1;
  const R = 52;
  const C = 2 * Math.PI * R;
  const halfDone = activeSec * 2 >= routine.totalSec;
  const sideText = step.side ? `, ${step.side} side` : '';
  const rep = repLabel(step);
  const repText = rep ? `, ${rep.toLowerCase()}` : '';
  const nextRep = repLabel(nextStep);
  // Between reps / sides of one stretch the transition says so, rather than
  // presenting it as a new stretch.
  const kind = transitionKind(routine.steps, stepIndex);

  let phaseText: string;
  let lead: string;
  if (stepIndex === 0) lead = 'Get ready';
  else if (kind === 'switch') lead = 'Switch sides';
  else if (kind === 'again') lead = 'Again, same stretch';
  else lead = 'Next';
  if (pos.done) phaseText = 'Finished';
  else if (isPrep)
    phaseText = kind === 'new' && stepIndex > 0 ? 'Next up: get into position' : lead;
  else phaseText = 'Hold';

  let pausedText = '';
  if (!running && !pos.done) {
    if (pauseReason === 'start') pausedText = 'Tap Start to begin';
    else if (pauseReason === 'away') pausedText = 'Paused while away';
    else pausedText = 'Paused';
  }

  // Polite live region: changes only at phase changes and pause states, never
  // every second.
  let announce = '';
  if (!pos.done) {
    announce = isPrep
      ? `${lead}: ${stretch.name}${sideText}${repText}, ${step.holdSec} second hold`
      : `Hold ${stretch.name}${sideText}${repText} for ${step.holdSec} seconds`;
    if (pausedText) announce = `${pausedText}. ${announce}`;
  }

  const locked = finishing;

  return (
    <div className="splayer safe-top">
      <header className="splayer__head">
        <span className="label">
          Step {stepIndex + 1} of {routine.steps.length}
        </span>
        <span className="label text-low">
          {fmtClock(elapsed / 1000)} / {fmtClock(routine.totalSec)}
        </span>
        <button
          type="button"
          className={`splayer__mute label${muted ? ' is-off' : ''}`}
          onClick={toggleMute}
        >
          {muted ? 'Sound off' : 'Sound on'}
        </button>
      </header>
      <p className="splayer__hint">
        {!muted && soundBlocked ? (
          <button type="button" className="splayer__sound-fix label" onClick={kickAudio}>
            Sound unavailable: tap to enable
          </button>
        ) : (
          'Cues follow the ringer switch: silent mode mutes them.'
        )}
      </p>

      <div className="splayer__progress" aria-hidden="true">
        <span style={{ width: `${(elapsed / totalMs) * 100}%` }} />
      </div>

      <p
        className={`splayer__phase label ${isPrep ? 'text-cyan' : 'text-amber'}`}
        aria-hidden="true"
      >
        {phaseText}
        {pausedText && ` · ${pausedText}`}
      </p>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </p>

      {!running && !pos.done && (pauseReason === 'away' || pauseReason === 'start') && (
        <button type="button" className="splayer__away" onClick={resume} disabled={locked}>
          <span className="label text-amber">
            {pauseReason === 'away' ? 'Paused while away' : 'Ready when you are'}
          </span>
          <span className="splayer__away-cta label label-hi">
            {pauseReason === 'away' ? 'Tap to resume' : 'Tap to start'}
          </span>
        </button>
      )}

      <div className={`splayer__stage${isPrep ? ' is-prep' : ''}`}>
        <StretchFigure
          pose={stretch.pose}
          mirrored={step.side === 'right'}
          title={`${stretch.name}${sideText}`}
          className={`splayer__figure${running && !isPrep ? ' is-live' : ''}`}
        />
        {flash > 0 && (
          <span
            key={flash}
            className={`splayer__flash${isPrep ? ' is-prep' : ''}`}
            aria-hidden="true"
          />
        )}
      </div>

      <div className="splayer__name-row">
        <h1 className="splayer__name">{stretch.name}</h1>
        {(step.side || rep) && (
          <span className="splayer__tags">
            {step.side && <span className="label splayer__side">{step.side} side</span>}
            {rep && <span className="label splayer__rep">{rep}</span>}
          </span>
        )}
      </div>

      <div className="splayer__timer-row">
        <svg className="splayer__ring" viewBox="0 0 120 120" aria-hidden="true">
          <circle className="splayer__ring-track" cx="60" cy="60" r={R} />
          <circle
            className={`splayer__ring-bar${isPrep ? ' is-prep' : ''}`}
            cx="60"
            cy="60"
            r={R}
            strokeDasharray={C}
            strokeDashoffset={C * ringFrac}
            transform="rotate(-90 60 60)"
          />
          <text
            x="60"
            y="60"
            className="splayer__ring-num num"
            dominantBaseline="central"
            textAnchor="middle"
          >
            {secLeft}
          </text>
        </svg>
        <ul className="splayer__cues">
          {stretch.cues.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>

      <div className="splayer__controls">
        <Button
          variant="ghost"
          disabled={locked}
          onClick={() => seek((e) => backTarget(timeline, e), 'back')}
        >
          Back
        </Button>
        {running ? (
          <Button
            variant="primary"
            disabled={locked}
            onClick={() => {
              onTap();
              pause('user');
            }}
          >
            Pause
          </Button>
        ) : (
          <Button variant="primary" disabled={locked} onClick={resume}>
            {pauseReason === 'start' ? 'Start' : 'Resume'}
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={locked}
          onClick={() => seek((e) => skipTarget(timeline, e), 'skip')}
        >
          Skip
        </Button>
      </div>

      <HudPanel title="Next" className="splayer__next">
        {nextStep && nextStretch ? (
          <div className="splayer__next-row">
            <StretchFigure
              pose={nextStretch.pose}
              mirrored={nextStep.side === 'right'}
              className="stretch__thumb"
            />
            <span className="stretch__step-name">
              {nextStep.stretchId === step.stretchId
                ? `${nextStretch.name} (again)`
                : nextStretch.name}
            </span>
            <span className="label stretch__side">
              {[nextStep.side, nextRep && `${nextStep.rep}/${nextStep.repOf}`]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <span className="num stretch__step-sec">{nextStep.holdSec}s</span>
          </div>
        ) : (
          <p className="label text-low">Last stretch</p>
        )}
      </HudPanel>

      <Button variant="danger" block disabled={locked} onClick={askEnd}>
        End
      </Button>

      {confirmEnd && (
        <Modal
          open
          title={confirmEnd.viaBlocker ? 'Leave the routine?' : 'End session?'}
          onClose={keepGoing}
        >
          <p className="splayer__modal-copy">
            {halfDone
              ? `You've stretched ${fmtClock(activeSec)} of ${fmtClock(routine.totalSec)}. Ending now still saves the session and counts for today.`
              : `You've stretched ${fmtClock(activeSec)} of ${fmtClock(routine.totalSec)}. Under half done, so ending now will not save it or count for today.`}
          </p>
          <div className="splayer__modal-actions">
            <Button variant="ghost" onClick={keepGoing}>
              Keep going
            </Button>
            <Button variant="danger" block onClick={confirmEndNow}>
              {halfDone ? 'End and save' : 'End'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * Shown after a session is saved: the updated streak, a way out, and (for a
 * generated routine) "Save this routine".
 */
function Completion({
  routine,
  finished,
  fromSaved,
}: {
  routine: Routine;
  finished: Finished;
  fromSaved: boolean;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const today = useToday();
  const [naming, setNaming] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const sessions = useLiveQuery(listStretchSessions, []);
  const streak = useMemo(
    () => (sessions ? computeStreak(sessions, today) : null),
    [sessions, today],
  );
  const creditedElsewhere = finished.date !== today;
  return (
    <div className="splayer splayer--done safe-top">
      <HudPanel active className="splayer__done">
        <p className="label text-cyan">Session complete</p>
        <p className="num num-xl text-amber">{fmtClock(finished.actualSec)}</p>
        <p className="label text-mid">
          of {fmtClock(routine.totalSec)} planned · saved for {finished.date}
        </p>
        {creditedElsewhere && (
          <p className="splayer__credit">
            Started before midnight, so it counts for {finished.date}, not today ({today}).
          </p>
        )}
      </HudPanel>
      {streak && <StreakPanel summary={streak} />}
      <Button variant="primary" block onClick={() => navigate('/stretch', { replace: true })}>
        Done
      </Button>
      {!fromSaved && !savedOnce && (
        <Button variant="ghost" block onClick={() => setNaming(true)}>
          Save this routine
        </Button>
      )}
      <Button variant="ghost" block onClick={() => navigate('/', { replace: true })}>
        Today
      </Button>
      {naming && (
        <RoutineNameModal
          title="Save routine"
          initialName={defaultRoutineName(routine)}
          confirmLabel="Save"
          onClose={() => setNaming(false)}
          onSubmit={async (name) => {
            await addSavedRoutine(name, routine);
            setNaming(false);
            setSavedOnce(true);
            toast.show('Routine saved', 'success');
          }}
        />
      )}
    </div>
  );
}
