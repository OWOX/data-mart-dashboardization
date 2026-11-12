import type { OwoxLike } from './sources';

interface AuthContext { member?: { roles?: unknown; fullName?: unknown; email?: unknown } }

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The member's role and display name; any failure reads as not admin and no name. */
export async function fetchMember(owox: OwoxLike): Promise<{ isAdmin: boolean; name: string | null }> {
  try {
    const m = (await owox.getJson<AuthContext>('/api/auth/context')).member ?? {};
    return { isAdmin: Array.isArray(m.roles) && m.roles.includes('admin'), name: text(m.fullName) ?? text(m.email) };
  } catch {
    return { isAdmin: false, name: null };
  }
}

/** True when the member's roles include admin; any failure reads as not admin. */
export const fetchIsAdmin = (owox: OwoxLike): Promise<boolean> => fetchMember(owox).then((m) => m.isAdmin);
