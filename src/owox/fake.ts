import type { Blendable, ContextInfo, MartDetail, MartSummary, OwoxLike } from './sources';

export interface FakeOwoxData {
  projectDescription: string | null;
  contexts: ContextInfo[];
  marts: MartSummary[];
  details: Record<string, MartDetail>;
  blendables: Record<string, Blendable>;
  /** Returns rows for a traverseData call; tests inspect the options. */
  /** Answers the data-quality summaries POST; omit and the fake has no postJson. Throw to simulate a refusal. */
  quality?: (ids: string[]) => unknown;
  /** Answers markdown.parseToHtml; omit and the fake has no markdown. Throw to simulate a failure. */
  markdown?: (markdown: string) => string | Promise<string>;
  /** Roles served at /api/auth/context; defaults to ['admin'] so a build runs on open. */
  roles?: string[];
  rows?: (id: string, options: Record<string, unknown>) => Record<string, unknown>[];
}

export function fakeOwox(data: FakeOwoxData): OwoxLike & { calls: { path: string }[] } {
  const calls: { path: string }[] = [];
  const miss = (path: string) => Object.assign(new Error(`404 ${path}`), { status: 404 });
  return {
    calls,
    async getJson<T>(path: string): Promise<T> {
      calls.push({ path });
      if (path === '/api/auth/context') return { member: { userId: 'u1', fullName: 'Test Admin', email: 'u1@example.com', roles: data.roles ?? ['admin'] } } as T;
      if (path === '/api/contexts') return data.contexts as T;
      const blend = /^\/api\/data-marts\/([^/]+)\/blendable-schema$/.exec(path);
      if (blend) { const b = data.blendables[blend[1]!]; if (!b) throw miss(path); return b as T; }
      const one = /^\/api\/data-marts\/([^/]+)$/.exec(path);
      if (one) { const d = data.details[one[1]!]; if (!d) throw miss(path); return { id: d.id, title: d.title, schema: { fields: d.fields } } as T; }
      throw miss(path);
    },
    ...(data.quality ? {
      async postJson<T>(path: string, body: unknown): Promise<T> {
        calls.push({ path });
        if (path === '/api/data-marts/data-quality/summaries') return data.quality!((body as { dataMartIds: string[] }).dataMartIds) as T;
        throw miss(path);
      },
    } : {}),
    ...(data.markdown ? { markdown: { async parseToHtml(r: { markdown: string }) { calls.push({ path: 'markdown' }); return data.markdown!(r.markdown); } } } : {}),
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
