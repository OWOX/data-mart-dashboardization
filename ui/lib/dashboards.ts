import { getPluginContext } from './plugin-runtime';
import type { Dashboard } from './types';

const COLLECTION = 'dashboards';
const PAGE_SIZE = 100;

type DashboardDocument = Omit<
  Dashboard,
  'id' | '$entity' | '$createdAt' | '$updatedAt'
>;

type DashboardEnvelope = {
  id: string;
  parentId?: string;
  document: DashboardDocument;
  createdAt: string;
  updatedAt: string;
};

async function collection() {
  return (await getPluginContext()).collections<DashboardDocument>(COLLECTION);
}

/** The host owns identity, entity binding and timestamps; only the dashboard body is persisted. */
function toDocument(dashboard: Dashboard): DashboardDocument {
  const { id: _id, $entity: _entity, $createdAt: _createdAt, $updatedAt: _updatedAt, ...document } =
    dashboard;
  return document;
}

/** Keep the existing UI model while translating the collection envelope at one boundary. */
function fromEnvelope(envelope: DashboardEnvelope): Dashboard {
  if (!envelope.parentId) {
    throw new Error(`Dashboard ${envelope.id} has no Data Mart binding`);
  }
  return {
    ...envelope.document,
    id: envelope.id,
    $entity: { type: 'data-mart', id: envelope.parentId },
    $createdAt: envelope.createdAt,
    $updatedAt: envelope.updatedAt,
  };
}

/**
 * Read all pages because the existing dashboard table is an in-memory searchable list. The host
 * has already filtered the collection by the current member's SEE permission on each Data Mart.
 */
export async function listDashboards(): Promise<Dashboard[]> {
  const db = await collection();
  const dashboards: Dashboard[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const page = await db.list({ limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
    dashboards.push(...page.items.map(envelope => fromEnvelope(envelope as DashboardEnvelope)));
    if (!page.nextCursor) break;
    if (seenCursors.has(page.nextCursor)) {
      throw new Error('Dashboard collection returned a repeated cursor');
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (cursor);

  return dashboards;
}

export async function getDashboard(id: string): Promise<Dashboard | null> {
  const envelope = await (await collection()).get(id);
  return envelope ? fromEnvelope(envelope as DashboardEnvelope) : null;
}

/** Every save bumps configVersion — it is both the concurrency stamp and the refetch key. */
export async function saveDashboard(dashboard: Dashboard): Promise<Dashboard> {
  const next = { ...dashboard, configVersion: dashboard.configVersion + 1 };
  const envelope = await (await collection()).put(next.id, toDocument(next), {
    parentId: next.$entity.id,
  });
  return fromEnvelope(envelope as DashboardEnvelope);
}

export async function deleteDashboard(id: string): Promise<void> {
  await (await collection()).delete(id);
}

export async function duplicateDashboard(dashboard: Dashboard): Promise<Dashboard> {
  const copy: Dashboard = {
    ...dashboard,
    id: crypto.randomUUID(),
    name: `${dashboard.name} (copy)`,
    configVersion: 0,
    $createdAt: undefined,
    $updatedAt: undefined,
  };
  const envelope = await (await collection()).put(copy.id, toDocument(copy), {
    parentId: copy.$entity.id,
  });
  return fromEnvelope(envelope as DashboardEnvelope);
}
