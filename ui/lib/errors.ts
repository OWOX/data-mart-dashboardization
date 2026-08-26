/**
 * One readable line out of a host failure, however deeply it is wrapped.
 *
 * Three layers each hold a different part of the truth, and only the outermost one is a plain
 * `message`: the API client wraps a failed stream in its own `OWOXApiError` ("Failed to open OWOX
 * Data Mart data stream") and keeps the real error as `cause`; the SDK's `PluginTransportError`
 * carries `code`/`status` in `payload`; and a rejected request's specifics (an unknown column, say)
 * live in `details`. Reading `error.message` alone therefore yields a sentence that names neither
 * the query nor the reason — which is exactly the failure this plugin kept showing.
 *
 * Neither error class is exported to plugins, so this reads shapes rather than using `instanceof`.
 */
export function describeError(error: unknown, maxDepth = 4): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < maxDepth && current && !seen.has(current); depth++) {
    seen.add(current);
    const part = describeOne(current);
    if (part && !parts.includes(part)) parts.push(part);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(' ← ') || String(error);
}

function describeOne(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const e = error as {
    message?: string; status?: number; code?: string; details?: unknown;
    payload?: { code?: string; status?: number; message?: string; details?: unknown };
  };
  const code = e.payload?.code ?? e.code;
  const status = e.payload?.status ?? e.status;
  const message = e.payload?.message ?? e.message ?? '';
  const details = summarize(e.payload?.details ?? e.details);
  const tag = [code, status].filter(Boolean).join(' ');
  return [tag && `${tag} —`, message, details].filter(Boolean).join(' ').trim();
}

function summarize(details: unknown): string {
  if (details === undefined || details === null) return '';
  try {
    // Not truncated: the useful half of a message like "Disconnected columns: …" or
    // "Unknown column: …" is the column list at the end, and cutting it loses the diagnosis.
    const text = typeof details === 'string' ? details : JSON.stringify(details);
    return !text || text === '{}' ? '' : text;
  } catch {
    return '';
  }
}
