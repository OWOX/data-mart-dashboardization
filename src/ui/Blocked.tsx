import type { Blocked as BlockedInfo, BlockCode } from '../types';

const STEPS: Record<BlockCode, string[]> = {
  NO_GOAL: [
    'Open Project settings in OWOX Data Marts and edit the project description.',
    'Add a Metrics table with a "Critical number" row (snippet below).',
    'Link the Fact cell to the Data Mart field that measures the goal: open the Data Mart, select the field, copy the link.',
    'Come back and click Retry.',
  ],
  GOAL_PLACEHOLDER: [],
  GOAL_FIELD_NOT_FOUND: [
    'Open the Data Mart linked in the Critical number row.',
    'Check the field name in the link\'s field= parameter against the schema.',
    'Fix the link in the project description, then Retry.',
  ],
  GOAL_NO_PRIMARY_KEY: [
    'Open the Data Mart linked in the Critical number row.',
    'Mark its primary key fields in the schema.',
    'Retry.',
  ],
  GOAL_NOT_CONNECTED: [
    'Ask a project admin for access to the goal\'s Data Mart, or',
    'add a calculated field to a Data Mart you can see that references the goal\'s Data Mart, then',
    'Retry.',
  ],
  AI_NOT_CONFIGURED: [
    'Ask a project admin to open Plugins, select Gyroscope and map an AI Credential.',
    'Retry.',
  ],
  AI_INVALID: [
    'Make the metrics tables name exact fields through Data Mart links.',
    'Make sure each linked Data Mart has a date field.',
    'Retry.',
  ],
};
STEPS.GOAL_PLACEHOLDER = STEPS.NO_GOAL;

const heading = (code: BlockCode): string =>
  code === 'AI_NOT_CONFIGURED' ? 'AI model not configured'
    : code === 'AI_INVALID' ? "The model doesn't match your Data Marts"
      : "Goal can't be tracked";

const snippet = (projectId: string): string => `## Metrics
| Role | Metric | Owner | Plan | Fact |
|---|---|---|---|---|
| Critical number | ARR | <owner> | [Plan · ARR](https://app.owox.com/ui/${projectId}/data-marts/<plan-data-mart-id>/data-setup?field=<plan_field>) | [ARR](https://app.owox.com/ui/${projectId}/data-marts/<fact-data-mart-id>/data-setup?field=<fact_field>) |`;

export function Blocked({ blocked, projectId, onRetry }: { blocked: BlockedInfo; projectId: string; onRetry: () => void }) {
  const showSnippet = blocked.code === 'NO_GOAL' || blocked.code === 'GOAL_PLACEHOLDER';
  const text = snippet(projectId);
  return (
    <div className="gy-blocked">
      <h1>{heading(blocked.code)}</h1>
      <p>{blocked.detail}</p>
      {blocked.mismatches.length > 0 && (
        <ol>{blocked.mismatches.map((m, i) => <li key={i}>{m}</li>)}</ol>
      )}
      <h2>How to fix</h2>
      <ol>{STEPS[blocked.code].map((s) => <li key={s}>{s}</li>)}</ol>
      {showSnippet && (
        <div>
          <pre className="gy-snippet">{text}</pre>
          <button type="button" className="gy-btn" onClick={() => { void navigator.clipboard?.writeText(text)?.catch(() => {}); }}>Copy</button>
        </div>
      )}
      <p><button type="button" className="gy-btn gy-btn-primary" onClick={onRetry}>Retry</button></p>
    </div>
  );
}
