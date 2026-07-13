import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataTable } from './DataTable';
import type { Component, QueryResult } from '../lib/types';

const component: Component = {
  id: 't', type: 'table', title: 'Orders', width: 3, height: 2,
  config: { columns: ['Source', 'Cost'], limit: 100 },
};

describe('DataTable', () => {
  it('renders the columns and rows the server returned, verbatim', () => {
    const data: QueryResult = {
      columns: ['Source', 'Cost'],
      rows: [['Google', 100], ['Facebook', 50]],
      truncated: false,
      totals: null,
    };
    render(<DataTable component={component} data={data} />);
    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText('Cost')).toBeInTheDocument();
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('Facebook')).toBeInTheDocument();
  });

  it('preserves server row order — never re-sorts, re-ranks, or slices rows itself', () => {
    // If a client-side sort/rank were applied, "Zebra" (higher cost) would move above "Apple" —
    // it must not. The server is the only thing allowed to order these rows.
    const data: QueryResult = {
      columns: ['Source', 'Cost'],
      rows: [['Apple', 1], ['Zebra', 999]],
      truncated: false,
      totals: null,
    };
    const { container } = render(<DataTable component={component} data={data} />);
    const cells = Array.from(container.querySelectorAll('tbody tr td:first-child')).map(td => td.textContent);
    expect(cells).toEqual(['Apple', 'Zebra']);
  });

  it('surfaces truncated rather than silently showing a partial result as complete', () => {
    const data: QueryResult = {
      columns: ['Source'], rows: [['Google']], truncated: true, totals: null,
    };
    render(<DataTable component={component} data={data} />);
    expect(screen.getByText(/truncated/i)).toBeInTheDocument();
  });

  it('does not show a truncation note when the result is complete', () => {
    const data: QueryResult = { columns: ['Source'], rows: [['Google']], truncated: false, totals: null };
    render(<DataTable component={component} data={data} />);
    expect(screen.queryByText(/truncated/i)).not.toBeInTheDocument();
  });

  it('renders an empty-state message for zero rows rather than a blank table', () => {
    const data: QueryResult = { columns: ['Source', 'Cost'], rows: [], truncated: false, totals: null };
    render(<DataTable component={component} data={data} />);
    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText(/no rows/i)).toBeInTheDocument();
  });

  it('handles a single-column table', () => {
    const oneCol: Component = { ...component, config: { columns: ['Source'], limit: 10 } };
    const data: QueryResult = { columns: ['Source'], rows: [['Google'], ['Bing']], truncated: false, totals: null };
    render(<DataTable component={oneCol} data={data} />);
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText('Bing')).toBeInTheDocument();
  });

  it('handles a wide table without throwing', () => {
    const columns = Array.from({ length: 20 }, (_, i) => `Col${i}`);
    const wide: Component = { ...component, config: { columns, limit: 10 } };
    const data: QueryResult = {
      columns, rows: [columns.map((_, i) => i)], truncated: false, totals: null,
    };
    expect(() => render(<DataTable component={wide} data={data} />)).not.toThrow();
    expect(screen.getByText('Col19')).toBeInTheDocument();
  });

  it('renders null/NaN/string cell values as presentation strings rather than throwing', () => {
    const data: QueryResult = {
      columns: ['Source', 'Cost', 'Active'],
      rows: [['Google', null, true], [undefined as unknown as string, NaN, false]],
      truncated: false,
      totals: null,
    };
    expect(() => render(<DataTable component={component} data={data} />)).not.toThrow();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText('true')).toBeInTheDocument();
    expect(screen.getByText('false')).toBeInTheDocument();
  });

  it('renders a placeholder before the first load', () => {
    render(<DataTable component={component} data={null} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });
});
