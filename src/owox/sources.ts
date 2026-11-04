export interface SchemaField {
  name: string; type: string; alias?: string; description?: string;
  isPrimaryKey: boolean; isHiddenForReporting?: boolean;
  mode?: string; status?: string;
  allowedAggregations?: string[];
  calculated?: { formula: string; level?: 'metric' | 'column' };
  fields?: SchemaField[];
}
export interface MartSummary { id: string; title: string; status: string; description: string | null; icon?: string | null; contexts: { id: string; name: string }[]; modifiedAt: string; availableForReporting?: boolean }
export interface MartDetail { id: string; title: string; fields: SchemaField[] }
export interface AvailableSource { aliasPath: string; dataMartId: string; title: string; isAccessibleForReporting: boolean }
export interface Blendable { availableSources: AvailableSource[]; mainUniqueCountKeyFields: string[] }
export interface ContextInfo { id: string; name: string; description: string | null }
/** contextsOk is false when /api/contexts was refused, so descriptions are incomplete. */
export interface Inputs { projectDescription: string | null; contexts: ContextInfo[]; marts: MartSummary[]; contextsOk: boolean }

/** The subset of ctx.owox Gyroscope uses. ctx.owox satisfies it. */
export interface OwoxLike {
  getJson<T>(path: string, query?: Record<string, unknown>): Promise<T>;
  /** Optional so older callers compile; without it no data-quality icons show. */
  postJson?<T>(path: string, body: unknown): Promise<T>;
  project: { getSettings(): Promise<{ description: string | null }> };
  dataMarts: {
    list(): Promise<MartSummary[]>;
    traverseData(id: string, options: Record<string, unknown>): Promise<{ rowChunks(): AsyncIterable<Record<string, unknown>[]> }>;
  };
}

export const DATE_TYPES: ReadonlySet<string> = new Set(['DATE', 'DATETIME', 'TIMESTAMP', 'TIMESTAMP_NTZ', 'TIMESTAMP_TZ', 'TIMESTAMP_LTZ']);

export async function fetchInputs(owox: OwoxLike): Promise<Inputs> {
  let contextsOk = true;
  const [settings, contexts, marts] = await Promise.all([
    owox.project.getSettings(),
    owox.getJson<{ id: string; name: string; description?: unknown }[]>('/api/contexts').catch(() => { contextsOk = false; return []; }),
    owox.dataMarts.list(),
  ]);
  return {
    projectDescription: settings.description,
    contextsOk,
    contexts: contexts.map((c) => ({ id: c.id, name: c.name, description: typeof c.description === 'string' ? c.description : null })),
    marts: marts.filter((m) => m.status === 'PUBLISHED' && m.availableForReporting !== false),
  };
}

export async function fetchMartDetail(owox: OwoxLike, id: string): Promise<MartDetail> {
  const dm = await owox.getJson<{ id: string; title: string; schema?: { fields?: SchemaField[] } | null }>(`/api/data-marts/${id}`);
  return { id: dm.id, title: dm.title, fields: dm.schema?.fields ?? [] };
}

export async function fetchBlendable(owox: OwoxLike, id: string): Promise<Blendable> {
  const b = await owox.getJson<{ availableSources?: AvailableSource[]; mainUniqueCountKeyFields?: string[] }>(`/api/data-marts/${id}/blendable-schema`);
  return {
    availableSources: (b.availableSources ?? []).map(({ aliasPath, dataMartId, title, isAccessibleForReporting }) => ({ aliasPath, dataMartId, title, isAccessibleForReporting })),
    mainUniqueCountKeyFields: b.mainUniqueCountKeyFields ?? [],
  };
}

export function flattenFields(fields: SchemaField[], prefix = ''): { path: string; field: SchemaField }[] {
  return fields.flatMap((f) => {
    if (f.isHiddenForReporting || f.status === 'DISCONNECTED') return [];
    const path = prefix ? `${prefix}.${f.name}` : f.name;
    return [{ path, field: f }, ...(f.mode === 'REPEATED' ? [] : flattenFields(f.fields ?? [], path))];
  });
}

/**
 * Every path in a schema that still exists, for checking references. Unlike `flattenFields`, hidden-for-reporting
 * fields count (a unique-count key is often hidden); DISCONNECTED ones never do, they can't be queried.
 */
export function allFieldPaths(fields: SchemaField[], prefix = ''): Set<string> {
  const out = new Set<string>();
  for (const f of fields) {
    if (f.status === 'DISCONNECTED') continue;
    const path = prefix ? `${prefix}.${f.name}` : f.name;
    out.add(path);
    if (f.mode !== 'REPEATED') for (const p of allFieldPaths(f.fields ?? [], path)) out.add(p);
  }
  return out;
}
