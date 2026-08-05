import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connect } from '@owox/plugin-sdk';
import {
  getPluginContext,
  initializePlugin,
  resetPluginContextForTests,
} from './plugin-runtime';

vi.mock('@owox/plugin-sdk');

describe('plugin runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPluginContextForTests();
  });

  it('connects once and shares the resulting context with every feature', async () => {
    const context = { projectId: 'project-1' };
    vi.mocked(connect).mockResolvedValue(context as never);

    await expect(initializePlugin()).resolves.toBe(context);
    await expect(getPluginContext()).resolves.toBe(context);
    expect(connect).toHaveBeenCalledOnce();
  });

  it('shares a rejected handshake instead of opening another channel', async () => {
    vi.mocked(connect).mockRejectedValue(new Error('handshake failed'));

    await expect(initializePlugin()).rejects.toThrow('handshake failed');
    await expect(getPluginContext()).rejects.toThrow('handshake failed');
    expect(connect).toHaveBeenCalledOnce();
  });
});
