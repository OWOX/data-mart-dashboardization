import { Boxes, ListChecks, Loader2, Network, RefreshCw, Spline, Target, Wrench, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GROUPS, type ApplyTarget, type Check, type CheckStatus, type Fix, type GroupId, type Suggestion } from '../checkup/types';
import type { ApplyResult } from '../checkup/apply';
import { metricsSnippet } from './Blocked';
import { CollapsibleCard } from './CollapsibleCard';
import { InfoTip } from './InfoTip';

export interface CheckupProps {
  /** Starts a run; the tab passes onUpdate. App binds runCheckup's other arguments. */
  run: (onUpdate: (checks: Check[]) => void) => Promise<Check[]>;
  projectId: string;
  now: () => Date;
  /** Goes to an OWOX page; without it Fix links show as plain text. */
  onOpen?: (path: string) => void;
  /** A project admin can pick an answer and Apply it; a member reads the question only. */
  isAdmin?: boolean;
  /** Writes one answer from the current state. Without it nothing can be applied. */
  apply?: (t: ApplyTarget) => Promise<ApplyResult>;
  /** Drafts an answer with the AI for a check; passed only when an admin has an AI credential. */
  suggestAi?: (checkId: string) => Promise<Suggestion | null>;
  /** Goes to another Settings tab: a Fix link to Metrics, and a Rebuild answer. */
  onOpenTab?: (tab: 'ontology') => void;
  /** No model yet: every section opens. */
  noModel?: boolean;
  /** Runs a checkup each time it turns true; the tab stays mounted while hidden. Default true. */
  active?: boolean;
  /** The Metrics editor holds unsaved edits, so an answer that replaces the model's core classes waits. */
  metricsDirty?: boolean;
}

const GROUP_ICON: Record<GroupId, LucideIcon> = { critical: Target, core: Boxes, contexts: Network, connections: Spline, metrics: ListChecks, housekeeping: Wrench };
const MARK: Record<CheckStatus, string> = { ok: '✓', fail: '✗', warn: '!', recommend: '💡', skip: '–', running: '' };
const WORD: Record<CheckStatus, string> = { ok: 'passed', fail: 'failed', warn: 'warning', recommend: 'recommendation', skip: 'skipped', running: 'checking' };
// worst first
const SEVERITY: CheckStatus[] = ['fail', 'warn', 'recommend', 'running', 'ok', 'skip'];

const HEAD_WORD: Record<CheckStatus, string> = { fail: 'blocker', warn: 'warning', recommend: 'recommendation', ok: 'passed', skip: 'skipped', running: 'checking' };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function summarize(checks: Check[], running: boolean): string {
  const n = (s: CheckStatus) => checks.filter((c) => c.status === s).length;
  const parts = [
    n('fail') > 0 && `${n('fail')} failed`,
    n('warn') > 0 && plural(n('warn'), 'warning', 'warnings'),
    n('recommend') > 0 && plural(n('recommend'), 'recommendation', 'recommendations'),
    n('ok') > 0 && `${n('ok')} passed`,
  ].filter(Boolean) as string[];
  const text = parts.join(', ');
  return running ? `${text}${text ? ', ' : ''}checking…` : text;
}

/** The section heading's count: "1 warning, 1 recommendation", or "All passed" when nothing needs a look. */
function countText(checks: Check[]): string {
  if (checks.length === 0) return '';
  if (checks.every((c) => c.status === 'skip')) return 'Skipped';
  const n = (st: CheckStatus) => checks.filter((c) => c.status === st).length;
  const parts = [
    n('fail') > 0 && `${n('fail')} failed`,
    n('warn') > 0 && plural(n('warn'), 'warning', 'warnings'),
    n('recommend') > 0 && plural(n('recommend'), 'recommendation', 'recommendations'),
  ].filter(Boolean) as string[];
  if (n('running') > 0) parts.push('checking…');
  return parts.length ? parts.join(', ') : 'All passed';
}

const worst = (checks: Check[]): CheckStatus => SEVERITY.find((s) => checks.some((c) => c.status === s)) ?? 'skip';
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const sectionId = (g: GroupId) => `gy-ck-sec-${g}`;
const recommendedIndex = (s: Suggestion) => Math.max(0, s.options.findIndex((o) => o.recommended));

export function CheckupTab({ run, projectId, now, onOpen, isAdmin = false, apply, suggestAi, onOpenTab, noModel = false, active = true, metricsDirty = false }: CheckupProps) {
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
  const noModelRef = useRef(noModel);
  noModelRef.current = noModel;
  // which sections start folded; set once, when the first run ends, so a rerun never refolds what a person opened
  const [folded, setFolded] = useState<Record<string, boolean> | null>(null);
  // the option picked per check, as an index; unset means the recommended one
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [results, setResults] = useState<Record<string, ApplyResult>>({});
  // AI answers per check for the session; null: the AI had none
  const [aiAnswers, setAiAnswers] = useState<Record<string, Suggestion>>({});
  // asks that came back empty; the button shows again
  const [aiFailed, setAiFailed] = useState<ReadonlySet<string>>(new Set());
  const [aiBusy, setAiBusy] = useState<ReadonlySet<string>>(new Set());
  const asked = useRef(new Set<string>());
  const suggestRef = useRef(suggestAi);
  suggestRef.current = suggestAi;

  const start = useCallback(() => {
    const id = ++runId.current;
    setRunning(true);
    setShown(null);
    const fail = () => runId.current === id;
    runRef.current((list) => { if (fail()) setChecks(list); }).then((list) => {
      if (!fail()) return;
      setChecks(list);
      setRunning(false);
      setFolded((prev) => {
        if (prev) return prev;
        const none = noModelRef.current;
        return Object.fromEntries(GROUPS.map((g) => [g.id, !(none || list.some((c) => c.group === g.id && (c.status === 'fail' || c.status === 'warn')))]));
      });
      setCheckedAt(nowRef.current());
      setAnnounced(summarize(list, false));
    }, () => {
      if (!fail()) return;
      setRunning(false);
    });
  }, []);

  useEffect(() => {
    if (!active) return;
    start();
    return () => { runId.current++; };
  }, [start, active]);

  const openMetrics = () => onOpenTab?.('ontology');

  const doApply = async (c: Check, s: Suggestion) => {
    if (!apply) return;
    const target = s.target(s.options[picked[c.id] ?? recommendedIndex(s)]!);
    setBusy((p) => new Set(p).add(c.id));
    const r = await apply(target).catch((e): ApplyResult => ({ ok: false, refused: false, error: e instanceof Error ? e.message : String(e) }));
    setBusy((p) => { const n = new Set(p); n.delete(c.id); return n; });
    setResults((p) => { const n = { ...p }; if (r.ok) delete n[c.id]; else n[c.id] = r; return n; });
    // a build leaves Settings and a rebuild shows its proposal; every other answer changes what the checks see
    if (r.ok && target.kind !== 'model') start();
    // a rebuild shows its proposal on the Metrics tab
    if (r.ok && target.kind === 'model' && target.action === 'rebuild') openMetrics();
  };

  const suggest = async (c: Check) => {
    if (!suggestRef.current || asked.current.has(c.id)) return;
    asked.current.add(c.id);
    setAiFailed((p) => { const n = new Set(p); n.delete(c.id); return n; });
    setAiBusy((p) => new Set(p).add(c.id));
    const s = await suggestRef.current(c.id).catch(() => null);
    setAiBusy((p) => { const n = new Set(p); n.delete(c.id); return n; });
    if (s) setAiAnswers((p) => ({ ...p, [c.id]: s }));
    else { asked.current.delete(c.id); setAiFailed((p) => new Set(p).add(c.id)); }
  };

  const renderQuestion = (c: Check) => {
    const base = c.suggestion;
    if (!base || c.status === 'ok' || c.status === 'skip' || c.status === 'running') return null;
    const needsAi = base.ai && base.options.length === 0;
    const answered = needsAi && c.id in aiAnswers;
    const sug = needsAi ? aiAnswers[c.id] ?? null : base;
    const failed = aiFailed.has(c.id);
    // a new core list replaces the model's flags under a Metrics draft that has edits
    const waits = metricsDirty && !!sug && sug.options.length > 0 && (() => {
      const t = sug.target(sug.options[picked[c.id] ?? recommendedIndex(sug)]!);
      return t.kind === 'settings' && 'coreClasses' in t.patch;
    })();
    const question = sug?.question ?? base.question;
    const result = results[c.id];
    return (
      <div className="gy-ck-ask">
        <p className="gy-ck-q">{question}</p>
        {sug && sug.options.length > 0 && (
          <div role="radiogroup" aria-label={question} className="gy-ck-opts">
            {sug.options.map((o, i) => (
              <label key={i} className="gy-ck-opt">
                <input type="radio" name={`gy-opt-${c.id}`} checked={(picked[c.id] ?? recommendedIndex(sug)) === i} disabled={!isAdmin || busy.has(c.id)}
                  onChange={() => setPicked((p) => ({ ...p, [c.id]: i }))} />
                <span>{o.label}</span>
                {o.recommended && <span className="gy-tag">Recommended</span>}
              </label>
            ))}
          </div>
        )}
        {!isAdmin && <p className="dm-muted gy-ck-note">Ask a project admin</p>}
        {isAdmin && needsAi && !answered && (suggestAi
          ? <button type="button" className="gy-btn" disabled={aiBusy.has(c.id)} onClick={() => void suggest(c)}>
              {aiBusy.has(c.id) && <Loader2 size={14} className="gy-spin" aria-hidden="true" />}Suggest an answer
            </button>
          : <p className="dm-muted gy-ck-note">Map an AI credential to get a suggested answer</p>)}
        {isAdmin && failed && !answered && <p className="dm-muted gy-ck-note">Couldn&apos;t suggest an answer. Try again, or fix it from the link.</p>}
        {isAdmin && sug && sug.options.length > 0 && apply && (
          <button type="button" className="gy-btn gy-btn-primary" disabled={busy.has(c.id) || waits} aria-busy={busy.has(c.id)} onClick={() => void doApply(c, sug)}>
            {busy.has(c.id) && <Loader2 size={14} className="gy-spin" aria-hidden="true" />}Apply
          </button>
        )}
        {isAdmin && waits && <p className="dm-muted gy-ck-note">Save or discard your Metrics edits first</p>}
        {result && !result.ok && !result.refused && <p role="alert" className="gy-form-error">{result.error}</p>}
        {result && !result.ok && result.refused && (
          <div className="gy-ck-refused">
            <p className="dm-muted gy-ck-note">OWOX didn&apos;t accept the write from here. Paste this in yourself:</p>
            <pre className="gy-snippet">{result.snippet}</pre>
            <button type="button" className="gy-btn" onClick={() => copy(result.snippet)}>Copy</button>
          </div>
        )}
      </div>
    );
  };

  const copy = (text: string) => { void Promise.resolve(navigator.clipboard?.writeText(text)).catch(() => {}); };

  const renderCheck = (c: Check) => {
    const fixes = (c.status === 'fail' || c.status === 'warn' || c.status === 'recommend') && c.fix ? [c.fix].flat() : [];
    const link = (fix: Fix) => {
      if (fix.kind === 'owox') return onOpen ? <button type="button" className="gy-link" onClick={() => onOpen(fix.path)}>{fix.label}</button> : fix.label;
      if (fix.kind === 'tab') return <button type="button" className="gy-link" onClick={openMetrics}>{fix.label}</button>;
      return <button type="button" className="gy-link" onClick={() => { copy(metricsSnippet(projectId)); setShown(c.id); }}>{fix.label}</button>;
    };
    return (
      <li key={c.id} className="gy-chk" data-state={c.status} data-bad={c.status === 'fail'}>
        <span className="gy-chk-mark" aria-hidden="true">{MARK[c.status]}</span>
        <span className="gy-chk-label">{c.label}</span>
        <InfoTip name={c.label} text={c.purpose} />
        <span className="gy-sr">, {WORD[c.status]}</span>
        {c.detail && <span className="gy-chk-detail">{c.detail}</span>}
        {fixes.length > 0 && <span className="gy-ck-fix">{fixes.map((f, i) => <span key={i}>{link(f)}</span>)}</span>}
        {fixes.some((f) => f.kind === 'snippet') && shown === c.id && <pre className="gy-snippet">{metricsSnippet(projectId)}</pre>}
        {renderQuestion(c)}
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
        // open while the first run streams, then by what the run found
        const fold = folded ? folded[g.id] ?? !noModel : false;
        return (
          <section key={g.id} id={sectionId(g.id)} aria-labelledby={`gy-ck-${g.id}`} className="gy-ck-group">
            <CollapsibleCard variant="section" icon={GROUP_ICON[g.id]} label={g.label} collapsed={fold}
              title={<h3 id={`gy-ck-${g.id}`} className="gy-ck-title">{g.label}<span className="gy-ck-gmark" data-state={w} aria-hidden="true">{MARK[w]}</span>{inGroup.length > 0 && <span className="gy-sr">, {HEAD_WORD[w]}</span>}<span className="gy-ck-count">{countText(inGroup)}</span></h3>}>
            {plain.length > 0 && <div className="dm-card-block"><ul className="gy-build-list">{plain.map(renderCheck)}</ul></div>}
            {contexts.length > 0 && <div className="gy-ck-contexts">
            {contexts.map((ctx) => {
              const mine = inGroup.filter((c) => c.context?.id === ctx.id);
              const cw = worst(mine);
              const allOk = mine.every((c) => c.status === 'ok');
              return (
                <CollapsibleCard key={ctx.id} label={ctx.name} collapsed={allOk} attention={cw === 'fail' || cw === 'warn'}
                  title={<><span className="gy-ck-gmark" data-state={allOk ? 'ok' : cw} aria-hidden="true">{MARK[allOk ? 'ok' : cw]}</span>{ctx.name}<span className="gy-sr">, {WORD[allOk ? 'ok' : cw]}</span></>}>
                  <ul className="gy-build-list">{mine.map(renderCheck)}</ul>
                </CollapsibleCard>
              );
            })}
            </div>}
            </CollapsibleCard>
          </section>
        );
      })}
    </div>
  );
}
