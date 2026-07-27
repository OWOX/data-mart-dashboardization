import { OWOXApiClient, type TraverseDataOptions } from '@owox/api-client';

// ponytail: TEMPORARY. Routes OWOX access through the dev host's unscoped /host/owox-raw proxy via
// @owox/api-client, because the @owox/plugin-sdk typed `owox` client is unavailable in
// owox-data-marts. Shaped like `owox.dataMarts` so api.ts swaps back with one import when it ships.
export const OWOX_RAW_BASE = '/host/owox-raw';

const origin = () => (typeof location !== 'undefined' ? location.origin : 'http://localhost');

/** api-client builds absolute /api/... URLs on a bare origin; rewrite each to the same-origin proxy mount. */
export function toProxyUrl(input: string | URL): string {
  const u = typeof input === 'string' ? new URL(input) : input;
  return `${origin()}${OWOX_RAW_BASE}${u.pathname}${u.search}`;
}

const proxyFetch: typeof fetch = (input, init) =>
  fetch(toProxyUrl(input instanceof Request ? input.url : (input as string | URL)), init);

// Synthetic key: bare placeholder origin (never used — proxyFetch rewrites), throwaway id/secret. The
// dev proxy short-circuits the exchange so authenticate() succeeds with this.
const SYNTH_KEY =
  'owox_key_' +
  btoa(JSON.stringify({ apiOrigin: 'http://localhost', apiKeyId: 'dev', apiKeySecret: 'dev' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Lazy: constructing on first use (not at module load) avoids import-order hazards — this module
// may be imported before consumers/mocks finish initializing their own top-level bindings.
let clientInstance: OWOXApiClient | undefined;
function client(): OWOXApiClient {
  if (!clientInstance) clientInstance = new OWOXApiClient({ apiKey: SYNTH_KEY, fetchImpl: proxyFetch });
  return clientInstance;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${origin()}${OWOX_RAW_BASE}${path}`);
  if (!res.ok) throw Object.assign(new Error(`OWOX ${res.status}`), { status: res.status });
  return res.json() as Promise<T>;
}

export const rawClient = {
  list: () => client().dataMarts.list(),

  getById: (id: string) => getJson<Record<string, unknown>>(`/api/data-marts/${encodeURIComponent(id)}`),

  async traverseData(id: string, opts: TraverseDataOptions) {
    const t = await client().dataMarts.traverseData(id, opts);
    return {
      runId: t.runId,
      rows: async () => {
        const out: Record<string, unknown>[] = [];
        for await (const chunk of t.rowChunks()) out.push(...chunk);
        return out;
      },
    };
  },

  getRun: (id: string, runId: string) =>
    getJson<{ status?: string; totals?: Record<string, number | string | boolean | null> | null; additionalParams?: any; reportDefinition?: any }>(
      `/api/data-marts/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`,
    ).then(r => ({
      status: r.status ?? 'UNKNOWN',
      totals: r.totals ?? null,
      sql: r.additionalParams?.httpData?.executionSqlQuery ?? r.reportDefinition?.executionSqlQuery ?? null,
    })),
};
