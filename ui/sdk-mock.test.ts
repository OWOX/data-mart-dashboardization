import { describe, it, expect } from 'vitest';
import * as sdk from './sdk-mock';

describe('sdk-mock', () => {
  it('exposes no identity or storage', () => {
    expect((sdk as Record<string, unknown>).identity).toBeUndefined();
    expect((sdk as Record<string, unknown>).storage).toBeUndefined();
  });

  it('round-trips a collection doc', async () => {
    await sdk.collections('canvas').put('state', { marts: ['a'] });
    expect(await sdk.collections('canvas').get('state')).toMatchObject({ id: 'state', marts: ['a'] });
  });

  it('returns null for a missing doc (matching the real capability)', async () => {
    expect(await sdk.collections('canvas').get('nope')).toBeNull();
  });
});
