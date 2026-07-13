import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Grid } from './Grid';
import { emptyDashboard } from '../lib/types';
import type { Dashboard } from '../lib/types';

function dash(): Dashboard {
  return {
    ...emptyDashboard('d1', 'm1', 'D'),
    gridColumns: 5,
    components: [
      { id: 'a', type: 'scorecard', title: 'A', width: 1, height: 1, config: { metric: 'x', aggregation: 'SUM' } },
      { id: 'b', type: 'table', title: 'B', width: 5, height: 3, config: { columns: ['x'], limit: 10 } },
    ],
  };
}

describe('Grid', () => {
  it('spans each component by its width and height', () => {
    render(<Grid dashboard={dash()}>{c => <div data-testid={c.id}>{c.title}</div>}</Grid>);
    expect(screen.getByTestId('a').parentElement).toHaveStyle({ gridColumn: 'span 1', gridRow: 'span 1' });
    expect(screen.getByTestId('b').parentElement).toHaveStyle({ gridColumn: 'span 5', gridRow: 'span 3' });
  });

  it('clamps a width larger than the grid to the column count', () => {
    const d = dash();
    d.components[0].width = 99;
    render(<Grid dashboard={d}>{c => <div data-testid={c.id} />}</Grid>);
    expect(screen.getByTestId('a').parentElement).toHaveStyle({ gridColumn: 'span 5' });
  });
});
