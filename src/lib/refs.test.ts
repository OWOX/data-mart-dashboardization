import { parseRefs } from './refs';

test('own and joined refs, any quoting and spacing', () => {
  const f = `SUM({{ref field="revenue"}}) / COUNT({{ ref  path='orders.items'   field='qty' }}) + {{ref field="x" path="customers"}}`;
  expect(parseRefs(f)).toEqual([
    { path: '', field: 'revenue' },
    { path: 'orders.items', field: 'qty' },
    { path: 'customers', field: 'x' },
  ]);
});

test('ignores non-ref mustaches and refs without field', () => {
  expect(parseRefs('{{other field="a"}} {{ref path="a"}}')).toEqual([]);
});
