import { describe, it, expect } from 'vitest';
import {
  addComponent, removeComponent, duplicateComponent, moveComponent, resizeComponent,
  retypeComponent, updateComponent, restoreGenerated,
} from './edit';
import { emptyDashboard } from './types';
import type { BarConfig, Component, ComponentType, Dashboard, MartField, PieConfig, ScorecardConfig, TableConfig, TimeSeriesConfig } from './types';

const base = (): Dashboard => ({
  ...emptyDashboard('d1', 'm1', 'D'),
  components: [
    { id: 'a', type: 'scorecard', title: 'A', width: 1, height: 1, config: { metric: 'x', aggregation: 'SUM' } },
    { id: 'b', type: 'bar', title: 'B', width: 3, height: 2, config: { dimension: 'd', metric: 'x', aggregation: 'SUM', orientation: 'vertical', limit: 10 } },
  ],
});

const ALL_TYPES: ComponentType[] = ['scorecard', 'timeseries', 'bar', 'pie', 'donut', 'table'];

describe('edit', () => {
  // ---- Brief's verbatim tests (Step 1) ----

  it('every transform bumps configVersion so all components refetch', () => {
    expect(removeComponent(base(), 'a').configVersion).toBe(1);
  });

  it('removeComponent drops only the target', () => {
    expect(removeComponent(base(), 'a').components.map(c => c.id)).toEqual(['b']);
  });

  it('duplicateComponent inserts a copy with a fresh id right after the source', () => {
    const d = duplicateComponent(base(), 'a');
    expect(d.components).toHaveLength(3);
    expect(d.components[1].id).not.toBe('a');
    expect(d.components[1].type).toBe('scorecard');
  });

  it('moveComponent reorders within bounds and is a no-op at the edge', () => {
    expect(moveComponent(base(), 'b', -1).components.map(c => c.id)).toEqual(['b', 'a']);
    expect(moveComponent(base(), 'a', -1).components.map(c => c.id)).toEqual(['a', 'b']);
  });

  it('resizeComponent clamps width to the grid and height to at least 1', () => {
    const d = resizeComponent(base(), 'a', 99, 0);
    expect(d.components[0].width).toBe(5);   // gridColumns
    expect(d.components[0].height).toBe(1);
  });

  it('addComponent appends a component of the requested type', () => {
    const d = addComponent(base(), 'table');
    expect(d.components[d.components.length - 1].type).toBe('table');
  });

  it('does not mutate the input document', () => {
    const d = base();
    removeComponent(d, 'a');
    expect(d.components).toHaveLength(2);
  });

  // ---- Adversarial: removing the last component ----

  it('removeComponent can remove the last remaining component, leaving an empty grid', () => {
    const d: Dashboard = { ...base(), components: [base().components[0]] };
    const next = removeComponent(d, 'a');
    expect(next.components).toEqual([]);
  });

  it('removeComponent on an unknown id is a safe no-op', () => {
    const d = base();
    const next = removeComponent(d, 'nope');
    expect(next.components).toHaveLength(2);
  });

  // ---- Adversarial: duplicate ids must be unique ----

  it('duplicateComponent never reuses the source id, even across repeated duplication', () => {
    let d = base();
    d = duplicateComponent(d, 'a');
    d = duplicateComponent(d, 'a');
    const ids = d.components.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('duplicateComponent deep-copies the config so mutating the copy never touches the source', () => {
    const d = duplicateComponent(base(), 'a');
    (d.components[1].config as ScorecardConfig).metric = 'changed';
    expect((d.components[0].config as ScorecardConfig).metric).toBe('x');
  });

  // ---- Adversarial: move/resize out-of-bounds ----

  it('moveComponent(+1) at the last position is a no-op', () => {
    const d = moveComponent(base(), 'b', 1);
    expect(d.components.map(c => c.id)).toEqual(['a', 'b']);
  });

  it('resizeComponent clamps a non-positive or fractional width/height into range', () => {
    const d = resizeComponent(base(), 'b', -3, 2.9);
    expect(d.components[1].width).toBe(1);
    expect(d.components[1].height).toBe(2);
  });

  it('resizeComponent falls back to the minimum (1) rather than propagating NaN from a cleared input', () => {
    const d = resizeComponent(base(), 'a', Number(''), Number(''));
    expect(d.components[0].width).toBe(1);
    expect(d.components[0].height).toBe(1);
  });

  it('resizeComponent on an unknown id is a safe no-op', () => {
    const d = resizeComponent(base(), 'nope', 2, 2);
    expect(d).toEqual(base());
  });

  // ---- CRITICAL: configVersion boundary — cosmetic edits must NOT bump, query edits MUST ----

  it('moveComponent (position) does NOT bump configVersion', () => {
    expect(moveComponent(base(), 'b', -1).configVersion).toBe(0);
  });

  it('resizeComponent (size) does NOT bump configVersion', () => {
    expect(resizeComponent(base(), 'a', 2, 2).configVersion).toBe(0);
  });

  it('updateComponent with only a title/description patch does NOT bump configVersion', () => {
    const d = updateComponent(base(), 'a', { title: 'New title', description: 'desc' });
    expect(d.configVersion).toBe(0);
    expect(d.components[0].title).toBe('New title');
  });

  it('updateComponent with only a width/height patch does NOT bump configVersion', () => {
    const d = updateComponent(base(), 'a', { width: 2, height: 2 });
    expect(d.configVersion).toBe(0);
  });

  it('updateComponent with a config patch (e.g. changing aggregation) DOES bump configVersion', () => {
    const d = updateComponent(base(), 'a', { config: { metric: 'x', aggregation: 'AVG' } });
    expect(d.configVersion).toBe(1);
    expect((d.components[0].config as ScorecardConfig).aggregation).toBe('AVG');
  });

  it('updateComponent with an identical config patch does NOT bump configVersion', () => {
    const d = updateComponent(base(), 'a', { config: { metric: 'x', aggregation: 'SUM' } });
    expect(d.configVersion).toBe(0);
  });

  it('updateComponent with a type patch DOES bump configVersion', () => {
    const d = updateComponent(base(), 'a', { type: 'table', config: { columns: ['x'], limit: 10 } });
    expect(d.configVersion).toBe(1);
  });

  it('addComponent, duplicateComponent, retypeComponent and restoreGenerated all bump configVersion', () => {
    expect(addComponent(base(), 'table').configVersion).toBe(1);
    expect(duplicateComponent(base(), 'a').configVersion).toBe(1);
    expect(retypeComponent(base(), 'a', 'pie').configVersion).toBe(1);
    expect(restoreGenerated(base(), [], {}).configVersion).toBe(1);
  });

  it('retypeComponent to the SAME type is a no-op and does not bump', () => {
    const d = retypeComponent(base(), 'a', 'scorecard');
    expect(d.configVersion).toBe(0);
  });

  // ---- CRITICAL: retype must produce a valid config for every target type ----

  function assertValidConfig(type: ComponentType, c: Component) {
    expect(c.type).toBe(type);
    switch (type) {
      case 'scorecard': {
        const cfg = c.config as ScorecardConfig;
        expect(typeof cfg.metric).toBe('string');
        expect(typeof cfg.aggregation).toBe('string');
        break;
      }
      case 'timeseries': {
        const cfg = c.config as TimeSeriesConfig;
        expect(typeof cfg.dateField).toBe('string');
        expect(typeof cfg.metric).toBe('string');
        expect(typeof cfg.aggregation).toBe('string');
        expect(['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR']).toContain(cfg.unit);
        break;
      }
      case 'bar': {
        const cfg = c.config as BarConfig;
        expect(typeof cfg.dimension).toBe('string');
        expect(typeof cfg.metric).toBe('string');
        expect(typeof cfg.aggregation).toBe('string');
        expect(['vertical', 'horizontal']).toContain(cfg.orientation);
        expect(cfg.limit).toBeGreaterThan(0);
        break;
      }
      case 'pie':
      case 'donut': {
        const cfg = c.config as PieConfig;
        expect(typeof cfg.dimension).toBe('string');
        expect(typeof cfg.metric).toBe('string');
        expect(typeof cfg.aggregation).toBe('string');
        expect(cfg.maxCategories).toBeGreaterThan(0);
        break;
      }
      case 'table': {
        const cfg = c.config as TableConfig;
        expect(Array.isArray(cfg.columns)).toBe(true);
        expect(cfg.columns.length).toBeGreaterThan(0);
        expect(cfg.limit).toBeGreaterThan(0);
        break;
      }
    }
  }

  it('retypes between every pair of types and always produces a structurally valid config', () => {
    for (const from of ALL_TYPES) {
      for (const to of ALL_TYPES) {
        const d = addComponent(base(), from);
        const id = d.components[d.components.length - 1].id;
        const next = retypeComponent(d, id, to);
        const comp = next.components.find(c => c.id === id)!;
        assertValidConfig(to, comp);
      }
    }
  });

  it('retype preserves the aggregation when both source and target aggregate (e.g. scorecard -> pie)', () => {
    const d = updateComponent(base(), 'a', { config: { metric: 'x', aggregation: 'AVG' } });
    const next = retypeComponent(d, 'a', 'pie');
    expect((next.components[0].config as PieConfig).aggregation).toBe('AVG');
  });

  it('retype scorecard -> bar carries the metric across and picks a dimension from elsewhere on the dashboard', () => {
    const next = retypeComponent(base(), 'a', 'bar');
    const cfg = next.components[0].config as BarConfig;
    expect(cfg.metric).toBe('x');
    expect(cfg.dimension).toBe('d'); // borrowed from component 'b', the only dimension on the dashboard
  });

  it('retype bar -> table carries dimension+metric into columns', () => {
    const next = retypeComponent(base(), 'b', 'table');
    const cfg = next.components[1].config as TableConfig;
    expect(cfg.columns).toEqual(expect.arrayContaining(['d', 'x']));
  });

  // ---- addComponent: sane per-type size defaults, clamped to the grid ----

  it('addComponent picks sane default sizes per type', () => {
    expect(addComponent(base(), 'scorecard').components.at(-1)).toMatchObject({ width: 1, height: 1 });
    expect(addComponent(base(), 'bar').components.at(-1)).toMatchObject({ width: 3, height: 2 });
    expect(addComponent(base(), 'pie').components.at(-1)).toMatchObject({ width: 2, height: 2 });
    expect(addComponent(base(), 'timeseries').components.at(-1)).toMatchObject({ width: 5, height: 2 });
    expect(addComponent(base(), 'table').components.at(-1)).toMatchObject({ width: 5, height: 3 });
  });

  it('addComponent clamps the default width to a narrower grid', () => {
    const d = { ...base(), gridColumns: 2 };
    const next = addComponent(d, 'table');
    expect(next.components.at(-1)!.width).toBe(2);
  });

  it('addComponent produces a fresh, unique id', () => {
    const d = addComponent(base(), 'scorecard');
    const ids = d.components.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // ---- restoreGenerated ----

  const fields: MartField[] = [
    { name: 'Date', type: 'DATE', role: 'dimension', allowedAggregations: ['MIN', 'MAX'] },
    { name: 'Cost', type: 'FLOAT', role: 'metric', allowedAggregations: ['SUM', 'AVG'] },
    { name: 'Source', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT'] },
  ];

  it('restoreGenerated re-runs generate for the same mart but keeps id/name/$entity', () => {
    const d = base();
    const next = restoreGenerated(d, fields, { Source: 4 });
    expect(next.id).toBe(d.id);
    expect(next.name).toBe(d.name);
    expect(next.$entity).toEqual(d.$entity);
    expect(next.components.length).toBeGreaterThan(0);
  });

  // ---- updateComponent on an unknown id ----

  it('updateComponent on an unknown id is a safe no-op', () => {
    const d = base();
    expect(updateComponent(d, 'nope', { title: 'x' })).toEqual(d);
  });
});
