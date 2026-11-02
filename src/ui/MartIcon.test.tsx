import { render, waitFor } from '@testing-library/react';
import { MartIcon, toLucideName } from './MartIcon';

const cls = (icon: string | null) => render(<MartIcon icon={icon} size={14} />).container.querySelector('svg')!.getAttribute('class');

test('a recommended key draws its glyph; none or unknown draws the default box', () => {
  expect(cls('customers')).toContain('lucide-users');
  expect(cls('purchases')).toContain('lucide-shopping-cart');
  expect(cls(null)).toContain('lucide-box');
  expect(cls('no-such-key')).toContain('lucide-box');
});

test('a lucide: icon loads from the library; an unknown name falls back', async () => {
  const a = render(<MartIcon icon="lucide:rocket" size={14} />);
  await waitFor(() => expect(a.container.querySelector('svg')!.getAttribute('class')).toContain('lucide-rocket'));
  const b = render(<MartIcon icon="lucide:not-an-icon" size={14} />);
  await waitFor(() => expect(b.container.querySelector('svg')!.getAttribute('class')).toContain('lucide-box'));
});

test('component names spell like the host', () => {
  expect(toLucideName('ShoppingCart')).toBe('shopping-cart');
  expect(toLucideName('Grid2x2Check')).toBe('grid-2x2-check');
  expect(toLucideName('AArrowDown')).toBe('a-arrow-down');
});
