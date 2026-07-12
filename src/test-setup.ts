import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// @testing-library/dom's `waitFor` only detects fake timers via a global `jest` object
// (github.com/testing-library/dom-testing-library#830). Under plain `vi.useFakeTimers()` it
// can't see that, so it falls back to its "real timers" branch and starts its own polling
// `setInterval` — which is ITSELF a fake timer that nothing ever advances, so `waitFor` hangs
// until the test times out. Alias `jest` to `vi` (API-compatible for the calls waitFor makes:
// `advanceTimersByTime`, and the `setTimeout.clock` marker both fake-timer implementations set)
// so waitFor's fake-timer branch engages and self-advances correctly.
if (typeof (globalThis as { jest?: unknown }).jest === 'undefined') {
  (globalThis as { jest?: unknown }).jest = vi;
}
