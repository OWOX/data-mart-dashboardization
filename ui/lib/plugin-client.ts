import { getPluginContext } from './plugin-runtime';

export type PluginTraverseOptions = {
  column?: string[];
  aggregation?: unknown[];
  dateTrunc?: unknown[];
  filter?: unknown[];
  sort?: unknown[];
  limit?: number;
};

async function owox() {
  return (await getPluginContext()).owox;
}

/**
 * The dashboard's narrow OWOX boundary. All requests use the SDK-owned client returned by
 * `connect()`; unlike the old `/host/owox-raw` proxy, this code never constructs a credential or
 * talks to a same-origin endpoint from the opaque plugin iframe.
 */
export const pluginClient = {
  async list() {
    return (await owox()).dataMarts.list();
  },

  async getById(id: string): Promise<Record<string, unknown>> {
    return (await owox()).getJson(`/api/data-marts/${encodeURIComponent(id)}`);
  },

  async traverseData(id: string, options: PluginTraverseOptions) {
    const traversal = await (await owox()).dataMarts.traverseData(id, options as never);
    return {
      runId: traversal.runId,
      rows: async () => {
        const rows: Record<string, unknown>[] = [];
        for await (const chunk of traversal.rowChunks()) rows.push(...chunk);
        return rows;
      },
    };
  },

  async getRun(id: string, runId: string) {
    const response = await (await owox()).getJson<{
      status?: string;
      totals?: Record<string, number | string | boolean | null> | null;
      additionalParams?: { httpData?: { executionSqlQuery?: string } };
      reportDefinition?: { executionSqlQuery?: string };
    }>(`/api/data-marts/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`);

    return {
      status: response.status ?? 'UNKNOWN',
      totals: response.totals ?? null,
      sql:
        response.additionalParams?.httpData?.executionSqlQuery ??
        response.reportDefinition?.executionSqlQuery ??
        null,
    };
  },
};
