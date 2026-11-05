import { fireEvent, render, screen } from '@testing-library/react';
import { Select } from './Select';

const OPTS = [{ value: 'a', label: 'Alpha' }, { value: 'x', label: 'Gone', disabled: true }, { value: 'b', label: 'Beta' }, { value: 'c', label: 'Bravo' }];

function setup(value = 'a') {
  const onChange = vi.fn();
  render(<Select label="Pick" value={value} options={OPTS} onChange={onChange} />);
  return { box: screen.getByRole('combobox', { name: 'Pick' }), onChange };
}
const activeText = (box: HTMLElement) => document.getElementById(box.getAttribute('aria-activedescendant')!)?.textContent;

test('shows the current label and opens on click with the current option highlighted', () => {
  const { box } = setup('b');
  expect(box).toHaveTextContent('Beta');
  expect(box).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(box);
  expect(box).toHaveAttribute('aria-expanded', 'true');
  expect(activeText(box)).toBe('Beta');
  expect(screen.getByRole('option', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
});

test('the arrow keys skip disabled options, Enter picks', () => {
  const { box, onChange } = setup();
  fireEvent.keyDown(box, { key: 'ArrowDown' });
  fireEvent.keyDown(box, { key: 'ArrowDown' });
  expect(activeText(box)).toBe('Beta');
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(onChange).toHaveBeenCalledWith('b');
  expect(box).toHaveAttribute('aria-expanded', 'false');
});

test('a letter jumps to the next option starting with it; End and Home go to the ends', () => {
  const { box } = setup();
  fireEvent.click(box);
  fireEvent.keyDown(box, { key: 'b' });
  expect(activeText(box)).toBe('Beta');
  fireEvent.keyDown(box, { key: 'b' });
  expect(activeText(box)).toBe('Bravo');
  fireEvent.keyDown(box, { key: 'Home' });
  expect(activeText(box)).toBe('Alpha');
  fireEvent.keyDown(box, { key: 'End' });
  expect(activeText(box)).toBe('Bravo');
});

test('a disabled option or the current one changes nothing; Escape and blur close', () => {
  const { box, onChange } = setup();
  fireEvent.click(box);
  fireEvent.click(screen.getByRole('option', { name: 'Gone' }));
  fireEvent.click(screen.getByRole('option', { name: 'Alpha' }));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(box);
  fireEvent.keyDown(box, { key: 'Escape' });
  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.click(box);
  fireEvent.blur(box);
  expect(screen.queryByRole('listbox')).toBeNull();
});

test('the highlight follows its option when the options change under an open list', () => {
  const onChange = vi.fn();
  const { rerender } = render(<Select label="Pick" value="goal" options={[{ value: 'goal', label: 'goal' }]} onChange={onChange} />);
  const box = screen.getByRole('combobox', { name: 'Pick' });
  fireEvent.click(box);
  rerender(<Select label="Pick" value="goal" options={[{ value: 'amount', label: 'amount' }, { value: 'goal', label: 'goal' }, { value: 'day', label: 'day' }]} onChange={onChange} />);
  expect(activeText(box)).toBe('goal');
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(onChange).not.toHaveBeenCalled();
  expect(box).toHaveAttribute('aria-expanded', 'false');
});

test('a disabled current value highlights nothing: Enter only closes, ArrowDown starts at the first option and ArrowUp at the last', () => {
  const { box, onChange } = setup('x');
  fireEvent.click(box);
  expect(box).not.toHaveAttribute('aria-activedescendant');
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(box).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(box);
  fireEvent.keyDown(box, { key: 'ArrowDown' });
  expect(activeText(box)).toBe('Alpha');
  fireEvent.keyDown(box, { key: 'Escape' });
  fireEvent.click(box);
  fireEvent.keyDown(box, { key: 'ArrowUp' });
  expect(activeText(box)).toBe('Bravo');
  expect(onChange).not.toHaveBeenCalled();
});

test('with the list closed, a letter, Home and End change the value', () => {
  const { box, onChange } = setup('b');
  fireEvent.keyDown(box, { key: 'b' });
  expect(onChange).toHaveBeenLastCalledWith('c');
  fireEvent.keyDown(box, { key: 'Home' });
  expect(onChange).toHaveBeenLastCalledWith('a');
  fireEvent.keyDown(box, { key: 'End' });
  expect(onChange).toHaveBeenLastCalledWith('c');
  expect(box).toHaveAttribute('aria-expanded', 'false');
});
