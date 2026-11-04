import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PluginContext } from '@owox/plugin-sdk';
import type { Blocked as BlockedInfo, CacheDoc, CardCache, CompareChoice, Model, RangeChoice, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';
import { compareLabel, resolveRange } from './lib/dates';
import { describeError } from './lib/errors';
import { buildModel, currentInputHash } from './model/build';
import { aiGenerate, type Generate } from './model/interpret';
import { fetchInputs, type Inputs, type OwoxLike } from './owox/sources';
import { cacheKey, persistable, refreshCanvas } from './metrics/refresh';
import {
  isStale, loadCache, loadModel, loadPreferences, loadSettings, saveCache, saveModel, savePreferences, saveSettings, type CollectionsLike,
} from './store/collections';
import { Blocked } from './ui/Blocked';
import { Canvas } from './ui/Canvas';
import { LoadingLine } from './ui/LoadingLine';
import { Header, RangeControls } from './ui/Header';
import { SettingsPage } from './ui/SettingsPage';

export interface AppDeps {
  owox: OwoxLike;
  store: CollectionsLike;
  generate: Generate | null;
  userId: string;
  now: () => Date;
}

type View =
  | { name: 'loading' }
  | { name: 'intro' }
  | { name: 'building' }
  | { name: 'blocked'; blocked: BlockedInfo }
  | { name: 'error'; message: string; retry: 'load' | 'build' }
  | { name: 'ready' }
  | { name: 'settings' };

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

const rangeOf = (s: Settings): RangeChoice => ({ kind: 'preset', preset: s.defaultPreset });
const compareOf = (s: Settings): CompareChoice => (s.comparisonDefault ? { kind: 'preset', preset: 'previous_period' } : { kind: 'off' });

/** The previous doc for the key with the new cards laid over it, metric by metric; a spark is replaced once its new one arrives. */
function mergePartial(base: CacheDoc | null, cards: Record<string, CardCache>, model: Model, anchor: string, thresholdPct: number, key: string, comparison: boolean): CacheDoc {
  const merged: Record<string, CardCache> = { ...base?.cards };
  for (const [id, c] of Object.entries(cards)) {
    const old = base?.cards[id];
    merged[id] = { metrics: { ...old?.metrics, ...c.metrics }, spark: c.spark ?? old?.spark ?? null };
  }
  return {
    modelHash: model.inputHash, builtAt: model.builtAt, thresholdPct, anchor,
    refreshedAt: base?.refreshedAt ?? new Date().toISOString(), key, comparison, cards: merged,
  };
}

export function App({ ctx, deps: injected }: { ctx: PluginContext; deps?: AppDeps }) {
  const [deps] = useState(() => injected ?? depsFrom(ctx));
  const { owox, store, generate, userId, now } = deps;

  const [view, setView] = useState<View>({ name: 'loading' });
  const [model, setModel] = useState<Model | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [range, setRange] = useState<RangeChoice>(() => rangeOf(DEFAULT_SETTINGS));
  const [compare, setCompare] = useState<CompareChoice>(() => compareOf(DEFAULT_SETTINGS));
  const [cache, setCache] = useState<CacheDoc | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // loading: the line and step text show, from the first screen until the refresh ends; progress: metrics done of total, once known
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outdated, setOutdated] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  // what this member can see, fetched once per model; data is null when the fetch failed
  const [inputs, setInputs] = useState<{ model: Model; data: Inputs | null } | null>(null);
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
      const [s, m, prefs] = await Promise.all([loadSettings(store), loadModel(store), loadPreferences(store).catch(() => null)]);
      setSettings(s);
      setRange(prefs?.range ?? rangeOf(s));
      setCompare(prefs?.compare ?? compareOf(s));
      setModel(m);
      setView(m ? { name: 'ready' } : { name: 'intro' });
    } catch (e) {
      setView({ name: 'error', message: describeError(e), retry: 'load' });
    }
  }, [store]);

  useEffect(() => { void load(); }, [load]);

  const build = useCallback(async () => {
    refreshId.current++;
    setRefreshing(false);
    setLoading(false);
    setView({ name: 'building' });
    setOutdated(false);
    try {
      const result = await buildModel({ owox, generate, userId, now: now() });
      if (!result.ok) { setView({ name: 'blocked', blocked: result.blocked }); return; }
      await saveModel(store, result.model);
      setModel(result.model);
      setCache(null);
      setView({ name: 'ready' });
    } catch (e) {
      setView({ name: 'error', message: describeError(e), retry: 'build' });
    }
  }, [owox, generate, userId, now, store]);

  const visible = useMemo<ReadonlySet<string> | null>(
    () => (inputs && inputs.model === model && inputs.data ? new Set(inputs.data.marts.map((m) => m.id)) : null),
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
        owox, model, spec, key, thresholdPct: settings.thresholdPct, visibleIds: visible,
        onProgress: (done, total) => { if (current()) setProgress({ done, total }); },
        onPartial: (cards) => { if (current()) setCache(mergePartial(shown, cards, model, spec.anchor, settings.thresholdPct, key, spec.comparison !== null)); },
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
  }, [model, range, compare, owox, store, now, settings.thresholdPct, settings.weekStart, visible]);

  const inReady = view.name === 'ready';
  useEffect(() => {
    if (!inReady || !model || fetchedFor.current === model) return;
    fetchedFor.current = model;
    // without a cached doc the first screen is the preloader, not empty cards
    const probe = refreshId.current;
    const probeKey = cacheKey(range, compare, settings.weekStart);
    void (persistable(range, compare) ? loadCache(store, probeKey).catch(() => null) : Promise.resolve(null)).then((saved) => {
      if (!saved && refreshId.current === probe) setLoading(true);
    });
    fetchInputs(owox).catch(() => null).then((data) => setInputs({ model, data }));
  }, [inReady, model, owox]);

  const inputsReady = inReady && !!inputs && inputs.model === model;
  useEffect(() => {
    if (!inputsReady || !inputs || !model) return;
    // the out-of-date check waits for the refresh so the two don't compete for requests
    void refresh(false).then(async (done) => {
      const data = inputs.data;
      if (!done || !data || !data.contextsOk || checkedFor.current === inputs) return;
      checkedFor.current = inputs;
      const hash = await currentInputHash(owox, data, model.classes.map((c) => c.id)).catch(() => null);
      if (hash !== null && modelNow.current === model) setOutdated(hash !== model.inputHash);
    });
  }, [inputsReady, inputs, model, owox, refresh]);

  const openSettings = () => { ctx.ui?.setRoute?.('/settings'); setSettingsError(null); setView({ name: 'settings' }); };
  const leaveSettings = () => { ctx.ui?.setRoute?.('/'); setView({ name: 'ready' }); };
  const backToCanvas = model ? () => setView({ name: 'ready' }) : undefined;
  // Fire and forget: losing the remembered choice must not disturb the canvas.
  const remember = (r: RangeChoice, c: CompareChoice) => { void savePreferences(store, { range: r, compare: c }).catch(() => undefined); };
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
    case 'intro':
      return (
        <main className="gy-main">
          <h1>Gyroscope</h1>
          <p>Gyroscope reads your project description, finds the goal and draws the classes that drive it.</p>
          <button type="button" className="gy-btn gy-btn-primary" disabled={!generate} onClick={() => void build()}>Build model</button>
          {!generate && <p className="gy-muted">Ask a project admin to map an AI model</p>}
        </main>
      );
    case 'building':
      return <main className="gy-main"><p>Reading descriptions and schemas…</p></main>;
    case 'blocked':
      return <Blocked blocked={view.blocked} projectId={ctx.projectId} onRetry={() => void build()} onBack={backToCanvas} />;
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
          onBack={leaveSettings}
          onRebuild={() => { ctx.ui?.setRoute?.('/'); void build(); }}
          canRebuild={!!generate}
          error={settingsError}
          onSave={(s) => void saveSettingsAndLeave(s)}
        />
      );
    case 'ready': {
      if (!model) return null;
      const status = loading || refreshing ? (progress ? `Loading metrics ${progress.done} of ${progress.total}` : 'Reading Data Marts…') : null;
      const main = model.classes.find((c) => c.id === model.goal.classId) ?? model.classes[0];
      return (
        <main className="gy-main">
          <Header title={main?.title ?? 'Gyroscope'} cache={cache} now={now()} period={periodShown} status={status} />
          {saveNote && <p className="gy-muted">{saveNote}</p>}
          {outdated && (
            <div className="gy-banner">
              <span>Descriptions or schemas changed since this model was built.</span>
              <button type="button" className="gy-btn" onClick={() => void build()}>Rebuild model</button>
            </div>
          )}
          <Canvas
            tools={<RangeControls range={range} compare={compare} now={now()} weekStart={settings.weekStart} refreshing={refreshing} onChange={(r, c) => { setRange(r); setCompare(c); remember(r, c); }} onRefresh={() => void refresh(true)} onSettings={openSettings} />}
            model={model} cache={cache} visibleIds={visible} marts={marts}
            compareLabel={compareLabel(range, compare, now(), settings.weekStart) ?? undefined}
            progress={progress}
            comparisonOn={compare.kind !== 'off'} refreshing={refreshing || loading} onRetry={() => void refresh(true)}
          />
        </main>
      );
    }
  }
}
