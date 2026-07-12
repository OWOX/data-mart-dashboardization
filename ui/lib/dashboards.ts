import { collections } from '@owox/plugin-sdk';
import type { Dashboard } from './types';

const COLLECTION = 'dashboards';
const db = () => collections(COLLECTION);

/**
 * Strip host-owned `$`-prefixed fields before a write. `$createdBy` never reaches the plugin in the
 * first place (the host strips it before the doc arrives — see types.ts), so this delete is a no-op
 * for it; `$createdAt`/`$updatedAt` DO reach the plugin as read-only timestamps and must not be
 * echoed back on a put. The host ignores plugin-supplied values for these anyway, but sending them
 * back is still wrong, so every write path routes through here first.
 */
function stripHostFields<T extends object>(doc: T): T {
  const copy = { ...doc } as Record<string, unknown>;
  delete copy.$createdBy;
  delete copy.$createdAt;
  delete copy.$updatedAt;
  return copy as T;
}

/**
 * The host filters `list()` by each doc's `$entity` ACL, so this returns exactly the dashboards
 * whose data mart the current user can access. There is no authz code in this plugin.
 */
export async function listDashboards(): Promise<Dashboard[]> {
  return (await db().list()) as Dashboard[];
}

export async function getDashboard(id: string): Promise<Dashboard | null> {
  return (await db().get(id)) as Dashboard | null;
}

/** Every save bumps configVersion — it is both the concurrency stamp and the refetch key. */
export async function saveDashboard(d: Dashboard): Promise<Dashboard> {
  const next = stripHostFields({ ...d, configVersion: d.configVersion + 1 });
  return (await db().put(next.id, next)) as Dashboard;
}

export async function deleteDashboard(id: string): Promise<void> {
  await db().delete(id);
}

export async function duplicateDashboard(d: Dashboard): Promise<Dashboard> {
  const copy = stripHostFields<Dashboard>({
    ...d,
    id: crypto.randomUUID(),
    name: `${d.name} (copy)`,
    configVersion: 0,
  });
  return (await db().put(copy.id, copy)) as Dashboard;
}
