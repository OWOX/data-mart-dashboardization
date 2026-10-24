import { useCallback, useEffect, useRef, useState } from 'react';
import type { PluginContext } from '@owox/plugin-sdk';
import type { Blocked as BlockedInfo, CacheDoc, Model, Preset, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';
import { rangeFor } from './lib/dates';
import { describeError } from './lib/errors';
import { buildModel, inputHash } from './model/build';
import { aiGenerate, type Generate } from './model/interpret';
import { fetchInputs, type OwoxLike } from './owox/sources';
import { cacheKey, refreshCanvas } from './metrics/refresh';
import {
  isStale, loadCache, loadModel, loadSettings, saveCache, saveModel, saveSettings, type CollectionsLike,
} from './store/collections';
import { Blocked } from './ui/Blocked';
import { Canvas } from './ui/Canvas';
import { Header } from './ui/Header';
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

export function App({ ctx, deps: injected }: { ctx: PluginContext; deps?: AppDeps }) {
  const [deps] = useState(() => injected ?? depsFrom(ctx));
  const { owox, store, generate, userId, now } = deps;

  const [view, setView] = useState<View>({ name: 'loading' });
  const [model, setModel] = useState<Model | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [preset, setPreset] = useState<Preset>(DEFAULT_SETTINGS.defaultPreset);
  const [comparisonOn, setComparisonOn] = useState(DEFAULT_SETTINGS.comparisonDefault);
  const [cache, setCache] = useState<CacheDoc | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const refreshId = useRef(0);
  // set when the cache must be recomputed even though the model hash and anchor match
  const forceNext = useRef(false);

  const load = useCallback(async () => {
    setView({ name: 'loading' });
    try {
      const [s, m] = await Promise.all([loadSettings(store), loadModel(store)]);
      setSettings(s);
      setPreset(s.defaultPreset);
      setComparisonOn(s.comparisonDefault);
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
    setView({ name: 'building' });
    try {
      const result = await buildModel({ owox, generate, userId, now: now() });
      if (!result.ok) { setView({ name: 'blocked', blocked: result.blocked }); return; }
      await saveModel(store, result.model);
      setModel(result.model);
      setCache(null);
      forceNext.current = true;
      setView({ name: 'ready' });
    } catch (e) {
      setView({ name: 'error', message: describeError(e), retry: 'build' });
    }
  }, [owox, generate, userId, now, store]);

  const refresh = useCallback(async (force: boolean) => {
    if (!model) return;
    const id = ++refreshId.current;
    const current = () => id === refreshId.current;
    const spec = rangeFor(preset, now());
    const key = cacheKey(preset, comparisonOn);
    try {
      const saved = await loadCache(store, key);
      if (!current()) return;
      setCache(saved);
      if (!force && !forceNext.current && !isStale(saved, model, spec.anchor)) { setRefreshing(false); return; }
      setRefreshing(true);
      const doc = await refreshCanvas({ owox, model, spec, comparisonOn, thresholdPct: settings.thresholdPct });
      if (!current()) return;
      await saveCache(store, key, doc);
      if (!current()) return;
      forceNext.current = false;
      setCache(doc);
    } catch {
      // cards keep their last cached values
    } finally {
      if (current()) setRefreshing(false);
    }
  }, [model, preset, comparisonOn, owox, store, now, settings.thresholdPct]);

  const inReady = view.name === 'ready';
  useEffect(() => {
    if (inReady) void refresh(false);
  }, [inReady, refresh]);

  useEffect(() => {
    if (!inReady || !model) { setOutdated(false); return; }
    let live = true;
    fetchInputs(owox)
      .then((inputs) => { if (live) setOutdated(inputHash(inputs) !== model.inputHash); })
      .catch(() => {});
    return () => { live = false; };
  }, [inReady, model, owox]);

  const openSettings = () => { ctx.ui?.setRoute?.('/settings'); setSettingsError(null); setView({ name: 'settings' }); };
  const leaveSettings = () => { ctx.ui?.setRoute?.('/'); setView({ name: 'ready' }); };
  const backToCanvas = model ? () => setView({ name: 'ready' }) : undefined;
  const saveSettingsAndLeave = async (s: Settings) => {
    try {
      await saveSettings(store, s);
    } catch (e) {
      setSettingsError(`Couldn't save settings: ${describeError(e)}`);
      return;
    }
    if (s.thresholdPct !== settings.thresholdPct) forceNext.current = true;
    if (s.defaultPreset !== settings.defaultPreset) setPreset(s.defaultPreset);
    if (s.comparisonDefault !== settings.comparisonDefault) setComparisonOn(s.comparisonDefault);
    setSettings(s);
    leaveSettings();
  };

  switch (view.name) {
    case 'loading':
      return <main className="gy-main"><p>Loading…</p></main>;
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
          error={settingsError}
          onSave={(s) => void saveSettingsAndLeave(s)}
        />
      );
    case 'ready': {
      if (!model) return null;
      const main = model.classes.find((c) => c.id === model.goal.classId) ?? model.classes[0];
      return (
        <main className="gy-main">
          <Header
            title={main?.title ?? 'Gyroscope'}
            preset={preset}
            comparisonOn={comparisonOn}
            cache={cache}
            now={now()}
            onPreset={setPreset}
            onComparison={setComparisonOn}
            onRefresh={() => void refresh(true)}
            onRebuild={() => void build()}
            onSettings={openSettings}
          />
          {outdated && (
            <div className="gy-banner">
              <span>Descriptions or schemas changed since this model was built.</span>
              <button type="button" className="gy-btn" onClick={() => void build()}>Rebuild model</button>
            </div>
          )}
          <Canvas model={model} cache={cache} comparisonOn={comparisonOn} refreshing={refreshing} onRetry={() => void refresh(true)} />
        </main>
      );
    }
  }
}
