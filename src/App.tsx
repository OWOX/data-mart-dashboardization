import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiCredentialHandle, PluginContext } from '@owox/plugin-sdk';
import type { Blocked as BlockedInfo, BuildResult, CacheDoc, CardCache, CompareChoice, CoreClass, Model, RangeChoice, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';
import { compareLabel, resolveRange } from './lib/dates';
import { describeError } from './lib/errors';
import { INDUSTRIES, applyCore, inboundCounts, mergeCore, rankCore } from './model/core';
import { fetchMember } from './owox/role';
import { conflictMessage } from './lib/conflict';
import { shownModel } from './model/shown';
import { checkHealth, type Issue } from './model/health';
import { buildModel, currentInputHash, type BuildStep } from './model/build';
import { aiGenerate, aiGenerateWith, type Generate, type GenerateWith } from './model/interpret';
import { fetchQuality, type QualitySummary } from './owox/quality';
import { fetchInputs, type Inputs, type MartDetail, type OwoxLike } from './owox/sources';
import { cacheKey, persistable, refreshCanvas } from './metrics/refresh';
import {
  isStale, loadCache, loadPreferences, loadProjectModel, loadProjectSettings, loadSettings, loadShared, ModelConflict, ModelUnreadable, saveCache, savePreferences, saveProjectSettings, saveShared, saveViewSettings, type CollectionsLike,
} from './store/collections';
import { Blocked } from './ui/Blocked';
import { BuildProgress } from './ui/BuildProgress';
import { Canvas } from './ui/Canvas';
import { createMarkdownHtml } from './lib/markdown';
import { metricName } from './model/metricName';
import { LoadingBar } from './ui/LoadingBar';
import { Header, RangeControls } from './ui/Header';
import { runCheckup } from './checkup/run';
import { applyTarget, type ApplyResult } from './checkup/apply';
import { aiSuggestion } from './checkup/suggestAi';
import type { SuggestContext } from './checkup/suggest';
import type { ApplyTarget, GroupId } from './checkup/types';
import { SettingsPage, type SettingsTab } from './ui/SettingsPage';

export interface AppDeps {
  owox: OwoxLike;
  store: CollectionsLike;
  generate: Generate | null;
  /** The AI handle for Checkup suggestions; null without a credential. */
  generateWith?: GenerateWith | null;
  userId: string;
  now: () => Date;
}

type View =
  | { name: 'loading' }
  | { name: 'building' }
  | { name: 'blocked'; blocked: BlockedInfo }
  | { name: 'error'; message: string; retry: 'load' | 'build' | 'reload' | 'none' }
  | { name: 'not_set_up' }
  | { name: 'ready' }
  | { name: 'settings'; tab: SettingsTab; section?: GroupId };

export function depsFrom(ctx: PluginContext): AppDeps {
  // the model is built once and saved, so the build reads the descriptions on the stronger tier;
  // installs published before 0.3.1 declare only fast, and the direct handle is that fast model
  const handle = ctx.credentials?.ai as AiCredentialHandle | undefined;
  const ai = handle?.reasoning ?? handle?.fast;
  return {
    owox: ctx.owox as unknown as OwoxLike,
    store: ctx as unknown as CollectionsLike,
    generate: ai ? aiGenerate(ai, ctx.signal) : null,
    generateWith: ai ? aiGenerateWith(ai, ctx.signal) : null,
    userId: ctx.userId,
    now: () => new Date(),
  };
}

/** The model a member sees before an admin has saved the shared one: the 0.3 project model, with core classes chosen from the settings or the ranking. */
function migrate(project: Model, settings: Settings): { model: Model; core: CoreClass[] } {
  const count = INDUSTRIES.find((i) => i.id === (settings.industry ?? 'other'))?.count ?? 3;
  const inbound = inboundCounts(project.edges);
  const core = settings.coreClasses
    ?? rankCore({ goalId: project.goal.classId, nodes: project.classes.map((c) => ({ id: c.id, title: c.title, singleKey: true })), edges: project.edges })
      .slice(0, count)
      .map((id): CoreClass => ({ martId: project.classes.find((c) => c.id === id)!.martId, why: '' }));
  return { model: applyCore(project, core, inbound), core };
}

const ROUTES: Record<SettingsTab, string> = { general: '/settings', checkup: '/settings/checkup' };
/** True when two models differ only in which classes are core, and who edited when. */
const sameBesideCore = (a: Model | null, b: Model): boolean => {
  if (!a) return false;
  const strip = (m: Model) => JSON.stringify({ ...m, editedAt: null, editedBy: null, classes: m.classes.map((c) => ({ ...c, core: false, inbound: 0 })) });
  return strip(a) === strip(b);
};
const ROUTES_METRICS = '/settings/ontology';
/** The settings tab (and Checkup section) a route opens; anything else opens the canvas. /settings/ontology is the 0.3 route of the Metrics tab. */
const tabOf = (route: string | undefined): { tab: SettingsTab; section?: GroupId } | null => {
  const path = route?.replace(/\/+$/, '');
  return path === ROUTES_METRICS ? { tab: 'checkup', section: 'metrics' } : path === ROUTES.checkup ? { tab: 'checkup' } : path === ROUTES.general ? { tab: 'general' } : null;
};

/** Data Marts a health check confirmed gone: class and metric Data Marts, and the sources of plans and forecasts. */
export const goneMartIds = (issues: Issue[]): Set<string> =>
  new Set(issues.flatMap((i) => (i.kind === 'mart_missing' ? [i.martId] : i.sourceMartId ? [i.sourceMartId] : [])));

/** No default preset means no range: the ontology view. */
const rangeOf = (s: Settings): RangeChoice | null => (s.defaultPreset ? { kind: 'preset', preset: s.defaultPreset } : null);
const compareOf = (s: Settings): CompareChoice => (s.comparisonDefault ? { kind: 'preset', preset: 'previous_period' } : { kind: 'off' });

/** The previous doc for the key with the new cards laid over it, metric by metric; a spark is replaced once its new one arrives. */
function mergePartial(base: CacheDoc | null, cards: Record<string, CardCache>, model: Model, anchor: string, thresholdPct: number, key: string, comparison: boolean): CacheDoc {
  const merged: Record<string, CardCache> = { ...base?.cards };
  for (const [id, c] of Object.entries(cards)) {
    const old = base?.cards[id];
    // the old spark stays until the key metric's new result lands; a secondary one until that metric's does
    const key = model.classes.find((x) => x.id === id)?.keyMetricId;
    const keyDone = !!key && key in c.metrics;
    const sparks = Object.fromEntries(Object.entries({ ...old?.sparks, ...c.sparks }).filter(([m]) => !(m in c.metrics) || !!c.sparks?.[m]));
    merged[id] = { metrics: { ...old?.metrics, ...c.metrics }, spark: keyDone ? c.spark : old?.spark ?? null, ...(Object.keys(sparks).length ? { sparks } : {}) };
  }
  return {
    modelHash: model.inputHash, builtAt: model.builtAt, editedAt: model.editedAt, thresholdPct, anchor,
    refreshedAt: base?.refreshedAt ?? new Date().toISOString(), key, comparison, cards: merged,
  };
}

export function App({ ctx, deps: injected }: { ctx: PluginContext; deps?: AppDeps }) {
  const [deps] = useState(() => injected ?? depsFrom(ctx));
  const { owox, store, generate, generateWith = null, userId, now } = deps;

  const [view, setView] = useState<View>({ name: 'loading' });
  // a reload lands on the settings tab the route names; read once, the first load only
  const startTab = useRef(tabOf(ctx.route));
  const [model, setModel] = useState<Model | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [range, setRange] = useState<RangeChoice | null>(() => rangeOf(DEFAULT_SETTINGS));
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
  // the model saved but its core classes didn't reach the project settings
  const [coreNote, setCoreNote] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // the editor's display name, stored as Model.editedBy
  const editor = useRef<string | null>(null);
  // the core classes of the last Rebuild candidate, saved with it on Apply
  const rebuildCore = useRef<CoreClass[] | null>(null);
  // what this member can see, fetched once per model; data is null when the fetch failed
  const [inputs, setInputs] = useState<{ model: Model; data: Inputs | null } | null>(null);
  // the health check of the model against the Data Marts; the schemas it read are kept for the Ontology Model page
  const [health, setHealth] = useState<{ model: Model; issues: Issue[]; details: Map<string, MartDetail> } | null>(null);
  const healthNow = useRef<typeof health>(null);
  healthNow.current = health;
  const refreshId = useRef(0);
  const fetchedFor = useRef<Model | null>(null);
  const inputsNow = useRef<typeof inputs>(null);
  const [quality, setQuality] = useState<{ model: Model; data: Map<string, QualitySummary> | null } | null>(null);
  const qualityFor = useRef<Model | null>(null);
  const checkedFor = useRef<object | null>(null);
  const modelNow = useRef<Model | null>(null);
  // written by load before it starts a build, which would otherwise read the settings of the previous render
  const settingsNow = useRef<Settings>(DEFAULT_SETTINGS);
  settingsNow.current = settings;
  modelNow.current = model;
  inputsNow.current = inputs;
  // the latest Checkup run's facts, which an AI suggestion reads; and the Metrics editor's Rebuild trigger
  const checkupCtx = useRef<SuggestContext | null>(null);
  const rebuildRef = useRef<(() => void) | null>(null);
  const runSeq = useRef(0);
  const cacheNow = useRef<CacheDoc | null>(null);
  cacheNow.current = cache;

  const load = useCallback(async () => {
    setView({ name: 'loading' });
    rebuildCore.current = null;
    setCoreNote(null);
    try {
      let [s, own, prefs, member] = await Promise.all([loadSettings(store), loadShared(store), loadPreferences(store).catch(() => null), fetchMember(owox)]);
      editor.current = member.name;
      setIsAdmin(member.isAdmin);
      let m = own;
      let coreNoteNow: string | null = null;
      if (!m) {
        // no shared model yet: the 0.3 project model carries over, with no AI call; only an admin writes it
        const project = await loadProjectModel(store);
        if (project) {
          const migrated = migrate(project, s);
          m = migrated.model;
          if (member.isAdmin) {
            m = { ...m, editedBy: member.name ?? userId, editedAt: now().toISOString() };
            let saved = true;
            try {
              await saveShared(store, null, m);
            } catch (e) {
              // another admin saved first: read theirs
              if (!(e instanceof ModelConflict)) throw e;
              m = await loadShared(store);
              saved = false;
            }
            // the chosen list goes to the settings too, so Checkup and a later Rebuild see the same core
            if (saved && !s.coreClasses) {
              try {
                await saveProjectSettings(store, { coreClasses: migrated.core });
                s = { ...s, ...(await loadProjectSettings(store)) };
              } catch (e) {
                coreNoteNow = `Couldn't save the core classes: ${describeError(e)}`;
              }
            }
          }
        }
      }
      // an admin brings a model whose core flags lag the settings list in step with it; flags only, so the edit history and caches stay
      if (m && own && member.isAdmin && s.coreClasses) {
        const inList = new Set(s.coreClasses.map((c) => c.martId));
        if (m.classes.some((c) => c.core !== inList.has(c.martId))) {
          try {
            const synced = applyCore(m, s.coreClasses, inboundCounts(m.edges));
            await saveShared(store, m, synced);
            m = synced;
          } catch (e) {
            // another admin saved first: read theirs; any other failure leaves the model as it is
            if (e instanceof ModelConflict) m = await loadShared(store);
          }
        }
      }
      settingsNow.current = s;
      setSettings(s);
      setCoreNote(coreNoteNow);
      // every open starts on the member's default range (none by default: the ontology view); only the comparison choice is remembered
      setRange(rangeOf(s));
      setCompare(prefs?.compare ?? compareOf(s));
      setModel(m);
      const tab = startTab.current;
      startTab.current = null;
      if (m) setView(tab ? { name: 'settings', ...tab } : { name: 'ready' });
      else if (tab?.tab === 'checkup') setView({ name: 'settings', ...tab });
      else if (member.isAdmin) void buildRef.current();
      else setView({ name: 'not_set_up' });
    } catch (e) {
      setView({ name: 'error', message: describeError(e), retry: e instanceof ModelUnreadable ? 'none' : 'load' });
    }
  }, [store, owox, userId, now]);

  const buildRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => { void load(); }, [load]);

  /** Stamps the editor, applies the core list and writes the shared doc; then the list to the project settings when it changed. Admin only. */
  const commit = useCallback(async (next: Model, core: CoreClass[] | null, stamp: boolean): Promise<void> => {
    const withCore = core ? applyCore(next, core, inboundCounts(next.edges)) : next;
    // a hash-only update (editedAt unchanged) isn't an edit, so the editor stays as it was
    const edited = stamp || next.editedAt !== modelNow.current?.editedAt;
    const saved: Model = { ...withCore, ...(edited ? { editedBy: editor.current ?? userId } : {}), ...(stamp ? { editedAt: now().toISOString() } : {}) };
    await saveShared(store, modelNow.current, saved);
    // the model is saved: hold it now, so a failure below never leaves a stale base behind
    // a core-only change keeps the Data Mart reads: the open Metrics editor stays, with its schemas
    const before = modelNow.current;
    if (sameBesideCore(before, saved) && fetchedFor.current === before && inputsNow.current?.model === before) {
      fetchedFor.current = saved;
      setInputs((i) => (i && i.model === before ? { ...i, model: saved } : i));
      setHealth((h) => (h && h.model === before ? { ...h, model: saved } : h));
    }
    modelNow.current = saved;
    setModel(saved);
    setCoreNote(null);
    if (core && JSON.stringify(core) !== JSON.stringify(settingsNow.current.coreClasses)) {
      try {
        await saveProjectSettings(store, { coreClasses: core });
        // keep the local copy in step with what is stored, industry included
        const stored = await loadProjectSettings(store);
        settingsNow.current = { ...settingsNow.current, ...stored };
        setSettings(settingsNow.current);
      } catch (e) {
        setCoreNote(`Couldn't save the core classes: ${describeError(e)}`);
      }
    }
  }, [store, userId, now]);

  const build = useCallback(async () => {
    refreshId.current++;
    setSteps([]);
    setRefreshing(false);
    setLoading(false);
    setView({ name: 'building' });
    setOutdated(null);
    try {
      const result = await buildModel({ owox, generate, userId, now: now(), existingCore: settingsNow.current.coreClasses, industry: settingsNow.current.industry, onStep: (s) => setSteps((p) => [...p, s]) });
      if (!result.ok) { setView({ name: 'blocked', blocked: result.blocked }); return; }
      await commit(result.model, result.core.classes, true);
      setCache(null);
      setView({ name: 'ready' });
    } catch (e) {
      setView(e instanceof ModelConflict ? { name: 'error', message: conflictMessage(e), retry: 'reload' } : { name: 'error', message: describeError(e), retry: e instanceof ModelUnreadable ? 'none' : 'build' });
    }
  }, [owox, generate, userId, now, store, commit]);

  buildRef.current = build;

  const visible = useMemo<ReadonlySet<string> | null>(
    // a failed access check shows nothing rather than everything
    () => (inputs && inputs.model === model ? new Set(inputs.data?.marts.map((m) => m.id) ?? []) : null),
    [inputs, model],
  );

  const periodShown = useMemo(() => {
    if (!range) return undefined;
    const spec = resolveRange(range, compare, now(), settings.weekStart);
    // with a comparison, show the windows actually compared: the days so far (cut when it is shorter), not the whole range;
    // a projected range is compared whole, so it shows whole
    const fact = spec.forecastWindow ? spec.range : spec.compareFact ?? spec.factWindow;
    return spec.comparison && fact ? { range: fact, comparison: spec.comparison } : { range: spec.range, comparison: null };
  }, [range, compare, now, settings.weekStart]);

  const marts = useMemo(
    () => new Map((inputs?.data?.marts ?? []).map((m) => [m.id, { title: m.title, description: m.description, icon: m.icon ?? null }])),
    [inputs],
  );

  const issuesNow = useMemo<Issue[]>(() => (health && health.model === model ? health.issues : []), [health, model]);
  const markdown = useMemo(() => createMarkdownHtml(owox.markdown ? (r) => owox.markdown!.parseToHtml(r) : undefined), [owox]);
  const detailsNow = useMemo(() => (health && health.model === model ? health.details : undefined), [health, model]);
  const goneMarts = useMemo(() => goneMartIds(issuesNow), [issuesNow]);
  const missingIds = useMemo(() => new Set(issuesNow.filter((i) => i.kind === 'mart_missing' && i.metricId === null).map((i) => i.classId)), [issuesNow]);

  const refresh = useCallback(async (force: boolean): Promise<boolean> => {
    if (!model || !range) return false;
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
        owox, model, spec, key, thresholdPct: settings.thresholdPct, visibleIds: visible, issues: issuesNow, details: detailsNow,
        onProgress: (done, total) => { if (current()) setProgress({ done, total }); },
        onPartial: (cards) => { if (current()) setCache(mergePartial(shown, cards, shownModel(model, detailsNow), spec.anchor, settings.thresholdPct, key, spec.comparison !== null)); },
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
  }, [model, range, compare, owox, store, now, settings.thresholdPct, settings.weekStart, visible, issuesNow, detailsNow]);

  const inReady = view.name === 'ready';
  // the Ontology Model page needs the Data Mart list and schemas too, and a reload can land on it
  const inSettings = view.name === 'settings';
  useEffect(() => {
    if ((!inReady && !inSettings) || !model || fetchedFor.current === model) return;
    fetchedFor.current = model;
    // without a cached doc the line shows from the first screen, not empty cards
    const probe = refreshId.current;
    // with no range nothing is read from the cache and no loading line shows
    if (range) {
      const probeKey = cacheKey(range, compare, settings.weekStart);
      void (persistable(range, compare) ? loadCache(store, probeKey).catch(() => null) : Promise.resolve(null)).then((saved) => {
        if (!saved && refreshId.current === probe) setLoading(true);
      });
    }
    fetchInputs(owox).catch(() => null).then(async (data) => {
      // the check lands before the inputs, so the first refresh already knows what is broken
      const checked = data ? await checkHealth(owox, model, new Set(data.marts.map((m) => m.id))).catch(() => null) : null;
      // a newer model took over while this read was in flight
      if (fetchedFor.current !== model) return;
      if (checked) setHealth({ model, ...checked });
      setInputs({ model, data });
    });
  }, [inReady, inSettings, model, owox]);

  // data-quality icons: one call per canvas load, never cached; a failure leaves the cards without them
  useEffect(() => {
    if (!inReady || !model || !range || qualityFor.current === model) return;
    qualityFor.current = model;
    void fetchQuality(owox, [...new Set(model.classes.map((c) => c.martId))]).then((data) => { if (qualityFor.current === model) setQuality({ model, data }); });
  }, [inReady, model, range, owox]);

  const inputsReady = inReady && !!inputs && inputs.model === model;
  useEffect(() => {
    if (!inputsReady || !inputs || !model) return;
    const checkOutdated = async () => {
      const data = inputs.data;
      if (!data || !data.contextsOk || checkedFor.current === inputs) return;
      checkedFor.current = inputs;
      const hash = await currentInputHash(owox, data, model.classes.map((c) => c.id), healthNow.current?.model === model ? healthNow.current.details : undefined).catch(() => null);
      // null: can't be told (a model Data Mart isn't in this member's list), so nothing is proposed
      if (hash !== null && modelNow.current === model) setOutdated(hash !== model.inputHash ? hash : null);
    };
    // with no range there is no refresh to wait for; the check reads schemas, not metrics
    if (!range) { void checkOutdated(); return; }
    // the out-of-date check waits for the refresh so the two don't compete for requests
    void refresh(false).then((done) => { if (done) void checkOutdated(); });
  }, [inputsReady, inputs, model, owox, refresh, range]);

  const openSettings = (tab: SettingsTab = 'general', section?: GroupId) => { ctx.ui?.setRoute?.(section === 'metrics' ? ROUTES_METRICS : ROUTES[tab]); setSettingsError(null); setView({ name: 'settings', tab, section }); };
  const leaveSettings = () => {
    ctx.ui?.setRoute?.('/');
    // without a model there is no canvas to go back to; only an admin builds one
    if (modelNow.current) setView({ name: 'ready' }); else if (isAdmin) void build(); else setView({ name: 'not_set_up' });
  };
  const backToCanvas = model ? () => setView({ name: 'ready' }) : undefined;
  // Fire and forget: losing the remembered choice must not disturb the canvas. The doc keeps its 0.4 shape; its range is always null.
  const remember = (c: CompareChoice) => { void savePreferences(store, { range: null, compare: c }).catch(() => undefined); };
  const changeRange = (r: RangeChoice | null, c: CompareChoice) => {
    // Clear keeps the compare choice so it comes back
    const next = c;
    if (r === null) { refreshId.current++; setRefreshing(false); setLoading(false); setProgress(null); }
    setRange(r); setCompare(next); remember(next);
  };
  const saveOntologyAndLeave = async (m: Model) => {
    // a rebuild's core classes join the stored ones with the Apply
    const picks = rebuildCore.current;
    const count = INDUSTRIES.find((i) => i.id === (settings.industry ?? 'other'))?.count ?? 3;
    // commit sets the new model object, which re-runs the refresh; the cache is judged by editedAt
    await commit(m, picks ? mergeCore(settings.coreClasses, picks, [], count) : null, false);
    rebuildCore.current = null;
    leaveSettings();
  };
  const ontologyDetails = useMemo(() => (health && health.model === model ? health.details : new Map<string, MartDetail>()), [health, model]);
  // null: the access check failed, so the editor verifies nothing
  const ontologyMarts = useMemo(() => (inputs && inputs.model === model && inputs.data ? inputs.data.marts.map((x) => ({ id: x.id, title: x.title, description: x.description })) : null), [inputs, model]);
  // the out-of-date check's hash for a model's classes; null when it can't be told (no contexts, or a transient failure)
  const hashOf = async (m: Model): Promise<string | null> => {
    const data = inputs && inputs.model === model ? inputs.data : null;
    if (!data || !data.contextsOk) return null;
    return currentInputHash(owox, data, m.classes.map((c) => c.id), ontologyDetails).catch(() => null);
  };
  const ontologyProps = model && inputs && inputs.model === model
    ? { model, owox, now, onSave: saveOntologyAndLeave, details: ontologyDetails, marts: ontologyMarts, hashOf, gone: goneMarts }
    : null;
  const saveSettingsAndLeave = async (s: Settings) => {
    try {
      const { thresholdPct, industry: _i, coreClasses: _c, ...view } = s;
      await saveViewSettings(store, view);
      if (isAdmin && thresholdPct !== settings.thresholdPct) await saveProjectSettings(store, { thresholdPct });
    } catch (e) {
      setSettingsError(`Couldn't save settings: ${describeError(e)}`);
      return;
    }
    const nextRange = s.defaultPreset !== settings.defaultPreset ? rangeOf(s) : range;
    const nextCompare = s.comparisonDefault !== settings.comparisonDefault ? compareOf(s) : compare;
    if (nextRange !== range || nextCompare !== compare) { setRange(nextRange); setCompare(nextCompare); remember(nextCompare); }
    setSettings(s);
    leaveSettings();
  };

  /** One Checkup answer. A core list also moves the core flags of the shared model, so the canvas shows the new set; an admin's write. */
  const applyAnswer = async (t: ApplyTarget): Promise<ApplyResult> => {
    if (!isAdmin) return { ok: false, refused: false, error: 'Only a project admin can change this' };
    if (t.kind === 'model' && t.action === 'rebuild' && !rebuildRef.current) {
      return { ok: false, refused: false, error: !ontologyProps ? 'The Metrics editor is still loading. Try again in a moment.' : generate ? 'Save or discard your Metrics edits first' : 'Map an AI credential to rebuild' };
    }
    // a core list goes to the shared model first: on a conflict nothing is written, so settings and model never disagree
    const base = modelNow.current;
    if (t.kind === 'settings' && t.patch.coreClasses && base) {
      try {
        await commit(base, t.patch.coreClasses, true);
      } catch (e) {
        return { ok: false, refused: false, error: e instanceof ModelConflict ? conflictMessage(e) : `Couldn't update the model: ${describeError(e)}` };
      }
    }
    const { thresholdPct, industry, coreClasses } = settingsNow.current;
    const r = await applyTarget(t, {
      owox, store, settings: { thresholdPct, industry, coreClasses },
      onModel: (action) => {
        if (action === 'build') void build();
        else { document.getElementById('gy-ck-sec-metrics')?.scrollIntoView?.({ block: 'start' }); rebuildRef.current?.(); }
      },
    });
    if (!r.ok || t.kind !== 'settings') return r;
    try {
      const stored = await loadProjectSettings(store);
      settingsNow.current = { ...settingsNow.current, ...stored };
      setSettings(settingsNow.current);
    } catch (e) {
      return { ok: false, refused: false, error: `Saved, but the settings weren't re-read: ${describeError(e)}` };
    }
    return r;
  };

  switch (view.name) {
    case 'loading':
      return <main className="gy-main"><LoadingBar /><p className="gy-muted gy-loadnote">Loading settings and model…</p></main>;
    case 'building':
      return <BuildProgress steps={steps} />;
    case 'blocked':
      return <Blocked blocked={view.blocked} projectId={ctx.projectId} onRetry={() => void build()} onCheckup={() => openSettings('checkup')} onBack={backToCanvas} onOpen={ctx.ui?.navigate ? (path) => ctx.ui.navigate(path) : undefined} />;
    case 'not_set_up':
      return (
        <main className="gy-main">
          <h1>An admin hasn&apos;t set up Gyroscope yet</h1>
          <p>Ask a project admin to open Gyroscope and build the model. Meanwhile you can run a checkup.</p>
          <button type="button" className="gy-btn gy-btn-primary" onClick={() => openSettings('checkup')}>Run checkup</button>
        </main>
      );
    case 'error':
      return (
        <main className="gy-main">
          <h1>Something went wrong</h1>
          <p>{view.message}</p>
          {view.retry !== 'none' && <button type="button" className="gy-btn gy-btn-primary" onClick={() => void (view.retry === 'build' ? build() : load())}>{view.retry === 'reload' ? 'Reload' : 'Retry'}</button>}
          {backToCanvas && <>{' '}<button type="button" className="gy-btn" onClick={backToCanvas}>Back to canvas</button></>}
        </main>
      );
    case 'settings':
      return (
        <SettingsPage
          settings={settings}
          tab={view.tab}
          openSection={view.section}
          rebuildRef={rebuildRef}
          onTabChange={(t) => ctx.ui?.setRoute?.(ROUTES[t])}
          ontology={ontologyProps}
          noModel={!model}
          checkup={{
            // read at call time: an Apply reruns the checkup before this render lands
            run: (onUpdate) => {
              const { thresholdPct, industry, coreClasses } = settingsNow.current;
              const seq = ++runSeq.current;
              return runCheckup({ owox, hasAi: !!generate, settings: { thresholdPct, industry, coreClasses }, model: modelNow.current, projectId: ctx.projectId, onUpdate, onContext: (c) => { if (seq === runSeq.current) checkupCtx.current = c; } });
            },
            projectId: ctx.projectId, now, apply: isAdmin ? applyAnswer : undefined,
            suggestAi: isAdmin && generateWith
              ? async (id) => (checkupCtx.current ? aiSuggestion(id, checkupCtx.current, generateWith) : null)
              : undefined,
          }}
          onBack={leaveSettings}
          onRebuild={async (onStep) => {
            const r: BuildResult = await buildModel({ owox, generate, userId, now: now(), existingCore: settings.coreClasses, industry: settings.industry, onStep });
            rebuildCore.current = r.ok ? r.core.classes : null;
            return r;
          }}
          isAdmin={isAdmin}
          onReload={() => void load()}
          projectId={ctx.projectId}
          onDismiss={() => { rebuildCore.current = null; setDismissedHash(outdated); }}
          onOpen={ctx.ui?.navigate ? (path) => ctx.ui.navigate(path) : undefined}
          canRebuild={isAdmin && !!generate}
          error={settingsError}
          onSave={(s) => void saveSettingsAndLeave(s)}
        />
      );
    case 'ready': {
      if (!model) return null;
      const status = range && (loading || refreshing) ? (progress ? `Loading metrics ${progress.done} of ${progress.total}` : inputsReady ? 'Loading metrics…' : 'Reading Data Marts…') : null;
      const showOutdated = isAdmin && outdated !== null && outdated !== model.inputHash && outdated !== dismissedHash;
      const notices = issuesNow.length > 0 || showOutdated ? {
        issues: issuesNow.map((i) => ({
          classTitle: model.classes.find((c) => c.id === i.classId)?.title ?? i.classId,
          metricName: i.metricId ? (() => { const m = model.metrics.find((x) => x.id === i.metricId); return m ? metricName(m, detailsNow?.get(m.martId)) : null; })() : null,
          text: i.text,
        })),
        outdated: showOutdated,
        onReview: () => openSettings('checkup', 'metrics'),
      } : undefined;
      return (
        <main className="gy-main">
          <Header cache={cache} now={now()} period={periodShown} status={status} notices={notices} noRange={!range} />
          {saveNote && <p className="gy-muted">{saveNote}</p>}
          {coreNote && <p className="gy-muted">{coreNote}</p>}
          {inputs && inputs.model === model && !inputs.data && <p className="gy-muted" role="alert">Couldn't check which Data Marts you can access. Reopen Gyroscope to try again.</p>}
          <Canvas
            mode={range ? 'flow' : 'ontology'}
            tools={<RangeControls range={range} compare={range === null && compare.kind === 'off' ? compareOf(settings) : compare} now={now()} weekStart={settings.weekStart} refreshing={refreshing} onChange={changeRange} onRefresh={() => void refresh(true)} onSettings={() => openSettings()} />}
            model={model} cache={cache} visibleIds={visible} details={detailsNow} missingIds={missingIds} marts={marts}
            compareLabel={range ? compareLabel(range, compare, now(), settings.weekStart) ?? undefined : undefined}
            progress={progress}
            quality={quality?.model === model ? quality.data : null}
            projectId={ctx.projectId}
            markdown={markdown}
            weekStart={settings.weekStart}
            onOpen={ctx.ui?.navigate ? (path) => ctx.ui.navigate(path) : undefined}
            comparisonOn={!!range && compare.kind !== 'off'} refreshing={refreshing || loading} onRetry={() => void refresh(true)}
          />
        </main>
      );
    }
  }
}
