import { render, screen } from '@testing-library/react';
import { Blocked } from './Blocked';

test('placeholder goal shows reason, steps and snippet with the project id', () => {
  render(<Blocked blocked={{ code: 'GOAL_PLACEHOLDER', detail: 'The ARR link is a placeholder.', mismatches: [] }} projectId="p42" onRetry={() => {}} />);
  expect(screen.getByRole('heading', { name: "Goal can't be tracked" })).toBeInTheDocument();
  expect(screen.getByText('The ARR link is a placeholder.')).toBeInTheDocument();
  expect(screen.getByText(/Critical number \| ARR/)).toHaveTextContent('/ui/p42/data-marts/');
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
});

test('AI_INVALID lists mismatches', () => {
  render(<Blocked blocked={{ code: 'AI_INVALID', detail: 'x', mismatches: ['ARR → field "a" not found in M'] }} projectId="p" onRetry={() => {}} />);
  expect(screen.getByText('ARR → field "a" not found in M')).toBeInTheDocument();
});
