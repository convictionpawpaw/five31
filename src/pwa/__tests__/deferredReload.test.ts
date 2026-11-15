import { describe, it, expect, vi } from 'vitest';
import { isActiveSessionHash, reloadWhenSafe, type ReloadWindow } from '../deferredReload.ts';

function fakeWindow(hash: string) {
  const listeners = new Set<() => void>();
  const win = {
    location: { hash, reload: vi.fn() },
    addEventListener: vi.fn((_t: 'hashchange', fn: () => void) => listeners.add(fn)),
    removeEventListener: vi.fn((_t: 'hashchange', fn: () => void) => listeners.delete(fn)),
  } satisfies ReloadWindow;
  const navigate = (next: string) => {
    win.location.hash = next;
    for (const fn of [...listeners]) fn();
  };
  return { win, navigate, listeners };
}

describe('isActiveSessionHash', () => {
  it.each([
    ['#/stretch/play', true],
    ['#/stretch/play?seed=4', true],
    ['#/workout/01ABC', true],
    ['#/sl-session/c1/3', true],
    ['#/', false],
    ['', false],
    ['#/stretch', false],
    ['#/stretch/gallery', false],
    ['#/stretch/playlist', false],
    ['#/settings', false],
    ['#/history/01ABC', false],
  ])('%s → %s', (hash, expected) => {
    expect(isActiveSessionHash(hash)).toBe(expected);
  });
});

describe('reloadWhenSafe', () => {
  it('reloads immediately when no session screen is open', () => {
    const { win } = fakeWindow('#/');
    reloadWhenSafe(win);
    expect(win.location.reload).toHaveBeenCalledOnce();
  });

  it('defers during a stretch routine and reloads once the route leaves it', () => {
    const { win, navigate, listeners } = fakeWindow('#/stretch/play');
    reloadWhenSafe(win);
    expect(win.location.reload).not.toHaveBeenCalled();
    navigate('#/workout/abc'); // still a session screen
    expect(win.location.reload).not.toHaveBeenCalled();
    navigate('#/');
    expect(win.location.reload).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it('does not stack listeners on repeated update notifications', () => {
    const { win, navigate } = fakeWindow('#/sl-session/c/1');
    reloadWhenSafe(win);
    reloadWhenSafe(win);
    expect(win.addEventListener).toHaveBeenCalledOnce();
    navigate('#/cycle');
    expect(win.location.reload).toHaveBeenCalledOnce();
  });
});
