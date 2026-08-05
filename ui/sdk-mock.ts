// Local development implementation of the current @owox/plugin-sdk contract. Production builds
// resolve and bundle the real package; Vite/Vitest alias the package to this file only when there
// is no ODM host iframe.

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

const owox = {
  async getJson<T>(path: string): Promise<T> {
    console.info('[owox dev mock] GET', path);
    if (path.includes('/runs/')) {
      return { status: 'SUCCESS', totals: null } as T;
    }
    return { schema: { fields: [] } } as T;
  },
  dataMarts: {
    async list(): Promise<any[]> {
      console.info('[owox dev mock] dataMarts.list');
      return [];
    },
    async traverseData(id: string, options?: unknown) {
      console.info('[owox dev mock] dataMarts.traverseData', id, options);
      return {
        runId: undefined as string | undefined,
        async *rowChunks(): AsyncGenerator<Record<string, unknown>[]> {
          // Empty local dataset. Use the ODM host to query real Data Marts.
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
