import { describe, it, expect, vi } from 'vitest';
import {
  defaultBackupFilename,
  describeShareOutcome,
  prepareBackupFile,
  shareBackupFile,
  shareFileFromGesture,
  type ShareEnv,
  type ShareNavigator,
} from '../share.ts';

function domError(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

function env(nav: ShareNavigator | undefined, download = vi.fn()): ShareEnv & { download: ReturnType<typeof vi.fn> } {
  return { navigator: nav, download };
}

const file = () => prepareBackupFile('{"app":"five31"}', 'five31-backup-2026-07-05.json');

describe('shareBackupFile decision logic', () => {
  it('shared: share() resolves', async () => {
    const e = env({ canShare: () => true, share: vi.fn().mockResolvedValue(undefined) });
    expect(await shareBackupFile(file(), e)).toEqual({ kind: 'shared' });
    expect(e.download).not.toHaveBeenCalled();
  });

  it('cancelled: AbortError is not an error and does NOT fall back to a download', async () => {
    const e = env({ canShare: () => true, share: vi.fn().mockRejectedValue(domError('AbortError')) });
    expect(await shareBackupFile(file(), e)).toEqual({ kind: 'cancelled' });
    expect(e.download).not.toHaveBeenCalled();
  });

  it('needs-gesture: NotAllowedError (lost activation) returns the prepared file, no silent download', async () => {
    const f = file();
    const e = env({ canShare: () => true, share: vi.fn().mockRejectedValue(domError('NotAllowedError')) });
    const out = await shareBackupFile(f, e);
    expect(out).toEqual({ kind: 'needs-gesture', file: f });
    expect(e.download).not.toHaveBeenCalled();
  });

  it('download-attempted: other share failures fall back to the anchor download', async () => {
    const e = env({ canShare: () => true, share: vi.fn().mockRejectedValue(domError('DataError')) });
    expect(await shareBackupFile(file(), e)).toEqual({ kind: 'download-attempted' });
    expect(e.download).toHaveBeenCalledOnce();
  });

  it('download-attempted: no Web Share, or canShare refuses files', async () => {
    const none = env(undefined);
    expect(await shareBackupFile(file(), none)).toEqual({ kind: 'download-attempted' });
    const refuses = env({ canShare: () => false, share: vi.fn() });
    expect(await shareBackupFile(file(), refuses)).toEqual({ kind: 'download-attempted' });
    expect(refuses.navigator!.share).not.toHaveBeenCalled();
    const throws = env({ canShare: () => { throw new TypeError('bad'); }, share: vi.fn() });
    expect(await shareBackupFile(file(), throws)).toEqual({ kind: 'download-attempted' });
  });

  it('failed: the download itself is impossible', async () => {
    const e = env(undefined, vi.fn(() => { throw new Error('Downloads are not available here.'); }));
    expect(await shareBackupFile(file(), e)).toEqual({
      kind: 'failed',
      message: 'Downloads are not available here.',
    });
  });
});

describe('shareFileFromGesture', () => {
  it('calls share() synchronously, before any microtask', () => {
    const share = vi.fn().mockResolvedValue(undefined);
    void shareFileFromGesture(file(), env({ canShare: () => true, share }));
    // No await yet: the call must already have happened inside the "tap".
    expect(share).toHaveBeenCalledOnce();
  });

  it('shared / cancelled / refused-again → download', async () => {
    expect(
      await shareFileFromGesture(file(), env({ canShare: () => true, share: vi.fn().mockResolvedValue(undefined) })),
    ).toEqual({ kind: 'shared' });
    expect(
      await shareFileFromGesture(
        file(),
        env({ canShare: () => true, share: vi.fn().mockRejectedValue(domError('AbortError')) }),
      ),
    ).toEqual({ kind: 'cancelled' });
    const e = env({ canShare: () => true, share: vi.fn().mockRejectedValue(domError('NotAllowedError')) });
    expect(await shareFileFromGesture(file(), e)).toEqual({ kind: 'download-attempted' });
    expect(e.download).toHaveBeenCalledOnce();
  });
});

describe('describeShareOutcome', () => {
  it('never claims a download saved, and only "shared" is a success', () => {
    const dl = describeShareOutcome({ kind: 'download-attempted' });
    expect(dl.tone).not.toBe('success');
    expect(dl.text).toMatch(/started/i);
    expect(dl.text).toMatch(/Files/);
    expect(dl.text).not.toMatch(/downloaded/i);
    expect(dl.text).not.toMatch(/^Backup (saved|downloaded)/);
    expect(describeShareOutcome({ kind: 'cancelled' }).tone).toBe('info');
    expect(describeShareOutcome({ kind: 'shared' }).tone).toBe('success');
    expect(describeShareOutcome({ kind: 'failed', message: 'x' }).tone).toBe('danger');
    expect(describeShareOutcome({ kind: 'needs-gesture', file: file() }).text).toMatch(/tap/i);
  });
});

describe('defaultBackupFilename', () => {
  it('uses the LOCAL calendar date, not UTC', () => {
    // 23:30 local on Jul 5 — in any timezone west of UTC this is Jul 6 in UTC.
    const lateEvening = new Date(2026, 6, 5, 23, 30);
    expect(defaultBackupFilename(lateEvening)).toBe('five31-backup-2026-07-05.json');
    const earlyMorning = new Date(2026, 0, 2, 0, 15);
    expect(defaultBackupFilename(earlyMorning)).toBe('five31-backup-2026-01-02.json');
  });
});
