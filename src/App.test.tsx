import { render, screen } from '@testing-library/react';
import { App } from './App';

test('renders the title', () => {
  render(<App ctx={{} as never} />);
  expect(screen.getByRole('heading', { name: 'Gyroscope' })).toBeInTheDocument();
});
