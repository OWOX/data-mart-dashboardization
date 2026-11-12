import type { ProjectSettings } from '../types';

export type CheckStatus = 'running' | 'ok' | 'recommend' | 'warn' | 'fail' | 'skip';
export type GroupId = 'critical' | 'core' | 'contexts' | 'connections' | 'metrics' | 'housekeeping';
/** Where a check is fixed: an OWOX page (path from /ui/...) or a tab of this plugin. */
export type Fix = { kind: 'owox'; label: string; path: string } | { kind: 'tab'; label: string; tab: 'ontology' } | { kind: 'snippet'; label: string };
export interface Option { label: string; value: unknown; recommended: boolean }
/** What Apply writes. */
export type ApplyTarget =
  | { kind: 'settings'; patch: Partial<ProjectSettings> }
  | { kind: 'description'; mode: 'append' | 'metrics_table'; text: string }
  | { kind: 'context_create'; name: string; description: string }
  | { kind: 'context_update'; id: string; name: string; description: string }
  | { kind: 'mart_contexts'; martId: string; contextIds: string[] }
  | { kind: 'model'; action: 'build' | 'rebuild' };
/** A question under a check that isn't filled, with a recommended answer and what Apply does with the chosen one. */
export interface Suggestion { question: string; options: Option[]; ai: boolean; target: (o: Option) => ApplyTarget }
export interface Check {
  id: string;            // stable within a run, e.g. 'project.table', 'context:<id>.plan'
  group: GroupId;
  /** Per-context checks carry the context: the tab draws a sub-group per context. */
  context?: { id: string; name: string };
  label: string;
  /** What the check is for, in one or two sentences (the (i) tooltip). */
  purpose: string;
  status: CheckStatus;
  detail?: string;
  fix?: Fix | Fix[];     // shown only when status is 'fail', 'warn' or 'recommend'; one link per place to fix it
  suggestion?: Suggestion;
}
export const GROUPS: { id: GroupId; label: string; purpose: string }[] = [
  { id: 'critical', label: 'Critical number', purpose: 'The number that says whether the business is on track, and its class, which sits in the center.' },
  { id: 'core', label: 'Core classes', purpose: 'The 3 to 7 dictionary classes around the critical number: who buys, what is bought, where they come from.' },
  { id: 'contexts', label: 'Contexts', purpose: 'The teams or areas that move the critical number. Each one has its own critical number and plan.' },
  { id: 'connections', label: 'Connections', purpose: 'References between Data Marts, which draw the lines and order the cards.' },
  { id: 'metrics', label: 'Metrics', purpose: 'The metrics of each class: which ones show, which one is key, and their plan and forecast sources.' },
  { id: 'housekeeping', label: 'Housekeeping', purpose: 'The AI credential, and who last changed the model.' },
];
