import { describe, it, expect, vi } from 'vitest';

// chainQueueOperation lives in playbackSlice, which imports @tauri-apps/api/core
// at module load. Mock it so the slice can be imported in jsdom.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

import { chainQueueOperation } from '../store/playbackSlice';

describe('chainQueueOperation resilience', () => {
  it('must not jam the chain after a rejected operation', async () => {
    const failingOp = vi.fn().mockRejectedValue(new Error('IPC failure'));
    const okOp = vi.fn().mockResolvedValue('ok');

    await chainQueueOperation(failingOp).catch(() => {});
    // The chain must still be usable — previously a single rejection poisoned
    // queueOperationPromise forever and all later queue ops silently no-op'd.
    const result = await chainQueueOperation(okOp);

    expect(okOp).toHaveBeenCalledTimes(1);
    expect(result).toBe('ok');
  });

  it('still executes operations sequentially in submission order', async () => {
    const order: number[] = [];
    const mk = (id: number, delayMs: number) => () =>
      new Promise<number>((resolve) => {
        setTimeout(() => {
          order.push(id);
          resolve(id);
        }, delayMs);
      });

    const p1 = chainQueueOperation(mk(1, 30));
    const p2 = chainQueueOperation(mk(2, 5));
    await Promise.all([p1, p2]);

    expect(order).toEqual([1, 2]);
  });
});
