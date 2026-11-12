import type { ReactNode } from 'react';
import type { Blocked as BlockedInfo, BlockCode } from '../types';

// [settings] and [plugins] in a step become links to that OWOX page
const PAGES = {
  settings: { label: 'Project settings', path: (projectId: string) => `/ui/${projectId}/project-settings` },
  plugins: { label: 'Plugins', path: (projectId: string) => `/ui/${projectId}/plugins` },
} as const;
type Page = keyof typeof PAGES;
const PAGE_TOKEN = new RegExp(`\\[(${Object.keys(PAGES).join('|')})\\]`);

const STEPS: Record<BlockCode, string[]> = {
  NO_GOAL: [
    'Open [settings] in OWOX Data Marts and edit the project description.',
    'Add a Metrics table with a "Critical number" row (snippet below).',
    'Link the Fact cell to the Data Mart field that measures the goal: open the Data Mart, select the field, copy the link.',
    'Come back and click Retry.',
  ],
  GOAL_PLACEHOLDER: [],
  GOAL_FIELD_NOT_FOUND: [
    'Open the Data Mart linked in the Critical number row.',
    'Check the field name in the link\'s field= parameter against the schema.',
    'Fix the link in the project description in [settings], then Retry.',
  ],
  GOAL_NO_PRIMARY_KEY: [
    'Open the Data Mart linked in the Critical number row.',
    'Mark its primary key fields in the schema.',
    'Retry.',
  ],
  GOAL_NO_ACCESS: [
    'Ask a project admin with access to the goal Data Mart',
    'to build the model, then Retry.',
  ],
  AI_NOT_CONFIGURED: [
    'Ask a project admin to open [plugins], select Gyroscope and map an AI Credential.',
    'Retry.',
  ],
  AI_INVALID: [
    'In [settings], make the metrics tables name exact fields through Data Mart links.',
    'Make sure each linked Data Mart has a date field.',
    'Retry.',
  ],
  AI_REQUEST_FAILED: [
    'Ask a project admin to open [plugins], select Gyroscope and check the AI Credential: its key, and the model mapped to Reasoning.',
    'A large project can take the model past the time limit. Mapping a faster model to Reasoning helps.',
    'Retry.',
  ],
};
STEPS.GOAL_PLACEHOLDER = STEPS.NO_GOAL;

const heading = (code: BlockCode): string =>
  code === 'AI_NOT_CONFIGURED' ? 'AI model not configured'
    : code === 'AI_REQUEST_FAILED' ? "The AI model didn't answer"
      : code === 'AI_INVALID' ? "The model doesn't match your Data Marts"
        : "Goal can't be tracked";

export const metricsSnippet = (projectId: string): string => `## Metrics
| Role | Metric | Owner | Plan | Fact |
|---|---|---|---|---|
| Critical number | ARR | <owner> | [Plan · ARR](https://app.owox.com/ui/${projectId}/data-marts/<plan-data-mart-id>/data-setup?field=<plan_field>) | [ARR](https://app.owox.com/ui/${projectId}/data-marts/<fact-data-mart-id>/data-setup?field=<fact_field>) |`;

function stepContent(step: string, projectId: string, onOpen?: (path: string) => void): ReactNode[] {
  return step.split(PAGE_TOKEN).map((part, i) => {
    if (i % 2 === 0) return part;
    const page = PAGES[part as Page];
    return onOpen
      ? <button key={i} type="button" className="gy-link" onClick={() => onOpen(page.path(projectId))}>{page.label}</button>
      : page.label;
  });
}

export function Blocked({ blocked, projectId, onRetry, onBack, backLabel = 'Back to canvas', embedded = false, onOpen, onCheckup }: {
  blocked: BlockedInfo; projectId: string; onRetry: () => void; onCheckup?: () => void; onBack?: () => void; backLabel?: string;
  /** Inside a page that has its own h1: the heading drops to h2. */
  embedded?: boolean;
  /** Goes to an OWOX page; without it the page names show as plain text. */
  onOpen?: (path: string) => void;
}) {
  const showSnippet = blocked.code === 'NO_GOAL' || blocked.code === 'GOAL_PLACEHOLDER';
  const text = metricsSnippet(projectId);
  return (
    <div className="gy-blocked">
      {embedded ? <h2>{heading(blocked.code)}</h2> : <h1>{heading(blocked.code)}</h1>}
      <p>{blocked.detail}</p>
      {blocked.mismatches.length > 0 && (
        <ol>{blocked.mismatches.map((m, i) => <li key={i}>{m}</li>)}</ol>
      )}
      <h2>How to fix</h2>
      <ol>{STEPS[blocked.code].map((s) => <li key={s}>{stepContent(s, projectId, onOpen)}</li>)}</ol>
      {showSnippet && (
        <div>
          <pre className="gy-snippet">{text}</pre>
          <button type="button" className="gy-btn" onClick={() => { void navigator.clipboard?.writeText(text)?.catch(() => {}); }}>Copy</button>
        </div>
      )}
      <p><button type="button" className="gy-btn gy-btn-primary" onClick={onRetry}>Retry</button>
        {onCheckup && <>{' '}<button type="button" className="gy-btn" onClick={onCheckup}>Run checkup</button></>}
        {onBack && <>{' '}<button type="button" className="gy-btn" onClick={onBack}>{backLabel}</button></>}
      </p>
    </div>
  );
}
