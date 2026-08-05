import { connect, type PluginContext } from '@owox/plugin-sdk';

let contextPromise: Promise<PluginContext> | undefined;

/**
 * Establish the host channel once. Every feature gets the same immutable context, so no caller can
 * accidentally create a second plugin session or construct an API client with its own credentials.
 */
export function initializePlugin(): Promise<PluginContext> {
  contextPromise ??= connect();
  return contextPromise;
}

export function getPluginContext(): Promise<PluginContext> {
  return initializePlugin();
}

/** Test seam for modules whose public functions lazily read the shared context. */
export function resetPluginContextForTests(): void {
  contextPromise = undefined;
}
