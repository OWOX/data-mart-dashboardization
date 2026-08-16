// Local development implementation of the current @owox/plugin-sdk contract. Production builds
// resolve and bundle the real package; Vite/Vitest alias the package to this file only when there
// is no ODM host iframe.
import { aggLabel } from './lib/httpData';
import type { AggregateFunction } from './lib/types';

export type CollectionEnvelope<T> = {
  id: string;
  parentId?: string;
  document: T;
  createdAt: string;
  updatedAt: string;
};

export type CollectionList<T> = {
  items: CollectionEnvelope<T>[];
  nextCursor: string | null;
};

type CollectionPutOptions = { parentId?: string };

export type CollectionClient<T> = {
  list(options?: { limit?: number; cursor?: string }): Promise<CollectionList<T>>;
  get(id: string): Promise<CollectionEnvelope<T> | null>;
  put(id: string, document: T, options?: CollectionPutOptions): Promise<CollectionEnvelope<T>>;
  delete(id: string): Promise<void>;
};

function collectionKey(name: string): string {
  return `owox.dev.collection.${name}`;
}

// happy-dom on Node 22 may expose no localStorage. Keep the same mock usable in unit tests without
// changing browser dev, where localStorage remains the convenient persistence mechanism.
const memoryStorage = new Map<string, string>();

function readCollection<T>(name: string): Record<string, CollectionEnvelope<T>> {
  try {
    const key = collectionKey(name);
    const raw =
      typeof localStorage === 'undefined' ? (memoryStorage.get(key) ?? null) : localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeCollection<T>(name: string, docs: Record<string, CollectionEnvelope<T>>): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(collectionKey(name), JSON.stringify(docs));
  } else {
    memoryStorage.set(collectionKey(name), JSON.stringify(docs));
  }
}

export function collections<T>(name: string): CollectionClient<T> {
  return {
    async list({ limit = 50, cursor } = {}) {
      const items = Object.values(readCollection<T>(name)).sort((a, b) =>
        a.id.localeCompare(b.id),
      );
      const start = cursor ? Number(cursor) : 0;
      const page = items.slice(start, start + limit);
      const next = start + page.length;
      return { items: page, nextCursor: next < items.length ? String(next) : null };
    },

    async get(id) {
      return readCollection<T>(name)[id] ?? null;
    },

    async put(id, document, options = {}) {
      const docs = readCollection<T>(name);
      const now = new Date().toISOString();
      const envelope: CollectionEnvelope<T> = {
        id,
        ...(options.parentId === undefined ? {} : { parentId: options.parentId }),
        document,
        createdAt: docs[id]?.createdAt ?? now,
        updatedAt: now,
      };
      docs[id] = envelope;
      writeCollection(name, docs);
      return envelope;
    },

    async delete(id) {
      const docs = readCollection<T>(name);
      delete docs[id];
      writeCollection(name, docs);
    },
  };
}

// ---------------------------------------------------------------------------
// Sample Data Marts
//
// `npm run dev` has no host, so the mock has to stand in for one. An empty catalogue makes the
// plugin unusable offline — no mart to pick, no schema to generate from, no rows to render — so
// these two marts exist purely to make the UI clickable and the query path debuggable.
// ---------------------------------------------------------------------------

type MockField = { name: string; type: string; values?: string[] };

const MARTS: Record<string, { title: string; fields: MockField[] }> = {
  'sample-web-traffic': {
    title: 'Sample — Web Traffic',
    fields: [
      { name: 'date', type: 'DATE' },
      {
        name: 'channel',
        type: 'STRING',
        values: ['Organic Search', 'Paid Search', 'Direct', 'Social', 'Email', 'Referral'],
      },
      { name: 'country', type: 'STRING', values: ['US', 'UK', 'DE', 'FR', 'UA', 'JP', 'BR'] },
      { name: 'device', type: 'STRING', values: ['desktop', 'mobile', 'tablet'] },
      // Deliberately above PIE_MAX_CATEGORIES so generate() emits a bar here and pies elsewhere —
      // one local dashboard then exercises both chart paths.
      {
        name: 'landingPage',
        type: 'STRING',
        values: Array.from({ length: 24 }, (_, i) => `/landing/page-${i + 1}`),
      },
      { name: 'sessions', type: 'INT64' },
      { name: 'revenue', type: 'FLOAT64' },
    ],
  },
  'sample-orders': {
    title: 'Sample — Orders',
    fields: [
      { name: 'orderDate', type: 'DATE' },
      { name: 'status', type: 'STRING', values: ['NEW', 'PAID', 'SHIPPED', 'REFUNDED'] },
      { name: 'region', type: 'STRING', values: ['EMEA', 'AMER', 'APAC'] },
      { name: 'orders', type: 'INT64' },
      { name: 'aov', type: 'FLOAT64' },
    ],
  },
};

const NUMERIC = /^(INT|FLOAT|NUMERIC|BIGNUMERIC|DECIMAL|DOUBLE|LONG)/i;
const TEMPORAL = /^(DATE|DATETIME|TIMESTAMP)$/i;

const DAY_MS = 86_400_000;
/** Fixed window, not `Date.now()`: a mock whose numbers move on every reload is a debugging trap. */
const EPOCH = Date.UTC(2026, 4, 1);
const DAYS = 90;
/** Rows materialised before ORDER BY + LIMIT, mirroring the server's sort-then-cut order. */
const MAX_MATERIALISED = 2000;

const day = (i: number): string => new Date(EPOCH + i * DAY_MS).toISOString().slice(0, 10);

/** FNV-1a → [0,1). Deterministic per (mart, column, row) so every reload draws the same chart. */
function pseudo(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

// The server buckets the date and groups by it, so the mock's date domain must fold the same way.
// NB: tailwind.config scans ui/**/*.ts, so a bare Tailwind utility name used as an identifier or in
// prose here becomes a real rule in the shipped ui/styles.css — hence `bucketDate`, not the obvious
// name. Check `npm run css:check` after renaming anything in this file.
function bucketDate(iso: string, unit: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  switch (unit) {
    case 'WEEK': {
      const date = new Date(Date.UTC(y, m - 1, d));
      // ISO week starts Monday; getUTCDay() is 0 for Sunday.
      const back = (date.getUTCDay() + 6) % 7;
      return new Date(date.getTime() - back * DAY_MS).toISOString().slice(0, 10);
    }
    case 'MONTH':
      return `${iso.slice(0, 7)}-01`;
    case 'QUARTER':
      return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
    case 'YEAR':
      return `${y}-01-01`;
    default:
      return iso;
  }
}

/** Distinct values a grouping column can take — the mock's stand-in for the column's domain. */
function domainOf(martId: string, name: string, truncUnit?: string): unknown[] {
  const field = MARTS[martId]?.fields.find(f => f.name === name);
  if (field?.values) return field.values;
  if (field && TEMPORAL.test(field.type)) {
    const days = Array.from({ length: DAYS }, (_, i) => bucketDate(day(i), truncUnit ?? 'DAY'));
    return [...new Set(days)];
  }
  if (field && NUMERIC.test(field.type)) {
    return Array.from({ length: 25 }, (_, i) => Math.round(10 + pseudo(`${name}|${i}`) * 990));
  }
  return Array.from({ length: 8 }, (_, i) => `${name} ${i + 1}`);
}

/**
 * COUNT_DISTINCT must report the column's real domain size, not noise: `generate()` probes it to
 * decide pie-vs-bar, so a random answer would mean the local dashboard never contains a pie.
 * Integer columns stay integral — a fractional session count is a distraction while debugging.
 */
function metricValue(martId: string, name: string, fn: string, row: number): number {
  if (fn === 'COUNT_DISTINCT') return domainOf(martId, name).length;
  const type = MARTS[martId]?.fields.find(f => f.name === name)?.type ?? '';
  const base = pseudo(`${martId}|${name}|${row}`);
  if (fn === 'COUNT') return Math.round(1 + base * 500);
  const value = 50 + base * 4950;
  return /^(INT|LONG)/i.test(type) ? Math.round(value) : Math.round(value * 100) / 100;
}

type TraverseOptions = {
  column?: string[];
  aggregation?: { column: string; function: string }[];
  dateTrunc?: { column: string; unit: string }[];
  sort?: { column: string; direction: string }[];
  limit?: number;
};

/**
 * Answers a traverseData request the way the service would: projected columns WITH an aggregation
 * rule become `<col> | <TOKEN>` metrics, the rest are grouping keys enumerated over their domains
 * (so every row is a distinct group), then ORDER BY is applied BEFORE LIMIT — which is what makes
 * a "Top N" component actually top N here as well as in production.
 */
function generateRows(martId: string, options: TraverseOptions): Record<string, unknown>[] {
  const columns = options.column ?? [];
  const aggs = new Map((options.aggregation ?? []).map(a => [a.column, a.function]));
  const trunc = new Map((options.dateTrunc ?? []).map(t => [t.column, t.unit]));
  const limit = Math.max(1, Math.min(options.limit ?? 20, 1001));

  const dims = columns.filter(c => !aggs.has(c));
  const metrics = columns.filter(c => aggs.has(c));
  const domains = dims.map(name => domainOf(martId, name, trunc.get(name)));

  const combos = domains.reduce((n, d) => n * d.length, 1);
  const count = dims.length ? Math.min(combos, MAX_MATERIALISED) : 1;

  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    const row: Record<string, unknown> = {};
    let stride = 1;
    dims.forEach((name, k) => {
      row[name] = domains[k][Math.floor(i / stride) % domains[k].length];
      stride *= domains[k].length;
    });
    for (const name of metrics) {
      const fn = aggs.get(name)!;
      row[aggLabel(name, fn as AggregateFunction)] = metricValue(martId, name, fn, i);
    }
    rows.push(row);
  }

  // ORDER BY names the RAW column; the output column it resolves to is the aggregated alias when
  // that column carries an aggregation (compile.ts relies on the server doing exactly this).
  const sort = options.sort?.[0];
  if (sort) {
    const key = aggs.has(sort.column)
      ? aggLabel(sort.column, aggs.get(sort.column) as AggregateFunction)
      : sort.column;
    const sign = sort.direction === 'asc' ? 1 : -1;
    rows.sort((a, b) => sign * (a[key]! > b[key]! ? 1 : a[key]! < b[key]! ? -1 : 0));
  }

  return rows.slice(0, limit);
}

/** Grand totals live on the RUN, not the rows — keyed by runId, exactly as the host serves them. */
const runTotals = new Map<string, Record<string, number | string | boolean | null>>();
let runSeq = 0;

const owox = {
  async getJson<T>(path: string): Promise<T> {
    console.info('[owox dev mock] GET', path);
    const run = /\/api\/data-marts\/[^/]+\/runs\/([^/?]+)/.exec(path);
    if (run) {
      return { status: 'SUCCESS', totals: runTotals.get(decodeURIComponent(run[1])) ?? null } as T;
    }
    const mart = /\/api\/data-marts\/([^/?]+)/.exec(path);
    const fields = mart ? (MARTS[decodeURIComponent(mart[1])]?.fields ?? []) : [];
    return { schema: { fields: fields.map(({ name, type }) => ({ name, type })) } } as T;
  },
  dataMarts: {
    async list(): Promise<any[]> {
      console.info('[owox dev mock] dataMarts.list');
      return Object.entries(MARTS).map(([id, mart]) => ({
        id,
        title: mart.title,
        status: 'PUBLISHED',
        availableForReporting: true,
      }));
    },
    async traverseData(id: string, options: TraverseOptions = {}) {
      console.info('[owox dev mock] dataMarts.traverseData', id, options);
      const rows = generateRows(id, options);
      const runId = `dev-run-${++runSeq}`;
      // A scorecard aggregates with no grouping key: its one row IS the grand total.
      const grouped = (options.column ?? []).some(
        c => !(options.aggregation ?? []).some(a => a.column === c),
      );
      if (!grouped && rows[0]) {
        runTotals.set(runId, rows[0] as Record<string, number | string | boolean | null>);
      }
      return {
        runId,
        async *rowChunks(): AsyncGenerator<Record<string, unknown>[]> {
          yield rows;
        },
      };
    },
  },
};

export type PluginContext = {
  readonly pluginId: string;
  readonly installationId: string;
  readonly projectId: string;
  readonly userId: string;
  readonly theme: 'light' | 'dark';
  readonly owox: typeof owox;
  readonly collections: typeof collections;
  readonly ui: {
    openExternal(url: string): Promise<void>;
    navigate(path: string): void;
  };
  readonly signal: AbortSignal;
};

let localContext: PluginContext | undefined;

export async function connect(): Promise<PluginContext> {
  localContext ??= {
    pluginId: 'data-mart-dashboardization-dev',
    installationId: 'local',
    projectId: 'local',
    userId: 'local',
    theme: 'light',
    owox,
    collections,
    ui: {
      async openExternal(url) {
        console.info('[owox dev mock] openExternal', url);
      },
      navigate(path) {
        console.info('[owox dev mock] navigate', path);
      },
    },
    signal: new AbortController().signal,
  };
  return localContext;
}
