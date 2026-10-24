import { extractLinks } from './links';

const MD = `| Critical number | ARR | [Plan · ARR](https://app.owox.com/ui/p1/data-marts/<PLAN_ID>/data-setup?field=arr) | [ARR](https://app.owox.com/ui/p1/data-marts/86d5294a-a33d-4c06-9944-8680e7c96d72/data-setup?field=arr) |
See [docs](https://docs.owox.com) and [Visitors](https://app.owox.com/ui/p1/data-marts/3be86edb-b880-498b-b533-459640b99106/data-setup?x=1&field=last+Visit%2EDate).`;

test('extracts data mart links, flags placeholders, skips others', () => {
  expect(extractLinks(MD, 'project', 0)).toEqual([
    { index: 0, source: 'project', text: 'Plan · ARR', url: 'https://app.owox.com/ui/p1/data-marts/<PLAN_ID>/data-setup?field=arr', martId: null, field: 'arr', placeholder: true },
    { index: 1, source: 'project', text: 'ARR', url: 'https://app.owox.com/ui/p1/data-marts/86d5294a-a33d-4c06-9944-8680e7c96d72/data-setup?field=arr', martId: '86d5294a-a33d-4c06-9944-8680e7c96d72', field: 'arr', placeholder: false },
    { index: 2, source: 'project', text: 'Visitors', url: 'https://app.owox.com/ui/p1/data-marts/3be86edb-b880-498b-b533-459640b99106/data-setup?x=1&field=last+Visit%2EDate', martId: '3be86edb-b880-498b-b533-459640b99106', field: 'last Visit.Date', placeholder: false },
  ]);
});

test('null and empty markdown give no links', () => {
  expect(extractLinks(null, 'project', 0)).toEqual([]);
  expect(extractLinks('', 'c1', 5)).toEqual([]);
});
