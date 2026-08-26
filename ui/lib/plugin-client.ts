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

  /**
   * The SDK's low-level escape hatch, used for the one endpoint with no typed abstraction:
   * `DataMartsApi` exposes only `list()` and `traverseData()`, and `list()` carries no `schema`, so
   * a mart's field types, roles and `allowedAggregations` are reachable only here. Root-relative
   * `/api/...` is exactly what the hatch is for — but the generic is a claim, not a runtime check,
   * so `getMartFields` validates the shape itself instead of trusting `Record<string, unknown>`.
   */
  async getById(id: string): Promise<Record<string, unknown>> {
    return (await owox()).getJson(`/api/data-marts/${encodeURIComponent(id)}`);
  },

  /**
   * Native + joined fields for a mart. Same escape hatch as `getById`, and the only source of the
   * joined ("blended") columns a report may project — `getById`'s `schema.fields` is native-only.
   */
  async getBlendableSchema(id: string): Promise<Record<string, unknown>> {
    return (await owox()).getJson(`/api/data-marts/${encodeURIComponent(id)}/blendable-schema`);
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

  /** Via the SDK's typed runs facade — same endpoint, but a supported API rather than a raw path. */
  async getRun(id: string, runId: string) {
    const response = (await (await owox()).runs.forDataMart(id).get(runId)) as {
      status?: string;
      totals?: Record<string, number | string | boolean | null> | null;
      additionalParams?: { httpData?: { executionSqlQuery?: string } };
      reportDefinition?: { executionSqlQuery?: string };
    };

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
