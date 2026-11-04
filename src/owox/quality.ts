import type { OwoxLike } from './sources';

export type QualityState = 'NEVER_RUN' | 'QUEUED' | 'RUNNING' | 'PASSED' | 'ISSUES' | 'EXECUTION_FAILED' | 'RESTRICTED' | 'CANCELLED' | 'ALL_DISABLED';

/** What the card needs from OWOX's data-quality summary of one Data Mart. */
export interface QualitySummary {
  state: QualityState | string;
  enabledChecks: number;
  passedChecks: number;
  failedChecks: number;
  errorChecks: number;
  warningFindings: number;
  errorFindings: number;
  highestSeverity: 'notice' | 'warning' | 'error' | null;
  lastRunAt: string | null;
}

/**
 * One call for every Data Mart on the canvas. Never cached: a refused or failed call, or an older
 * client without `postJson`, gives null and the cards show no icon.
 */
export async function fetchQuality(owox: OwoxLike, martIds: string[]): Promise<Map<string, QualitySummary> | null> {
  if (!owox.postJson || martIds.length === 0) return null;
  try {
    const res = await owox.postJson<{ items?: { dataMartId: string; summary?: QualitySummary | null }[] }>(
      '/api/data-marts/data-quality/summaries', { dataMartIds: martIds },
    );
    const out = new Map<string, QualitySummary>();
    for (const i of res?.items ?? []) if (i?.dataMartId && i.summary) out.set(i.dataMartId, i.summary);
    return out;
  } catch {
    return null;
  }
}

export interface QualityBadge { kind: 'passed' | 'issues' | 'failed'; tone: 'ok' | 'warn' | 'bad'; label: string }

/** The icon a summary earns, or null for every state that shows none. */
export function qualityBadge(s: QualitySummary): QualityBadge | null {
  if (s.state === 'PASSED') return { kind: 'passed', tone: 'ok', label: `Data quality: all ${s.enabledChecks} checks passed` };
  if (s.state === 'ISSUES') {
    const n = s.errorFindings + s.warningFindings;
    return { kind: 'issues', tone: s.highestSeverity === 'error' ? 'bad' : 'warn', label: `Data quality: ${n} issues` };
  }
  if (s.state === 'EXECUTION_FAILED') return { kind: 'failed', tone: 'bad', label: 'Data quality checks failed to run' };
  return null;
}
