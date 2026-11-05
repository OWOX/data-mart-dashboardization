import { describe, expect, it } from 'vitest';
import { metricName } from './metricName';
import type { MetricDef } from '../types';
import type { MartDetail } from '../owox/sources';

const metric = (over: Partial<MetricDef> = {}): MetricDef => ({
  id: 'm:arr:SUM', martId: 'm', alias: 'Stored', measure: { field: 'arr', fn: 'SUM' }, kind: 'flow', dateField: null, role: 'other',
  source: 'project', isUniqueCount: false, calculated: false, format: 'number', currency: null, plan: null, shown: true, forecast: null, ...over,
} as MetricDef);
const detail = (alias?: string): MartDetail => ({ id: 'm', title: 'Mart', fields: [{ name: 'arr', type: 'INTEGER', isPrimaryKey: false, ...(alias !== undefined ? { alias } : {}) }] });

describe('metricName', () => {
  it('uses the live field alias', () => expect(metricName(metric(), detail('ARR'))).toBe('ARR'));
  it('uses the field name without an alias', () => { expect(metricName(metric(), detail())).toBe('arr'); expect(metricName(metric(), detail('  '))).toBe('arr'); });
  it('falls back to the stored alias with no schema or no such field', () => {
    expect(metricName(metric(), undefined)).toBe('Stored');
    expect(metricName(metric({ measure: { field: 'gone', fn: 'SUM' } }), detail('ARR'))).toBe('Stored');
  });
  it('keeps the unique count label', () => expect(metricName(metric({ isUniqueCount: true, alias: 'Customers' }), detail('ARR'))).toBe('Customers'));
});
