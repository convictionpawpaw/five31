import { describe, it, expect, vi } from 'vitest';
import { deleteEverything, DeleteTimeoutError } from '../deleteEverything.ts';

describe('deleteEverything', () => {
  it('reloads after a successful delete', async () => {
    const reload = vi.fn();
    await deleteEverything({ deleteDb: () => Promise.resolve(), reload, timeoutMs: 1000 });
    expect(reload).toHaveBeenCalledOnce();
  });

  it('rejects (no reload) when the delete fails', async () => {
    const reload = vi.fn();
    await expect(
      deleteEverything({ deleteDb: () => Promise.reject(new Error('quota')), reload, timeoutMs: 1000 }),
    ).rejects.toThrow('quota');
    expect(reload).not.toHaveBeenCalled();
  });

  it('rejects with a DeleteTimeoutError when the delete hangs (blocked)', async () => {
    vi.useFakeTimers();
    try {
      const reload = vi.fn();
      let finish!: () => void;
      const hung = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const p = deleteEverything({ deleteDb: () => hung, reload, timeoutMs: 5000 });
      const assertion = expect(p).rejects.toBeInstanceOf(DeleteTimeoutError);
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
      expect(reload).not.toHaveBeenCalled();

      // If the blocked delete completes later, the data is gone: reload then.
      finish();
      await vi.runAllTimersAsync();
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
