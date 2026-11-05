import { sanitizeHtml } from './sanitizeHtml';

const out = (h: string) => { const d = document.createElement('div'); d.innerHTML = sanitizeHtml(h); return d; };

test('scripts, handlers and dangerous markup are neutralised', () => {
  const d = out('<img src=x onerror=alert(1)><script>alert(1)</script><svg onload=alert(1)><circle/></svg><iframe src="//x"></iframe><p onclick="x()" style="color:red">hi</p><object data=x></object>');
  expect(d.querySelector('img,script,svg,iframe,object')).toBeNull();
  expect(d.innerHTML).not.toMatch(/onerror|onclick|onload|alert|style=/);
  expect(d.querySelector('p')!.textContent).toBe('hi');
});

test('unsafe hrefs lose the attribute, safe ones stay', () => {
  const d = out('<a href="javascript:alert(1)">a</a><a href=" JaVaScRiPt:alert(1)">b</a><a href="java&#9;script:alert(1)">c</a><a href="data:text/html,x">d</a><a href="vbscript:x">e</a><a href="https://x.test/p">f</a><a href="mailto:a@b.c">g</a><a href="/ui/p">h</a>');
  const links = [...d.querySelectorAll('a')];
  expect(links.map((a) => a.getAttribute('href'))).toEqual([null, null, null, null, null, 'https://x.test/p', 'mailto:a@b.c', '/ui/p']);
  for (const a of links) expect(a.hasAttribute('target')).toBe(false);
});

test('tables, lists, headings and unknown wrappers survive as content', () => {
  const d = out('<h2>T</h2><ul><li>one</li></ul><table><thead><tr><th colspan="2" align="left" onclick="x">H</th></tr></thead><tbody><tr><td rowspan="2" class="c">v</td></tr></tbody></table><section><b>kept</b></section>');
  expect(d.querySelector('h2')!.textContent).toBe('T');
  expect(d.querySelector('li')!.textContent).toBe('one');
  expect(d.querySelector('th')!.getAttribute('colspan')).toBe('2');
  expect(d.querySelector('th')!.getAttribute('align')).toBe('left');
  expect(d.querySelector('th')!.hasAttribute('onclick')).toBe(false);
  expect(d.querySelector('td')!.hasAttribute('class')).toBe(false);
  expect(d.querySelector('section')).toBeNull();
  expect(d.querySelector('b')!.textContent).toBe('kept');
});

test('the markdown service hands out sanitized HTML only', async () => {
  const { createMarkdownHtml } = await import('./markdown');
  const md = createMarkdownHtml(async () => '<p onclick="x">a</p><script>x</script>')!;
  expect(await md.load('m', 't')).toBe('<p>a</p>');
  expect(md.peek('m', 't')).toBe('<p>a</p>');
});
