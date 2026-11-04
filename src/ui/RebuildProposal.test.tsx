import { fireEvent, render, screen } from '@testing-library/react';
import { RebuildProposal } from './RebuildProposal';
import type { Change } from '../model/diff';

const added: Change = { kind: 'class_added', classId: 'd', title: 'Deals' };
const removed: Change = { kind: 'class_removed', classId: 'a', title: 'Orders' };
const props = (changes: Change[], extra = {}) => ({
  changes, titleOf: (id: string) => id, nameOf: (id: string) => id, busy: false, error: null,
  needs: (c: Change) => (c === removed ? added : null), onApply: vi.fn(), onDiscard: vi.fn(), onClose: vi.fn(), ...extra,
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
