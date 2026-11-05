import { fireEvent, render, screen } from '@testing-library/react';
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

test('the step names the page to fix it on and opens it', () => {
  const onOpen = vi.fn();
  render(<Blocked blocked={{ code: 'NO_GOAL', detail: 'x', mismatches: [] }} projectId="p42" onRetry={() => {}} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole('button', { name: 'Project settings' }));
  expect(onOpen).toHaveBeenCalledWith('/ui/p42/project-settings');
});

test('AI_NOT_CONFIGURED links to Plugins', () => {
  const onOpen = vi.fn();
  render(<Blocked blocked={{ code: 'AI_NOT_CONFIGURED', detail: 'x', mismatches: [] }} projectId="p42" onRetry={() => {}} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole('button', { name: 'Plugins' }));
  expect(onOpen).toHaveBeenCalledWith('/ui/p42/plugins');
});

test('without navigation the page name is plain text', () => {
  render(<Blocked blocked={{ code: 'NO_GOAL', detail: 'x', mismatches: [] }} projectId="p" onRetry={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Project settings' })).toBeNull();
  expect(screen.getByText(/Open Project settings in OWOX Data Marts/)).toBeInTheDocument();
});

test('Run checkup shows only when given and calls it', () => {
  const onCheckup = vi.fn();
  const { rerender } = render(<Blocked blocked={{ code: 'NO_GOAL', detail: 'x', mismatches: [] }} projectId="p" onRetry={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Run checkup' })).toBeNull();
  rerender(<Blocked blocked={{ code: 'NO_GOAL', detail: 'x', mismatches: [] }} projectId="p" onRetry={() => {}} onCheckup={onCheckup} />);
  fireEvent.click(screen.getByRole('button', { name: 'Run checkup' }));
  expect(onCheckup).toHaveBeenCalled();
});
