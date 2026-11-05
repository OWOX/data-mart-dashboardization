import { act, render } from '@testing-library/react';
import { HostLoadingContext, LoadingBar } from './LoadingBar';

const host = () => {
  const calls: string[] = [];
  let n = 0;
  const start = () => { const id = ++n; calls.push(`start ${id}`); return { setProgress: (f: number) => calls.push(`${id} ${f}`), stop: () => calls.push(`stop ${id}`) }; };
  return { calls, start };
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test('one loading from sliding to filled, stopped a tick after unmount; draws nothing', () => {
  const { calls, start } = host();
  const { container, rerender, unmount } = render(<HostLoadingContext value={start}><LoadingBar /></HostLoadingContext>);
  expect(container).toBeEmptyDOMElement();
  rerender(<HostLoadingContext value={start}><LoadingBar progress={{ done: 3, total: 12 }} /></HostLoadingContext>);
  rerender(<HostLoadingContext value={start}><LoadingBar progress={{ done: 6, total: 12 }} /></HostLoadingContext>);
  unmount();
  expect(calls).toEqual(['start 1', '1 0.25', '1 0.5']);
  act(() => { vi.runAllTimers(); });
  expect(calls).toEqual(['start 1', '1 0.25', '1 0.5', 'stop 1']);
});

test('a lost total starts a new loading before stopping the old one', () => {
  const { calls, start } = host();
  const { rerender } = render(<HostLoadingContext value={start}><LoadingBar progress={{ done: 1, total: 2 }} /></HostLoadingContext>);
  rerender(<HostLoadingContext value={start}><LoadingBar progress={null} /></HostLoadingContext>);
  rerender(<HostLoadingContext value={start}><LoadingBar progress={{ done: 2, total: 2 }} /></HostLoadingContext>);
  expect(calls).toEqual(['start 1', '1 0.5', 'start 2', 'stop 1', '2 1']);
});

test('a bar in the next view starts before the old one stops', () => {
  const { calls, start } = host();
  const { rerender } = render(<HostLoadingContext value={start}><LoadingBar key="a" /></HostLoadingContext>);
  rerender(<HostLoadingContext value={start}><LoadingBar key="b" /></HostLoadingContext>);
  act(() => { vi.runAllTimers(); });
  expect(calls).toEqual(['start 1', 'start 2', 'stop 1']);
});

test('a bar at 90% or more stops at once, so the next view starts a fresh one', () => {
  const { calls, start } = host();
  const { rerender } = render(<HostLoadingContext value={start}><LoadingBar key="a" progress={{ done: 2, total: 2 }} /></HostLoadingContext>);
  rerender(<HostLoadingContext value={start}><LoadingBar key="b" /></HostLoadingContext>);
  expect(calls).toEqual(['start 1', '1 1', 'stop 1', 'start 2']);
  const late = host();
  const r = render(<HostLoadingContext value={late.start}><LoadingBar key="a" progress={{ done: 47, total: 50 }} /></HostLoadingContext>);
  r.rerender(<HostLoadingContext value={late.start}><LoadingBar key="b" /></HostLoadingContext>);
  expect(late.calls).toEqual(['start 1', '1 0.94', 'stop 1', 'start 2']);
});

test('without the host bar, nothing shows and nothing throws', () => {
  const { container } = render(<LoadingBar progress={{ done: 1, total: 2 }} />);
  expect(container).toBeEmptyDOMElement();
});
