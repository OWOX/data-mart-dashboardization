import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComponentEditor } from './ComponentEditor';
import { emptyDashboard } from '../../lib/types';
import type { Dashboard, MartField } from '../../lib/types';

function dash(): Dashboard {
  return {
    ...emptyDashboard('d1', 'm1', 'D'),
    components: [
      { id: 'a', type: 'scorecard', title: 'Revenue', width: 1, height: 1, config: { metric: 'Cost', aggregation: 'SUM' } },
    ],
  };
}

const fields: MartField[] = [
  { name: 'Cost', type: 'FLOAT', role: 'metric', allowedAggregations: ['SUM', 'AVG'] },
  { name: 'Source', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT'] },
];

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Mirrors how `DashboardView` actually mounts the editor: it starts closed, and mounting happens
 * from a click on a trigger button that HAD focus — this is the only way to exercise "return focus
 * to the trigger" for real, since the trigger must be focused BEFORE the editor mounts.
 */
function Harness({ onCloseSpy }: { onCloseSpy: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Trigger</button>
      {open && (
        <ComponentEditor
          dashboard={dash()}
          componentId="a"
          fields={fields}
          onChange={() => {}}
          onClose={() => { setOpen(false); onCloseSpy(); }}
        />
      )}
    </div>
  );
}

describe('ComponentEditor accessibility', () => {
  it('is a labeled, non-modal drawer — the dashboard stays visible and clickable behind it', () => {
    render(<ComponentEditor dashboard={dash()} componentId="a" fields={fields} onChange={vi.fn()} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    // Not aria-modal: it is a side panel, dismissed by clicking the dashboard behind it.
    expect(dialog).not.toHaveAttribute('aria-modal');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)).toHaveTextContent(/edit/i);
  });

  it('moves focus into the panel on open', () => {
    render(<ComponentEditor dashboard={dash()} componentId="a" fields={fields} onChange={vi.fn()} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Escape closes the panel', () => {
    const onClose = vi.fn();
    render(<ComponentEditor dashboard={dash()} componentId="a" fields={fields} onChange={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab focus within the panel: Shift+Tab from the first control wraps to the last', () => {
    render(<ComponentEditor dashboard={dash()} componentId="a" fields={fields} onChange={vi.fn()} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    const focusables = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
    expect(focusables.length).toBeGreaterThan(1);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('restores focus to the element that opened it, once it closes', () => {
    const onCloseSpy = vi.fn();
    render(<Harness onCloseSpy={onCloseSpy} />);

    const trigger = screen.getByRole('button', { name: 'Trigger' });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.activeElement).not.toBe(trigger); // focus moved into the panel

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCloseSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });
});
