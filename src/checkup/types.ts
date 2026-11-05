export type CheckStatus = 'running' | 'ok' | 'warn' | 'fail' | 'skip';
export type GroupId = 'plugin' | 'project' | 'goal' | 'contexts' | 'connections' | 'model';
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
  { id: 'plugin', label: 'Plugin' }, { id: 'project', label: 'Project description' }, { id: 'goal', label: 'Goal Data Mart' },
  { id: 'contexts', label: 'Contexts' }, { id: 'connections', label: 'Connections' }, { id: 'model', label: 'Saved model' },
];
