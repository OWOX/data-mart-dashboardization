// Local mock of @owox/plugin-sdk. Two uses:
//  • `npm test`     — vitest aliases this file; tests override methods with vi.spyOn.
//  • `npm run dev`  — vite aliases this file (serve mode) so the UI runs in the browser with NO host.
//
// settings + collections are real (localStorage-backed) so you can iterate with LOCAL creds; backend
// and the brokered capabilities need the real host, so here they're stubbed and logged to the console.

// ── Local creds/settings for browser dev ────────────────────────────────────
// Edit these, or from the browser console:
//   localStorage.setItem('owox.dev.settings', JSON.stringify({ 'github-repo': 'me/repo' }))
const DEV_DEFAULTS: Record<string, unknown> = {
  greeting: 'Hi from local dev',
};

function devSettings(): Record<string, unknown> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('owox.dev.settings') : null;
    return { ...DEV_DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEV_DEFAULTS };
  }
}

export const settings = {
  get: async (key: string): Promise<unknown> => devSettings()[key],
  all: async (): Promise<Record<string, unknown>> => devSettings(),
};

export const backend = {
  call: async (fn: string, args?: unknown): Promise<unknown> => {
    console.info('[owox dev mock] backend.call', fn, args);
    return { message: `(local mock) backend "${fn}" isn't run in the browser — install into the host for the real thing` };
  },
};

export const ui = { toast: async (msg: string): Promise<void> => { console.info('[owox dev mock] toast:', msg); } };

// localStorage-backed document store, mirroring the host's `collections` capability. Real collections
// declared `scope: 'user'` are transparently keyed to the acting user by the host (the plugin never
// sees a user id); the dev runner has exactly one operator, so project- and user-scope collapse to the
// same local store here — there's no second user to isolate from. A missing doc resolves to `null`,
// matching the real capability (not `undefined`).
function collKey(name: string): string {
  return 'owox.dev.coll.' + name;
}
function readColl(name: string): Record<string, any> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(collKey(name)) : null;
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function writeColl(name: string, docs: Record<string, any>): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(collKey(name), JSON.stringify(docs));
}
export const collections = (name: string) => ({
  list: async () => Object.values(readColl(name)),
  get: async (id: string) => readColl(name)[id] ?? null,
  put: async (id: string, doc: any) => {
    const docs = readColl(name);
    const d = { ...doc, id };
    docs[id] = d;
    writeColl(name, docs);
    return d;
  },
  delete: async (id: string) => {
    const docs = readColl(name);
    delete docs[id];
    writeColl(name, docs);
    return { ok: true };
  },
});

// Brokered capabilities need the host. Stub every method to log + resolve, so the UI never crashes.
const stub = (name: string) =>
  new Proxy(
    {},
    {
      get: (_t, method) => async (...args: unknown[]) => {
        console.info(`[owox dev mock] ${name}.${String(method)}`, ...args);
        return undefined;
      },
    },
  ) as any;

// Concrete (not a Proxy stub) so `vi.spyOn(sdk.owox, 'request')` works — a Proxy's `get` trap
// fabricates a fresh function on every access, which spyOn can't intercept.
export const owox = {
  request: async (method: string, path: string, body?: unknown): Promise<unknown> => {
    console.info('[owox dev mock] owox.request', method, path, body);
    return null;
  },
  // Mirrors the real SDK: `{ headers, body }`, headers an allowlisted slice (today just
  // `x-owox-run-id`, set by the HTTP Data stream so the caller can fetch that run's totals).
  requestWithHeaders: async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ headers: Record<string, string>; body: unknown }> => {
    console.info('[owox dev mock] owox.requestWithHeaders', method, path, body);
    return { headers: {}, body: null };
  },
};
// `ai` returns the real capability's shape ({ text, model, raw }) so UI that reads reply.text works
// in mock mode too. Use `npm run dev:broker` for a real model reply.
export const ai = {
  chat: async (args: unknown) => {
    console.info('[owox dev mock] ai.chat', args);
    return { text: '(local mock) hello — run `npm run dev:broker` for a real AI reply.', model: 'mock', raw: {} };
  },
  embeddings: async (args: unknown) => {
    console.info('[owox dev mock] ai.embeddings', args);
    return { embeddings: [], model: 'mock', raw: {} };
  },
} as any;
export const git = stub('git');
export const sheets = stub('sheets');
export const credentials = stub('credentials');
