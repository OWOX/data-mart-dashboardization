import type { PluginErrorPayload } from '@owox/plugin-sdk';

export function describeError(error: unknown): string {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (current.name === 'PluginTransportError' && 'payload' in current) {
      const { code, status, message } = current.payload as PluginErrorPayload;
      return [code, status, message].filter(Boolean).join(' ');
    }
  }
  return error instanceof Error ? error.message : String(error);
}
