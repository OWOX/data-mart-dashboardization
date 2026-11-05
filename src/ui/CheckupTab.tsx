import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GROUPS, type Check, type CheckStatus } from '../checkup/types';
import { metricsSnippet } from './Blocked';

export interface CheckupProps {
  /** Starts a run; the tab passes onUpdate. App binds runCheckup's other arguments. */
  run: (onUpdate: (checks: Check[]) => void) => Promise<Check[]>;
  projectId: string;
  now: () => Date;
  /** Goes to an OWOX page; without it Fix links show as plain text. */
  onOpen?: (path: string) => void;
  onOpenTab?: (tab: 'ontology') => void;
}

const MARK: Record<CheckStatus, string> = { ok: '✓', fail: '✗', warn: '!', skip: '–', running: '' };
const WORD: Record<CheckStatus, string> = { ok: 'passed', fail: 'failed', warn: 'warning', skip: 'skipped', running: 'checking' };
// worst first
const SEVERITY: CheckStatus[] = ['fail', 'warn', 'running', 'ok', 'skip'];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function summarize(checks: Check[], running: boolean): string {
  const n = (s: CheckStatus) => checks.filter((c) => c.status === s).length;
  const parts = [
    n('fail') > 0 && `${n('fail')} failed`,
    n('warn') > 0 && plural(n('warn'), 'warning', 'warnings'),
    n('ok') > 0 && `${n('ok')} passed`,
  ].filter(Boolean) as string[];
  const text = parts.join(', ');
  return running ? `${text}${text ? ', ' : ''}checking…` : text;
}

const worst = (checks: Check[]): CheckStatus => SEVERITY.find((s) => checks.some((c) => c.status === s)) ?? 'skip';
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function CheckupTab({ run, projectId, now, onOpen, onOpenTab }: CheckupProps) {
  const [checks, setChecks] = useState<Check[]>([]);
  const [running, setRunning] = useState(true);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [announced, setAnnounced] = useState('');
  const [shown, setShown] = useState<string | null>(null);
  const runId = useRef(0);
  const runRef = useRef(run);
  runRef.current = run;
  const nowRef = useRef(now);
  nowRef.current = now;

  const start = useCallback(() => {
    const id = ++runId.current;
    setRunning(true);
    setShown(null);
    const fail = () => runId.current === id;
    runRef.current((list) => { if (fail()) setChecks(list); }).then((list) => {
      if (!fail()) return;
      setChecks(list);
      setRunning(false);
      setCheckedAt(nowRef.current());
      setAnnounced(summarize(list, false));
    }, () => {
      if (!fail()) return;
      setRunning(false);
    });
  }, []);

  useEffect(() => {
    start();
    return () => { runId.current++; };
  }, [start]);

  const copy = (text: string) => { void Promise.resolve(navigator.clipboard?.writeText(text)).catch(() => {}); };

  const renderCheck = (c: Check) => {
    const fixable = (c.status === 'fail' || c.status === 'warn') && c.fix;
    const fix = c.fix;
    return (
      <li key={c.id} className="gy-chk" data-state={c.status} data-bad={c.status === 'fail'}>
        <span className="gy-chk-mark" aria-hidden="true">{MARK[c.status]}</span>
        <span className="gy-chk-label">{c.label}</span>
        <span className="gy-sr">, {WORD[c.status]}</span>
        {c.detail && <span className="gy-chk-detail">{c.detail}</span>}
        {fixable && fix && (
          <span className="gy-ck-fix">
            {fix.kind === 'owox' && (onOpen
              ? <button type="button" className="gy-link" onClick={() => onOpen(fix.path)}>{fix.label}</button>
              : fix.label)}
            {fix.kind === 'tab' && (
              <button type="button" className="gy-link" onClick={() => onOpenTab?.(fix.tab)}>{fix.label}</button>
            )}
            {fix.kind === 'snippet' && (
              <button type="button" className="gy-link" onClick={() => { copy(metricsSnippet(projectId)); setShown(c.id); }}>{fix.label}</button>
            )}
          </span>
        )}
        {fixable && fix?.kind === 'snippet' && shown === c.id && <pre className="gy-snippet">{metricsSnippet(projectId)}</pre>}
      </li>
    );
  };

  return (
    <div className="gy-ck">
      <div className="gy-ck-head">
        <h2>Setup checkup</h2>
        {running && <span className="gy-ck-summary">{summarize(checks, true)}</span>}
        <span className="gy-ck-summary" aria-live="polite">{running ? '' : announced}</span>
        {!running && checkedAt && <span className="gy-ck-when">Checked {hhmm(checkedAt)}</span>}
        <button type="button" className="gy-icon-btn" aria-label="Run checks again" title="Refresh" onClick={start}>
          <RefreshCw size={16} className={running ? 'gy-spin' : undefined} />
        </button>
      </div>
      {GROUPS.map((g) => {
        const inGroup = checks.filter((c) => c.group === g.id);
        if (inGroup.length === 0) return null;
        const plain = inGroup.filter((c) => !c.context);
        const contexts: { id: string; name: string }[] = [];
        for (const c of inGroup) if (c.context && !contexts.some((x) => x.id === c.context!.id)) contexts.push(c.context);
        const w = worst(inGroup);
        return (
          <section key={g.id} aria-labelledby={`gy-ck-${g.id}`} className="gy-ck-group">
            <h3 id={`gy-ck-${g.id}`} className="gy-build-h">
              {g.label}{' '}
              <span className="gy-ck-gmark" data-state={w} aria-hidden="true">{MARK[w]}</span>
              <span className="gy-sr">, {WORD[w]}</span>
            </h3>
            {plain.length > 0 && <ul className="gy-build-list">{plain.map(renderCheck)}</ul>}
            {contexts.map((ctx) => (
              <div key={ctx.id} className="gy-chk-group" role="group" aria-label={ctx.name}>
                <h4 className="gy-build-sub">{ctx.name}</h4>
                <ul className="gy-build-list">{inGroup.filter((c) => c.context?.id === ctx.id).map(renderCheck)}</ul>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
