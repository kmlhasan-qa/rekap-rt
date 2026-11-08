// Pure helpers from app.js (extracted from the source, so the app itself stays unchanged) and static checks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { extract, ROOT } = require('../helpers/app');

const { parseRp, parseNumText, ymAdd, ymRange, esc } = extract(['esc', 'parseRp', 'parseNumText', 'pad', 'ymOf', 'ymAdd', 'ymRange']);

test('parseRp reads Indonesian money input (dot = thousands, comma = decimal)', () => {
  assert.equal(parseRp('150.000'), 150000);
  assert.equal(parseRp('Rp 1.500.000'), 1500000);
  assert.equal(parseRp('1.500.000,50'), 1500000.5);
  assert.equal(parseRp('62342.5'), 62342.5);
  assert.equal(parseRp(''), 0);
});

test('ymAdd / ymRange cross year boundaries', () => {
  assert.equal(ymAdd('2026-12', 1), '2027-01');
  assert.equal(ymAdd('2026-01', -1), '2025-12');
  assert.equal(ymAdd('2026-11', 14), '2028-01');
  assert.deepEqual(ymRange('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
});

test('esc neutralises HTML metacharacters', () => {
  assert.equal(esc(`<img src=x onerror="a('1')">&`), '&lt;img src=x onerror=&quot;a(&#39;1&#39;)&quot;&gt;&amp;');
  assert.equal(esc(null), '');
});

// Regression test for DEF-001 (fixed in 749682f)
test('IMP-01 CSV amount parser reads Rupiah with a thousands dot', () => {
  assert.equal(parseNumText('150000'), 150000);
  assert.equal(parseNumText('Rp150.000'), 150000);
  assert.equal(parseNumText('150,000'), 150000);
  assert.equal(parseNumText('Rp275.500'), 275500);
});

// Regression test for DEF-001 (fixed in 749682f)
test('IMP-03 CSV amount parser keeps cents', () => {
  assert.equal(parseNumText('41235.67'), 41235.67);
  assert.equal(parseNumText('1.500.000,50'), 1500000.5);
});

test('IMP-04 CSV amount parser reads receipt-style Rupiah spellings', () => {
  for (const s of ['Rp150.000,-', 'Rp 150.000,-', 'Rp150.000,00', 'IDR 150.000', 'Rp. 150.000', '150.000'])
    assert.equal(parseNumText(s), 150000, s);
  assert.equal(parseNumText('1.500'), 1500);
  assert.equal(parseNumText('41.235,67'), 41235.67);
  assert.equal(parseNumText('1,500,000.50'), 1500000.5);
  assert.equal(parseNumText('-150.000'), -150000);
  assert.equal(parseNumText(''), 0);
  assert.equal(parseNumText('abc'), 0);
});

const html = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
test('NF-01 SheetJS loaded on demand is pinned with SRI', () => {
  const src = html('app.js');
  assert.match(src, /XLSX_SRC = 'https:\/\/cdn\.sheetjs\.com\/xlsx-\d+\.\d+\.\d+\/[^']+'/);
  assert.match(src, /XLSX_SRI = 'sha384-[A-Za-z0-9+/=]{64}'/);
  assert.match(src, /s\.integrity = XLSX_SRI; s\.crossOrigin = 'anonymous'/);
  assert.doesNotMatch(html('index.html') + html('admin.html'), /xlsx/i, 'SheetJS should no longer load on every page');
});
// Regression test for OBS-3 (fixed in 749682f)
test('NF-01 every CDN script carries Subresource Integrity', () => {
  for (const f of ['index.html', 'admin.html']) {
    const tags = html(f).match(/<script src="https:[^>]+>/g) || [];
    assert.ok(tags.length > 0);
    for (const t of tags) assert.match(t, /integrity="sha(256|384|512)-/, `${f}: ${t}`);
  }
});

// Regression test for OBS-6 (fixed in 749682f)
test('NF-04 Excel export promised in README is reachable', () => {
  const src = html('app.js');
  assert.match(html('README.md'), /Excel/);
  assert.ok((src.match(/exportExcel/g) || []).length > 1, 'exportExcel is never referenced');
});

test('index.html and admin.html load the same asset version', () => {
  const v = f => [...html(f).matchAll(/\?v=(\d+)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(v('index.html'))], [...new Set(v('admin.html'))]);
  assert.equal(new Set(v('index.html')).size, 1);
});
