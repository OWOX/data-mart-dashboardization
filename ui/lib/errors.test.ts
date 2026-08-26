import { describe, it, expect } from 'vitest';
import { describeError } from './errors';

describe('describeError', () => {
  it('unwraps the API client wrapper to the transport code and status underneath', () => {
    // Exactly the shape the dashboard hits: OWOXApiError("Failed to open …") { cause: PluginTransportError }.
    const transport = Object.assign(new Error('Request failed with 400'), {
      name: 'PluginTransportError',
      payload: { code: 'HTTP_ERROR', status: 400, message: 'Unknown column: Unique Count' },
    });
    const wrapper = Object.assign(new Error('Failed to open OWOX Data Mart data stream'), {
      cause: transport,
      details: { dataMartId: 'm1' },
    });

    const text = describeError(wrapper);

    expect(text).toContain('Failed to open OWOX Data Mart data stream');
    expect(text).toContain('HTTP_ERROR 400');
    expect(text).toContain('Unknown column: Unique Count');
  });

  it('keeps a plain Error readable', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('boom')).toBe('boom');
  });

  it('stops on a cause cycle instead of spinning', () => {
    const a: { message: string; cause?: unknown } = { message: 'a' };
    const b = { message: 'b', cause: a };
    a.cause = b;
    expect(describeError(a)).toBe('a ← b');
  });

  it('keeps the whole message, including the column list a diagnosis depends on', () => {
    const error = {
      message: 'Cannot build report SQL. Disconnected columns: "firstLogInDateTime". They are missing from the current Data Mart output schema.',
      details: { unknownColumns: ['firstLogInDateTime'], dataMartId: 'd1c93c26' },
    };
    const text = describeError(error);
    expect(text).toContain('missing from the current Data Mart output schema.');
    expect(text).toContain('"unknownColumns":["firstLogInDateTime"]');
    expect(text).not.toContain('…');
  });
});
