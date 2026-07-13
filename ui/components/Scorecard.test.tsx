import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Scorecard } from './Scorecard';
import type { Component, QueryResult } from '../lib/types';

const component: Component = {
  id: 'c', type: 'scorecard', title: 'Cost', width: 1, height: 1,
  config: { metric: 'Cost', aggregation: 'SUM' },
};

describe('Scorecard', () => {
  it('reads the value from server-computed totals, not from rows', () => {
    const data: QueryResult = {
      columns: ['Cost | SUM'], rows: [[999]],   // rows are a red herring
      truncated: false, totals: { 'Cost | SUM': 1234567.89 },
    };
    render(<Scorecard component={component} data={data} />);
    expect(screen.getByText('1,234,567.89')).toBeInTheDocument();
  });

  it('renders a placeholder when totals are unavailable', () => {
    render(<Scorecard component={component} data={{ columns: [], rows: [], truncated: false, totals: null }} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders a placeholder before the first load', () => {
    render(<Scorecard component={component} data={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders a placeholder when the aggLabel key is missing from totals (never a hand-rolled key)', () => {
    // totals has a DIFFERENT key than aggLabel('Cost', 'SUM') would produce — simulates a mismatch
    // between what the server actually aliased and what a naive lookup might guess.
    const data: QueryResult = {
      columns: ['Revenue | SUM'], rows: [], truncated: false, totals: { 'Revenue | SUM': 42 },
    };
    render(<Scorecard component={component} data={data} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders a placeholder rather than NaN for a non-numeric totals value', () => {
    const data: QueryResult = {
      columns: ['Cost | SUM'], rows: [], truncated: false, totals: { 'Cost | SUM': null },
    };
    render(<Scorecard component={component} data={data} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('formats a COUNT_DISTINCT/COUNTUNIQUE key via aggLabel rather than a hand-rolled alias', () => {
    const c: Component = {
      id: 'd', type: 'scorecard', title: 'Buyers', width: 1, height: 1,
      config: { metric: 'User.id', aggregation: 'COUNT_DISTINCT' },
    };
    const data: QueryResult = {
      columns: ['User_id | COUNTUNIQUE'], rows: [], truncated: false,
      totals: { 'User_id | COUNTUNIQUE': 42 },
    };
    render(<Scorecard component={c} data={data} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});
