/**
 * One-shot "the user just tapped Start" token. The Stretch screen arms it in
 * its Start tap handler; the player checks it on mount and only auto-starts
 * when it is fresh. Module-level on purpose: a reload clears it, so a player
 * restored from history.state (reload, browser forward) starts paused and
 * waits for a tap, which is also the gesture iOS needs to unlock audio.
 */

const FRESH_MS = 5000;

let armedAt: number | null = null;

/** Call from the Start tap handler, just before navigating to the player. */
export function armAutostart(now: number = Date.now()): void {
  armedAt = now;
}

/**
 * True when Start was tapped within the last few seconds. Pure read (safe to
 * call from a state initializer, which Strict Mode may run twice); clear it
 * with {@link clearAutostart} from an effect.
 */
export function isAutostartFresh(now: number = Date.now()): boolean {
  return armedAt !== null && now - armedAt >= 0 && now - armedAt < FRESH_MS;
}

/** Consume the token so a later remount (history forward) starts paused. */
export function clearAutostart(): void {
  armedAt = null;
}
