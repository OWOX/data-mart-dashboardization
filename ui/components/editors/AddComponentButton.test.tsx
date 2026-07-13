import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { AddComponentButton } from './AddComponentButton';

/**
 * Task 23 (M5): the dropdown is a plain toggled panel, not a real ARIA menu — it implements none
 * of the ARIA menu keyboard contract (Escape-to-close, arrow-key roving focus), so it must not
 * claim `role="menu"`/`role="menuitem"`, which would lie to assistive tech. A plain group of
 * `<button>`s is already accessible and truthful without those roles.
 */
describe('AddComponentButton', () => {
  it('opens a panel of component-type buttons without claiming a fake ARIA menu role', () => {
    const { container, getByRole } = render(<AddComponentButton onAdd={vi.fn()} />);

    fireEvent.click(getByRole('button', { name: /add component/i }));

    // No element in the panel claims to be a real ARIA menu/menuitem.
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(container.querySelectorAll('[role="menuitem"]').length).toBe(0);

    // The options are still reachable as plain, accessible buttons.
    expect(getByRole('button', { name: 'Bar chart' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Pie chart' })).toBeInTheDocument();
  });

  it('clicking a component type calls onAdd with that type and closes the panel', () => {
    const onAdd = vi.fn();
    const { getByRole, queryByRole } = render(<AddComponentButton onAdd={onAdd} />);

    fireEvent.click(getByRole('button', { name: /add component/i }));
    fireEvent.click(getByRole('button', { name: 'Donut chart' }));

    expect(onAdd).toHaveBeenCalledWith('donut');
    expect(queryByRole('button', { name: 'Donut chart' })).toBeNull();
  });

  it('clicking outside (the backdrop) closes the panel without being a stray focusable element', () => {
    const { container, getByRole, queryByRole } = render(<AddComponentButton onAdd={vi.fn()} />);
    fireEvent.click(getByRole('button', { name: /add component/i }));

    const backdrop = container.querySelector('.fixed.inset-0');
    expect(backdrop?.tagName).toBe('DIV');

    fireEvent.click(backdrop!);
    expect(queryByRole('button', { name: 'Bar chart' })).toBeNull();
  });
});
