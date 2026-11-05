import { fireEvent, render, screen } from '@testing-library/react';
import { RebuildProposal } from './RebuildProposal';
import type { Change } from '../model/diff';

const added: Change = { kind: 'class_added', classId: 'd', title: 'Deals' };
const removed: Change = { kind: 'class_removed', classId: 'a', title: 'Orders' };
const props = (changes: Change[], extra = {}) => ({
  changes, titleOf: (id: string) => id, nameOf: (id: string) => id, busy: false, error: null,
  needs: (c: Change) => (c === removed ? added : null), onApply: vi.fn(), onDiscard: vi.fn(), onClose: vi.fn(), ...extra,
});

test('a format change is listed with before and after', () => {
  const c: Change = { kind: 'metric_changed', classId: 'a', metricId: 'm', field: 'format', before: 'number', after: 'percent' };
  render(<RebuildProposal {...props([c])} />);
  expect(screen.getByText('m: format')).toBeInTheDocument();
  expect(screen.getByText('number → percent')).toBeInTheDocument();
});

test('with no changes, a failed save after Close is shown', () => {
  render(<RebuildProposal {...props([], { error: "Couldn't save the model: boom" })} />);
  expect(screen.getByText('The model already matches the descriptions.')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save the model: boom");
});

test('the old goal class row needs the new goal class row: unchecking one unchecks and disables the other', () => {
  const p = props([added, removed]);
  render(<RebuildProposal {...p} />);
  const removal = screen.getByRole('checkbox', { name: /Remove class Orders/ });
  expect(removal).toBeEnabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /Add class Deals/ }));
  expect(removal).not.toBeChecked();
  expect(removal).toBeDisabled();
  expect(screen.getByText('Needs the new goal class')).toBeInTheDocument();
  // nothing else is picked, so there is nothing to apply
  expect(screen.getByRole('button', { name: 'Apply selected' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /Add class Deals/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Remove class Orders/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply selected' }));
  expect(p.onApply).toHaveBeenCalledWith([added, removed]);
});

test('changes are grouped under their Data Mart, the class row first', () => {
  const fact: Change = { kind: 'metric_changed', classId: 'a', metricId: 'm', field: 'kind', before: 'flow', after: 'level' };
  const other: Change = { kind: 'metric_added', classId: 'c', metricId: 'n', alias: 'New' };
  render(<RebuildProposal {...props([fact, other, removed], { titleOf: (id: string) => ({ a: 'Orders', c: 'Customers' })[id] })} />);
  expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['Orders', 'Customers']);
  const [orders] = screen.getAllByRole('list');
  expect([...orders!.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Remove class Orders', 'm: kindflow → level']);
});
