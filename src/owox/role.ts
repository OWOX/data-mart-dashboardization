import type { OwoxLike } from './sources';

interface Fields { roles?: unknown; fullName?: unknown; email?: unknown }
/** The backend answers with the fields at the top level; a wrapped `member` is read as a fallback. */
interface AuthContext extends Fields { member?: Fields }

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The member's role and display name; any failure reads as not admin and no name. */
export async function fetchMember(owox: OwoxLike): Promise<{ isAdmin: boolean; name: string | null }> {
  try {
    const body = await owox.getJson<AuthContext>('/api/auth/context');
    const wrapped = body.member ?? {};
    const roles = Array.isArray(body.roles) ? body.roles : wrapped.roles;
    return { isAdmin: Array.isArray(roles) && roles.includes('admin'), name: text(body.fullName) ?? text(wrapped.fullName) ?? text(body.email) ?? text(wrapped.email) };
  } catch {
    return { isAdmin: false, name: null };
  }
}
