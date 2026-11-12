import { render } from '../test-host';
import { OntologyCard } from './OntologyCard';
import type { ClassNode } from '../types';

const cls = { id: 'c', martId: 'c', title: 'Customers', depth: 1, keyMetricId: null, metricIds: [], shown: true, core: true, inbound: 2, contexts: [] } as ClassNode;

test('shows the title and marks the goal', () => {
  const { container, rerender } = render(<OntologyCard cls={cls} goal={false} />);
  expect(container.querySelector('.gy-ocard-title')?.textContent).toBe('Customers');
  expect(container.querySelector('[data-class-id="c"]')).toHaveAttribute('data-goal', 'false');
  rerender(<OntologyCard cls={cls} goal />);
  expect(container.querySelector('[data-class-id="c"]')).toHaveAttribute('data-goal', 'true');
});
