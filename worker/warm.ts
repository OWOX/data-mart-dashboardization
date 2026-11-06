import { cachedOwox } from '../src/cache/martCache';
import { resolveRange } from '../src/lib/dates';
import { shownModel } from '../src/model/shown';
import { cacheKey, refreshCanvas } from '../src/metrics/refresh';
import type { OwoxLike } from '../src/owox/sources';
import { parseWarmInput } from '../src/schedules/input';
import { loadOntology, loadProjectModel, type CollectionsLike } from '../src/store/collections';
import { DEFAULT_SETTINGS } from '../src/types';

/** OWOX shows `code` as the run's error code; it must match ^[A-Z][A-Z0-9_]{0,63}$. */
export class ActionError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

interface WarmContext { owox: unknown; collections: CollectionsLike['collections']; execution: { deadlineAt: string } }
interface WarmResult { ranges: number; marts: number; queries: number; skipped: number; failed: string[]; tooLarge: string[]; written: string[] }

// a range is a full canvas refresh; one that starts this close to the deadline would be cut off mid-way
const RESERVE_MS = 30_000;

export async function warmCache(raw: unknown, ctx: WarmContext, now: () => Date = () => new Date()): Promise<WarmResult> {
  const input = parseWarmInput(raw);
  if (!input) throw new ActionError('INVALID_RANGES', 'The schedule parameters are not valid; save the schedule again.');
  const store: CollectionsLike = { collections: ctx.collections };
  // the run acts as the schedule's creator, so these are that member's own collections
  const model = (await loadOntology(store)) ?? (await loadProjectModel(store));
  if (!model) throw new ActionError('MODEL_MISSING', 'Open Gyroscope once so it builds your model.');
  const owox = ctx.owox as OwoxLike;
  // an unparseable deadline must not switch the reserve off; assume the 5 minute action limit
  const parsed = Date.parse(ctx.execution.deadlineAt);
  const deadline = Number.isFinite(parsed) ? parsed : now().getTime() + 300_000;
  const out: WarmResult = { ranges: 0, marts: 0, queries: 0, skipped: 0, failed: [], tooLarge: [], written: [] };
  for (const r of input.ranges) {
    if (deadline - now().getTime() < RESERVE_MS) { out.skipped++; continue; }
    const spec = resolveRange(r.range, r.compare, now(), r.weekStart);
    const key = cacheKey(r.range, r.compare, r.weekStart);
    // write-only: a scheduled run exists to replace what is cached
    const src = cachedOwox({ owox, store, anchor: spec.anchor, mode: 'write-only', now });
    await refreshCanvas({ owox: src.owox, model, spec, key, thresholdPct: DEFAULT_SETTINGS.thresholdPct });
    const f = await src.flush();
    out.ranges++;
    out.queries += src.stats().misses;
    out.failed.push(...f.failed);
    out.tooLarge.push(...f.tooLarge);
    out.written.push(...f.written);
  }
  // refreshCanvas swallows per-metric errors, so a run can finish "fine" with nothing cached
  if (out.ranges > 0 && out.written.length === 0 && (out.failed.length > 0 || out.tooLarge.length > 0)) {
    throw new ActionError('CACHE_NOT_WRITTEN', `Nothing was saved to the cache: ${out.failed.length} write(s) failed and ${out.tooLarge.length} were too large. Run the schedule again; if it keeps failing, reduce the number of metrics.`);
  }
  // only metrics a class lists (and the member shows) are queried
  const known = new Set(model.metrics.map((m) => m.id));
  if (out.ranges > 0 && out.queries === 0 && shownModel(model).classes.some((c) => c.metricIds.some((id) => known.has(id)))) {
    throw new ActionError('NO_DATA', 'No Data Mart returned any data. The member who created the schedule may not be able to read these Data Marts; check their access and run the schedule again.');
  }
  out.marts = new Set(out.written).size;
  return out;
}
