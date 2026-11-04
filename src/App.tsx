import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PluginContext } from '@owox/plugin-sdk';
import type { Blocked as BlockedInfo, CacheDoc, CardCache, CompareChoice, Model, RangeChoice, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';
import { compareLabel, resolveRange } from './lib/dates';
import { describeError } from './lib/errors';
import { seedFrom } from './model/seed';
import { shownModel } from './model/shown';
import { checkHealth, type Issue } from './model/health';
import { buildModel, currentInputHash, type BuildStep } from './model/build';
import { aiGenerate, type Generate } from './model/interpret';
import { fetchInputs, type Inputs, type MartDetail, type OwoxLike } from './owox/sources';
import { cacheKey, persistable, refreshCanvas } from './metrics/refresh';
import {
  isStale, loadCache, loadOntology, loadPreferences, loadProjectModel, loadSettings, saveCache, saveOntology, savePreferences, saveSettings, type CollectionsLike,
} from './store/collections';
import { Blocked } from './ui/Blocked';
import { BuildProgress } from './ui/BuildProgress';
import { Canvas } from './ui/Canvas';
import { LoadingLine } from './ui/LoadingLine';
import { Header, RangeControls } from './ui/Header';
import { SettingsPage, type SettingsTab } from './ui/SettingsPage';

export interface AppDeps {
  owox: OwoxLike;
  store: CollectionsLike;
  generate: Generate | null;
  userId: string;
  now: () => Date;
}

type View =
  | { name: 'loading' }
  | { name: 'building' }
  | { name: 'blocked'; blocked: BlockedInfo }
  | { name: 'error'; message: string; retry: 'load' | 'build' }
  | { name: 'ready' }
  | { name: 'settings'; tab: SettingsTab };

function depsFrom(ctx: PluginContext): AppDeps {
  const ai = ctx.credentials?.ai;
  return {
    owox: ctx.owox as unknown as OwoxLike,
    store: ctx as unknown as CollectionsLike,
    generate: ai ? aiGenerate(ai, ctx.signal) : null,
    userId: ctx.userId,
    now: () => new Date(),
  };
}

const SEED_NOTE = "Couldn't save your model; it will be saved next time.";

const ROUTES: Record<SettingsTab, string> = { general: '/settings', ontology: '/settings/ontology' };
/** The settings tab a route opens; anything else opens the canvas. */
const tabOf = (route: string | undefined): SettingsTab | null => {
  const path = route?.replace(/\/+$/, '');
  return path === ROUTES.ontology ? 'ontology' : path === ROUTES.general ? 'general' : null;
};

const rangeOf = (s: Settings): RangeChoice => ({ kind: 'preset', preset: s.defaultPreset });
const compareOf = (s: Settings): CompareChoice => (s.comparisonDefault ? { kind: 'preset', preset: 'previous_period' } : { kind: 'off' });

/** The previous doc for the key with the new cards laid over it, metric by metric; a spark is replaced once its new one arrives. */
function mergePartial(base: CacheDoc | null, cards: Record<string, CardCache>, model: Model, anchor: string, thresholdPct: number, key: string, comparison: boolean): CacheDoc {
  const merged: Record<string, CardCache> = { ...base?.cards };
  for (const [id, c] of Object.entries(cards)) {
    const old = base?.cards[id];
    // the old spark stays until the key metric's new result lands
    const key = model.classes.find((x) => x.id === id)?.keyMetricId;
    const keyDone = !!key && key in c.metrics;
    merged[id] = { metrics: { ...old?.metrics, ...c.metrics }, spark: keyDone ? c.spark : old?.spark ?? null };
  }
  return {
    modelHash: model.inputHash, builtAt: model.builtAt, editedAt: model.editedAt, thresholdPct, anchor,
    refreshedAt: base?.refreshedAt ?? new Date().toISOString(), key, comparison, cards: merged,
  };
}

export function App({ ctx, deps: injected }: { ctx: PluginContext; deps?: AppDeps }) {
  const [deps] = useState(() => injected ?? depsFrom(ctx));
  const { owox, store, generate, userId, now } = deps;

  const [view, setView] = useState<View>({ name: 'loading' });
  // a reload lands on the settings tab the route names; read once, the first load only
  const startTab = useRef(tabOf(ctx.route));
  const [model, setModel] = useState<Model | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [range, setRange] = useState<RangeChoice>(() => rangeOf(DEFAULT_SETTINGS));
  const [compare, setCompare] = useState<CompareChoice>(() => compareOf(DEFAULT_SETTINGS));
  const [cache, setCache] = useState<CacheDoc | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // loading: the line and step text show, from the first screen until the refresh ends; progress: metrics done of total, once known
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [steps, setSteps] = useState<BuildStep[]>([]);
  // the input hash the model is out of date against, or null; a discarded proposal's hash is dismissed for this session only
  const [outdated, setOutdated] = useState<string | null>(null);
  const [dismissedHash, setDismissedHash] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  // the seeded model couldn't be saved on first open; shown until a save goes through
  const [seedNote, setSeedNote] = useState<string | null>(null);
  // what this member can see, fetched once per model; data is null when the fetch failed
  const [inputs, setInputs] = useState<{ model: Model; data: Inputs | null } | null>(null);
  // the health check of the model against the Data Marts; the schemas it read are kept for the Ontology Model page
  const [health, setHealth] = useState<{ model: Model; issues: Issue[]; details: Map<string, MartDetail> } | null>(null);
  const healthNow = useRef<typeof health>(null);
  healthNow.current = health;
  const refreshId = useRef(0);
  const fetchedFor = useRef<Model | null>(null);
  const checkedFor = useRef<object | null>(null);
  const modelNow = useRef<Model | null>(null);
  modelNow.current = model;
  const cacheNow = useRef<CacheDoc | null>(null);
  cacheNow.current = cache;

  const load = useCallback(async () => {
    setView({ name: 'loading' });
    try {
      const [s, own, prefs] = await Promise.all([loadSettings(store), loadOntology(store), loadPreferences(store).catch(() => null)]);
      let m = own;
      if (!m) {
        // first open: start from the project model cut to what this member can reach, with no AI call
        const project = await loadProjectModel(store);
        if (project) {
          const accessible = await owox.dataMarts.list().then((x) => new Set(x.map((y) => y.id))).catch(() => null);
          // without the access list the whole project model is the seed (the canvas filter still applies) and its hash stays
          m = accessible ? seedFrom(project, accessible) : project;
          // the kept classes hash differently from the project's; without this the first open would read as out of date
          if (accessible) {
            try {
              const inputs = await fetchInputs(owox);
              // a hash taken without the contexts would read as out of date once they load
              if (inputs.contextsOk) m = { ...m, inputHash: await currentInputHash(owox, inputs, m.classes.map((c) => c.id)) };
            } catch { /* keep the project hash */ }
          }
          // a failed save keeps the seed in memory; the next save of the model writes it
          try { await saveOntology(store, m); } catch { setSeedNote(SEED_NOTE); }
        }
      }
      setSettings(s);
      setRange(prefs?.range ?? rangeOf(s));
      setCompare(prefs?.compare ?? compareOf(s));
      setModel(m);
      const tab = startTab.current;
      startTab.current = null;
      if (m) setView(tab ? { name: 'settings', tab } : { name: 'ready' });
      else void buildRef.current();
    } catch (e) {
      setView({ name: 'error', message: describeError(e), retry: 'load' });
    }
  }, [store, owox]);

  const buildRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => { void load(); }, [load]);

  const build = useCallback(async () => {
    refreshId.current++;
    setSteps([]);
    setRefreshing(false);
    setLoading(false);
    setView({ name: 'building' });
    setOutdated(null);
    try {
      const result = await buildModel({ owox, generate, userId, now: now(), onStep: (s) => setSteps((p) => [...p, s]) });
      if (!result.ok) { setView({ name: 'blocked', blocked: result.blocked }); return; }
      await saveOntology(store, result.model);
      setSeedNote(null);
      setModel(result.model);
      setCache(null);
      setView({ name: 'ready' });
    } catch (e) {
      setView({ name: 'error', message: describeError(e), retry: 'build' });
    }
  }, [owox, generate, userId, now, store]);

  buildRef.current = build;

  const visible = useMemo<ReadonlySet<string> | null>(
    // a failed access check shows nothing rather than everything
    () => (inputs && inputs.model === model ? new Set(inputs.data?.marts.map((m) => m.id) ?? []) : null),
    [inputs, model],
  );

  const periodShown = useMemo(() => {
    const spec = resolveRange(range, compare, now(), settings.weekStart);
    // with a comparison, show the windows actually compared: the days so far (cut when it is shorter), not the whole range
    const fact = spec.compareFact ?? spec.factWindow;
    return spec.comparison && fact ? { range: fact, comparison: spec.comparison } : { range: spec.range, comparison: null };
  }, [range, compare, now, settings.weekStart]);

  const marts = useMemo(
    () => new Map((inputs?.data?.marts ?? []).map((m) => [m.id, { description: m.description, icon: m.icon ?? null }])),
    [inputs],
  );

  const issuesNow = useMemo<Issue[]>(() => (health && health.model === model ? health.issues : []), [health, model]);
  const missingIds = useMemo(() => new Set(issuesNow.filter((i) => i.kind === 'mart_missing' && i.metricId === null).map((i) => i.classId)), [issuesNow]);

  const refresh = useCallback(async (force: boolean): Promise<boolean> => {
    if (!model) return false;
    const id = ++refreshId.current;
    const current = () => id === refreshId.current;
    const at = now();
    const spec = resolveRange(range, compare, at, settings.weekStart);
    const key = cacheKey(range, compare, settings.weekStart);
    const keep = persistable(range, compare);
    try {
      // Custom choices are not persisted: they compute and stay in state only.
      const saved = keep ? await loadCache(store, key) : null;
      if (!current()) return false;
      if (keep) setCache(saved);
      else setCache((c) => (c?.key === key ? c : null));
      if (!force && keep && !isStale(saved, model, spec.anchor, settings.thresholdPct)) { setRefreshing(false); setLoading(false); return true; }
      // the doc on screen (a custom range has no saved one) keeps its numbers until a new result replaces them
      const shown = keep ? saved : cacheNow.current?.key === key ? cacheNow.current : null;
      setLoading(true);
      setProgress(null);
      setRefreshing(true);
      const doc = await refreshCanvas({
        owox, model, spec, key, thresholdPct: settings.thresholdPct, visibleIds: visible, issues: issuesNow,
        onProgress: (done, total) => { if (current()) setProgress({ done, total }); },
        onPartial: (cards) => { if (current()) setCache(mergePartial(shown, cards, shownModel(model), spec.anchor, settings.thresholdPct, key, spec.comparison !== null)); },
      });
      if (!current()) return false;
      setCache(doc);
      setSaveNote(null);
      if (keep) {
        try {
          await saveCache(store, key, doc);
        } catch (e) {
          if (current()) setSaveNote(`Couldn't save the refreshed data: ${describeError(e)}`);
        }
      }
    } catch {
      // cards keep their last cached values
    } finally {
      if (current()) { setRefreshing(false); setLoading(false); setProgress(null); }
    }
    return current();
  }, [model, range, compare, owox, store, now, settings.thresholdPct, settings.weekStart, visible, issuesNow]);

  const inReady = view.name === 'ready';
  // the Ontology Model page needs the Data Mart list and schemas too, and a reload can land on it
  const inSettings = view.name === 'settings';
  useEffect(() => {
    if ((!inReady && !inSettings) || !model || fetchedFor.current === model) return;
    fetchedFor.current = model;
    // without a cached doc the line shows from the first screen, not empty cards
    const probe = refreshId.current;
    const probeKey = cacheKey(range, compare, settings.weekStart);
    void (persistable(range, compare) ? loadCache(store, probeKey).catch(() => null) : Promise.resolve(null)).then((saved) => {
      if (!saved && refreshId.current === probe) setLoading(true);
    });
    fetchInputs(owox).catch(() => null).then(async (data) => {
      // the check lands before the inputs, so the first refresh already knows what is broken
      const checked = data ? await checkHealth(owox, model, new Set(data.marts.map((m) => m.id))).catch(() => null) : null;
      if (checked) setHealth({ model, ...checked });
      setInputs({ model, data });
    });
  }, [inReady, inSettings, model, owox]);

  const inputsReady = inReady && !!inputs && inputs.model === model;
  useEffect(() => {
    if (!inputsReady || !inputs || !model) return;
    // the out-of-date check waits for the refresh so the two don't compete for requests
    void refresh(false).then(async (done) => {
      const data = inputs.data;
      if (!done || !data || !data.contextsOk || checkedFor.current === inputs) return;
      checkedFor.current = inputs;
      const hash = await currentInputHash(owox, data, model.classes.map((c) => c.id), healthNow.current?.model === model ? healthNow.current.details : undefined).catch(() => null);
      if (hash !== null && modelNow.current === model) setOutdated(hash !== model.inputHash ? hash : null);
    });
  }, [inputsReady, inputs, model, owox, refresh]);

  const openSettings = (tab: SettingsTab = 'general') => { ctx.ui?.setRoute?.(ROUTES[tab]); setSettingsError(null); setView({ name: 'settings', tab }); };
  const leaveSettings = () => { ctx.ui?.setRoute?.('/'); setView({ name: 'ready' }); };
  const backToCanvas = model ? () => setView({ name: 'ready' }) : undefined;
  // Fire and forget: losing the remembered choice must not disturb the canvas.
  const remember = (r: RangeChoice, c: CompareChoice) => { void savePreferences(store, { range: r, compare: c }).catch(() => undefined); };
  const saveOntologyAndLeave = async (m: Model) => {
    await saveOntology(store, m);
    setSeedNote(null);
    // a new model object re-runs the refresh; the cache is judged by editedAt
    setModel(m);
    leaveSettings();
  };
  const ontologyDetails = useMemo(() => (health && health.model === model ? health.details : new Map<string, MartDetail>()), [health, model]);
  // null: the access check failed, so the editor verifies nothing
  const ontologyMarts = useMemo(() => (inputs && inputs.model === model && inputs.data ? inputs.data.marts.map((x) => ({ id: x.id, title: x.title })) : null), [inputs, model]);
  // the out-of-date check's hash for a model's classes; null when it can't be told (no contexts, or a transient failure)
  const hashOf = async (m: Model): Promise<string | null> => {
    const data = inputs && inputs.model === model ? inputs.data : null;
    if (!data || !data.contextsOk) return null;
    return currentInputHash(owox, data, m.classes.map((c) => c.id), ontologyDetails).catch(() => null);
  };
  const ontologyProps = model && inputs && inputs.model === model
    ? { model, owox, now, onSave: saveOntologyAndLeave, details: ontologyDetails, marts: ontologyMarts, hashOf }
    : null;
  const saveSettingsAndLeave = async (s: Settings) => {
    try {
      await saveSettings(store, s);
    } catch (e) {
      setSettingsError(`Couldn't save settings: ${describeError(e)}`);
      return;
    }
    const nextRange = s.defaultPreset !== settings.defaultPreset ? rangeOf(s) : range;
    const nextCompare = s.comparisonDefault !== settings.comparisonDefault ? compareOf(s) : compare;
    if (nextRange !== range || nextCompare !== compare) { setRange(nextRange); setCompare(nextCompare); remember(nextRange, nextCompare); }
    setSettings(s);
    leaveSettings();
  };

  switch (view.name) {
    case 'loading':
      return <main className="gy-main"><LoadingLine /><p className="gy-muted gy-loadnote">Loading settings and model…</p></main>;
    case 'building':
      return <BuildProgress steps={steps} />;
    case 'blocked':
      return <Blocked blocked={view.blocked} projectId={ctx.projectId} onRetry={() => void build()} onBack={backToCanvas} onOpen={ctx.ui?.navigate ? (path) => ctx.ui.navigate(path) : undefined} />;
    case 'error':
      return (
        <main className="gy-main">
          <h1>Something went wrong</h1>
          <p>{view.message}</p>
          <button type="button" className="gy-btn gy-btn-primary" onClick={() => void (view.retry === 'load' ? load() : build())}>Retry</button>
          {backToCanvas && <>{' '}<button type="button" className="gy-btn" onClick={backToCanvas}>Back to canvas</button></>}
        </main>
      );
    case 'settings':
      return (
        <SettingsPage
          settings={settings}
          tab={view.tab}
          onTabChange={(t) => ctx.ui?.setRoute?.(ROUTES[t])}
          ontology={ontologyProps}
          onBack={leaveSettings}
          onRebuild={(onStep) => buildModel({ owox, generate, userId, now: now(), onStep })}
          projectId={ctx.projectId}
          onDismiss={() => setDismissedHash(outdated)}
          onOpen={ctx.ui?.navigate ? (path) => ctx.ui.navigate(path) : undefined}
          canRebuild={!!generate}
          error={settingsError}
          onSave={(s) => void saveSettingsAndLeave(s)}
        />
      );
    case 'ready': {
      if (!model) return null;
      const status = loading || refreshing ? (progress ? `Loading metrics ${progress.done} of ${progress.total}` : inputsReady ? 'Loading metrics…' : 'Reading Data Marts…') : null;
      const main = model.classes.find((c) => c.id === model.goal.classId) ?? model.classes[0];
      const showOutdated = outdated !== null && outdated !== model.inputHash && outdated !== dismissedHash;
      const notices = issuesNow.length > 0 || showOutdated ? {
        issues: issuesNow.map((i) => ({
          classTitle: model.classes.find((c) => c.id === i.classId)?.title ?? i.classId,
          metricName: i.metricId ? (model.metrics.find((m) => m.id === i.metricId)?.alias ?? null) : null,
          text: i.text,
        })),
        outdated: showOutdated,
        onReview: () => openSettings('ontology'),
      } : undefined;
      return (
        <main className="gy-main">
          <Header title={main?.title ?? 'Gyroscope'} cache={cache} now={now()} period={periodShown} status={status} notices={notices} />
          {saveNote && <p className="gy-muted">{saveNote}</p>}
          {seedNote && <p className="gy-muted">{seedNote}</p>}
          {inputs && inputs.model === model && !inputs.data && <p className="gy-muted" role="alert">Couldn't check which Data Marts you can access. Reopen Gyroscope to try again.</p>}
          <Canvas
            tools={<RangeControls range={range} compare={compare} now={now()} weekStart={settings.weekStart} refreshing={refreshing} onChange={(r, c) => { setRange(r); setCompare(c); remember(r, c); }} onRefresh={() => void refresh(true)} onSettings={() => openSettings()} />}
            model={model} cache={cache} visibleIds={visible} missingIds={missingIds} marts={marts}
            compareLabel={compareLabel(range, compare, now(), settings.weekStart) ?? undefined}
            progress={progress}
            comparisonOn={compare.kind !== 'off'} refreshing={refreshing || loading} onRetry={() => void refresh(true)}
          />
        </main>
      );
    }
  }
}
