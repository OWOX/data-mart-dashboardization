import type { ModelConflict } from '../store/collections';

/** "<name> changed the model at <HH:MM>. Reload to see their changes."; without a readable time, no "at". */
export function conflictMessage(e: ModelConflict): string {
  const name = e.by?.trim() || 'Another admin';
  const t = new Date(e.at);
  if (!e.at || Number.isNaN(t.getTime())) return `${name} changed the model. Reload to see their changes.`;
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  return `${name} changed the model at ${hh}:${mm}. Reload to see their changes.`;
}
