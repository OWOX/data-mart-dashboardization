import { render } from '@testing-library/react';
import { HostLoadingContext, LoadingBar } from './LoadingBar';

const host = () => {
  const calls: string[] = [];
  let n = 0;
  const start = () => { const id = ++n; calls.push(`start ${id}`); return { setProgress: (f: number) => calls.push(`${id} ${f}`), stop: () => calls.push(`stop ${id}`) }; };
  return { calls, start };
};

test('drives the host bar and draws nothing', () => {
  const { calls, start } = host();
  const { container, rerender, unmount } = render(<HostLoadingContext value={start}><LoadingBar /></HostLoadingContext>);
  expect(container).toBeEmptyDOMElement();
  rerender(<HostLoadingContext value={start}><LoadingBar progress={{ done: 3, total: 12 }} /></HostLoadingContext>);
  rerender(<HostLoadingContext value={start}><LoadingBar progress={{ done: 6, total: 12 }} /></HostLoadingContext>);
  unmount();
  // a total arriving starts a determinate loading; the sliding one stops
  expect(calls).toEqual(['start 1', 'stop 1', 'start 2', '2 0.25', '2 0.5', 'stop 2']);
});

test('a lost total starts a sliding loading again', () => {
  const { calls, start } = host();
  const { rerender } = render(<HostLoadingContext value={start}><LoadingBar progress={{ done: 1, total: 2 }} /></HostLoadingContext>);
  rerender(<HostLoadingContext value={start}><LoadingBar progress={null} /></HostLoadingContext>);
  expect(calls).toEqual(['start 1', '1 0.5', 'stop 1', 'start 2']);
});

test('without the host bar, nothing shows and nothing throws', () => {
  const { container } = render(<LoadingBar progress={{ done: 1, total: 2 }} />);
  expect(container).toBeEmptyDOMElement();
});
