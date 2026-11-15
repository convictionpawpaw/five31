/**
 * The stretch player's clock, as pure functions of explicit timestamps (no
 * Date.now() in here, so every transition is unit-testable).
 *
 * The clock never accumulates ticks: while running, the live span is
 * `now - since`, and every pause / seek / hide folds that span into the
 * bases. Time while the page is hidden is never counted: hiding pauses the
 * clock at the moment of hiding, and a missed hide (a stalled interval) is
 * caught by {@link catchUpClock}, which pauses at the last moment the page was
 * seen alive.
 */

export interface Clock {
  /** Timeline position (ms) at the last pause/seek. */
  tBase: number;
  /** Active (unpaused) stretching time (ms) at the last pause/seek. */
  aBase: number;
  /** Epoch ms when the current running span began; null while paused. */
  since: number | null;
}

export interface ClockReading {
  /** Timeline position, clamped to [0, totalMs]. */
  elapsedMs: number;
  /** Active stretching time; never counts time past the end of the timeline. */
  activeMs: number;
  running: boolean;
}

/** A clock running from 0 since `now`. */
export function startClock(now: number): Clock {
  return { tBase: 0, aBase: 0, since: now };
}

/** A clock paused at 0 (waiting for the user's first tap). */
export function pausedClock(): Clock {
  return { tBase: 0, aBase: 0, since: null };
}

function liveMs(c: Clock, now: number): number {
  return c.since !== null ? Math.max(0, now - c.since) : 0;
}

/** Where the clock is at `now`. */
export function readClock(c: Clock, now: number, totalMs: number): ClockReading {
  const live = liveMs(c, now);
  const raw = c.tBase + live;
  const overshoot = Math.max(0, raw - totalMs);
  return {
    elapsedMs: Math.min(totalMs, Math.max(0, raw)),
    activeMs: Math.max(0, c.aBase + live - overshoot),
    running: c.since !== null,
  };
}

/**
 * Pause at `now`, folding the live span into both bases. Time past the end of
 * the timeline is dropped so a paused clock never sits beyond `totalMs`.
 */
export function pauseClock(c: Clock, now: number, totalMs: number): Clock {
  if (c.since === null) return c;
  const r = readClock(c, now, totalMs);
  return { tBase: r.elapsedMs, aBase: r.activeMs, since: null };
}

/** Resume at `now` (no-op when already running). */
export function resumeClock(c: Clock, now: number): Clock {
  return c.since === null ? { ...c, since: now } : c;
}

/**
 * Jump the timeline to `targetMs`. Active time keeps what was really
 * stretched; a running clock keeps running from the new position.
 */
export function seekClock(c: Clock, now: number, targetMs: number, totalMs: number): Clock {
  const r = readClock(c, now, totalMs);
  return {
    tBase: Math.min(totalMs, Math.max(0, targetMs)),
    aBase: r.activeMs,
    since: c.since !== null ? now : null,
  };
}

/** The page was hidden at `now`: pause there. Same arithmetic as a pause. */
export function hideClock(c: Clock, now: number, totalMs: number): Clock {
  return pauseClock(c, now, totalMs);
}

/**
 * Stop the clock for good when a session finishes: fold the live span (so the
 * display stays where it ended instead of snapping back) and clamp at the end.
 */
export function freezeClock(c: Clock, now: number, totalMs: number): Clock {
  return pauseClock(c, now, totalMs);
}

/**
 * Missed-hide guard. The player re-renders every ~200 ms while running; if it
 * was last seen alive at `lastSeenAt` and `now` is more than `maxGapMs` later,
 * the page was frozen (locked phone, app switch) without us getting the hide
 * event in time. Pause at the last moment it was seen, so the gap never counts.
 */
export function catchUpClock(
  c: Clock,
  lastSeenAt: number,
  now: number,
  maxGapMs: number,
  totalMs: number,
): { clock: Clock; stalled: boolean } {
  if (c.since === null || now - lastSeenAt <= maxGapMs) return { clock: c, stalled: false };
  return { clock: pauseClock(c, Math.max(c.since, lastSeenAt), totalMs), stalled: true };
}
