/**
 * Tiny WebAudio cue generator for the stretch player (no audio files, no
 * network). iOS only lets audio start from a user gesture, so
 * {@link unlockAudio} must be called from a tap (the Start button, and every
 * player control as a fallback); cues before that are silently dropped.
 */

type AudioCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

// iOS reports 'interrupted' (not in the TS lib's union) after a call, Siri or
// an app switch, so compare as a plain string.
function stateOf(c: AudioContext): string {
  return c.state as string;
}

/** True when cues can actually be heard right now (context running). */
export function audioRunning(): boolean {
  return ctx !== null && stateOf(ctx) === 'running';
}

/**
 * Create/resume the shared AudioContext. Call from a tap handler. Resumes
 * whenever the context is not running ('suspended', or iOS 'interrupted'),
 * and recreates it if it was closed.
 */
export function unlockAudio(): void {
  try {
    const w = window as Window & { webkitAudioContext?: AudioCtor };
    const Ctor: AudioCtor | undefined = window.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return;
    if (ctx && stateOf(ctx) === 'closed') ctx = null;
    if (!ctx) ctx = new Ctor();
    if (stateOf(ctx) !== 'running') {
      // Play one silent sample: some iOS versions only unlock on actual output.
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
      void ctx.resume().catch(() => undefined);
    }
  } catch {
    // Audio unsupported or blocked: the player works silently.
  }
}

/**
 * {@link unlockAudio}, then wait briefly for the context to come up. Resolves
 * to whether it is running. iOS can leave a resume() promise pending forever
 * outside a gesture, hence the timeout.
 */
export async function resumeAudio(timeoutMs = 400): Promise<boolean> {
  unlockAudio();
  const c = ctx;
  if (!c) return false;
  if (stateOf(c) === 'running') return true;
  try {
    await Promise.race([
      c.resume(),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch {
    // Fall through to the state check.
  }
  return audioRunning();
}

/** Subscribe to context state changes (running / suspended / interrupted). */
export function onAudioStateChange(cb: () => void): () => void {
  const c = ctx;
  if (!c) return () => undefined;
  c.addEventListener('statechange', cb);
  return () => c.removeEventListener('statechange', cb);
}

/** A short sine beep. No-op until unlocked. */
export function beep(freq: number, durMs: number, gain = 0.18): void {
  if (!ctx || stateOf(ctx) !== 'running') return;
  try {
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    // Quick attack and decay so beeps don't click.
    amp.gain.setValueAtTime(0, t0);
    amp.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + durMs / 1000 + 0.02);
  } catch {
    // Ignore: a missed beep is harmless.
  }
}

/** Haptic pulse where supported (Android Chrome; iOS Safari has none). */
export function buzz(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {
    // Ignore.
  }
}

// Cues take `sound` (false when muted); haptics still fire when muted.

/** Cue: a hold starts. */
export function cueHoldStart(sound: boolean): void {
  if (sound) beep(880, 220);
  buzz(120);
}

/** Cue: a hold ends / moving to the next stretch. */
export function cueHoldEnd(sound: boolean): void {
  if (sound) beep(523, 260);
  buzz([60, 60, 60]);
}

/** Cue: 3-2-1 countdown tick (sound only). */
export function cueTick(sound: boolean): void {
  if (sound) beep(660, 90, 0.12);
}

/** Cue: routine finished. */
export function cueDone(sound: boolean): void {
  if (sound) {
    beep(659, 160);
    setTimeout(() => beep(880, 160), 180);
    setTimeout(() => beep(1047, 320), 360);
  }
  buzz([100, 60, 100, 60, 200]);
}
