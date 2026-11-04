import type { Blendable, ContextInfo, MartDetail, MartSummary, OwoxLike } from './sources';

export interface FakeOwoxData {
  projectDescription: string | null;
  contexts: ContextInfo[];
  marts: MartSummary[];
  details: Record<string, MartDetail>;
  blendables: Record<string, Blendable>;
  /** Returns rows for a traverseData call; tests inspect the options. */
  rows?: (id: string, options: Record<string, unknown>) => Record<string, unknown>[];
}

export function fakeOwox(data: FakeOwoxData): OwoxLike & { calls: { path: string }[] } {
  const calls: { path: string }[] = [];
  const miss = (path: string) => Object.assign(new Error(`404 ${path}`), { status: 404 });
  return {
    calls,
    async getJson<T>(path: string): Promise<T> {
      calls.push({ path });
      if (path === '/api/contexts') return data.contexts as T;
      const blend = /^\/api\/data-marts\/([^/]+)\/blendable-schema$/.exec(path);
      if (blend) { const b = data.blendables[blend[1]!]; if (!b) throw miss(path); return b as T; }
      const one = /^\/api\/data-marts\/([^/]+)$/.exec(path);
      if (one) { const d = data.details[one[1]!]; if (!d) throw miss(path); return { id: d.id, title: d.title, schema: { fields: d.fields } } as T; }
      throw miss(path);
    },
    project: { getSettings: async () => ({ description: data.projectDescription }) },
    dataMarts: {
      list: async () => data.marts,
      traverseData: async (id, options) => {
        calls.push({ path: `traverse:${id}` });
        const rows = data.rows?.(id, options) ?? [];
        return { async *rowChunks() { yield rows; } };
      },
    },
  };
}
