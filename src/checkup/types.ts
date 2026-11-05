export type CheckStatus = 'running' | 'ok' | 'warn' | 'fail' | 'skip';
export type GroupId = 'heading' | 'drivers' | 'connections' | 'housekeeping';
/** Where a check is fixed: an OWOX page (path from /ui/...) or a tab of this plugin. */
export type Fix = { kind: 'owox'; label: string; path: string } | { kind: 'tab'; label: string; tab: 'ontology' } | { kind: 'snippet'; label: string };
export interface Check {
  id: string;            // stable within a run, e.g. 'project.table', 'context:<id>.plan'
  group: GroupId;
  /** Per-context checks carry the context: the tab draws a sub-group per context. */
  context?: { id: string; name: string };
  label: string;
  status: CheckStatus;
  detail?: string;
  fix?: Fix;             // shown only when status is 'fail' or 'warn'
}
export const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'heading', label: 'Where the business is heading' }, { id: 'drivers', label: 'What drives it' },
  { id: 'connections', label: 'How it connects' }, { id: 'housekeeping', label: 'Housekeeping' },
];
