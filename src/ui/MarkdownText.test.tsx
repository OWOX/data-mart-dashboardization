import { render } from '@testing-library/react';
import { MarkdownText } from './MarkdownText';

const html = (text: string) => render(<MarkdownText text={text} />).container;

test('a link labelled with its own URL is one link, not two nested', () => {
  const d = html('[https://a.com](https://a.com)');
  expect(d.querySelectorAll('a')).toHaveLength(1);
  expect(d.querySelector('a a')).toBeNull();
});

test('asterisks inside words and double underscores stay literal', () => {
  const d = html('see __TABLES__ and price*qty and a*b');
  expect(d.querySelector('strong, em')).toBeNull();
  expect(d.textContent).toBe('see __TABLES__ and price*qty and a*b');
  expect(html('an *aside* here').querySelector('em')!.textContent).toBe('aside');
});

test('URLs keep balanced parentheses and drop trailing punctuation', () => {
  expect(html('[W](https://en.wikipedia.org/wiki/Foo_(bar))').querySelector('a')!.getAttribute('href')).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
  const d = html('See https://en.wikipedia.org/wiki/Foo_(bar).');
  expect(d.querySelector('a')!.getAttribute('href')).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
  expect(d.textContent).toBe('See https://en.wikipedia.org/wiki/Foo_(bar).');
});

test('a list after an intro line is a list; indented lines continue an item; numbering keeps its start', () => {
  const d = html('Metrics:\n- clicks\n  per day\n- cost\n\n3. three\n4. four');
  expect(d.querySelector('p')!.textContent).toBe('Metrics:');
  expect([...d.querySelectorAll('ul li')].map((li) => li.textContent)).toEqual(['clicks per day', 'cost']);
  expect(d.querySelector('ol')!.getAttribute('start')).toBe('3');
});

// A runaway (quadratic) parse of this input takes minutes; the bound leaves room for a slow CI runner.
test('text full of unclosed marks renders quickly', () => {
  const t = performance.now();
  html('['.repeat(50_000) + '*'.repeat(20_000) + '**x'.repeat(10_000));
  expect(performance.now() - t).toBeLessThan(5000);
});
