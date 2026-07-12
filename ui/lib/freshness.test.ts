import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useLayerData } from './freshness';

describe('useLayerData', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fetches after the debounce and lands in ready with data', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: 1 });
    const { result } = renderHook(() => useLayerData(1, true, fetcher, 1000));

    expect(fetcher).not.toHaveBeenCalled();       // debounced, not immediate
    await act(async () => { vi.advanceTimersByTime(1000); });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data).toEqual({ ok: 1 });
  });

  it('does not fetch while disabled, and reports stale', async () => {
    const fetcher = vi.fn();
    const { result } = renderHook(() => useLayerData(1, false, fetcher, 1000));
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.status).toBe('stale');
  });

  it('refetches when configVersion changes', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: 1 });
    const { rerender } = renderHook(({ v }) => useLayerData(v, true, fetcher, 1000), {
      initialProps: { v: 1 },
    });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(fetcher).toHaveBeenCalledTimes(1);

    rerender({ v: 2 });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good data and reports stale on error', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: 1 })
      .mockRejectedValueOnce(new Error('boom'));
    const { result, rerender } = renderHook(({ v }) => useLayerData(v, true, fetcher, 1000), {
      initialProps: { v: 1 },
    });
    await act(async () => { vi.advanceTimersByTime(1000); });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    rerender({ v: 2 });
    await act(async () => { vi.advanceTimersByTime(1000); });

    await waitFor(() => expect(result.current.status).toBe('stale'));
    expect(result.current.data).toEqual({ ok: 1 });   // last good data survives
    expect(result.current.error).toBe('boom');
  });
});
