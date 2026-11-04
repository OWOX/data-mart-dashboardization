import { runPool } from './pool';

test('keeps order, caps concurrency, settles failures', async () => {
  let active = 0, peak = 0;
  const task = (v: number, fail = false) => async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    if (fail) throw new Error(`bad ${v}`);
    return v;
  };
  const res = await runPool([task(1), task(2, true), task(3), task(4), task(5)], 2);
  expect(peak).toBe(2);
  expect(res.map((r) => (r.status === 'fulfilled' ? r.value : (r.reason as Error).message))).toEqual([1, 'bad 2', 3, 4, 5]);
});
