// Expenses, transfers, balance adjustment and output escaping (admin, demo mode).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../helpers/app');

async function admin() { const app = await H.boot('admin.html'); await H.login(app); return app; }
async function tabForm(app, tipe) {
  await H.reopen(app, 'input');
  app.$$('.tabs button').find(b => b.dataset.t === tipe).click(); await H.tick(40);
  return app.$('#trxForm');
}
const saldoCard = (app, nama) => H.rpNum(app.$$('.pc-card').find(c => c.querySelector('.mhead b').textContent === nama).querySelector('.kas-saldo').textContent);
const prevYM = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

test('KEU-01 an expense is reported under its charge month', async () => {
  const app = await admin();
  const f = await tabForm(app, 'pengeluaran');
  const kat = (await app.w.DB.list('kategori')).find(k => /Listrik/.test(k.nama));
  f.nilai.value = '250.000'; f.kategori_id.value = kat.id; f.bulan.value = prevYM(); f.keterangan.value = 'Listrik uji';
  await H.submit(app, f);
  const t = (await app.w.DB.list('transaksi')).find(x => x.keterangan === 'Listrik uji');
  assert.equal(t.bulan, prevYM()); assert.equal(Number(t.nilai), 250000);
  await H.reopen(app, 'pengeluaran');
  const sel = app.$('#fBulan'); sel.value = prevYM(); await H.fire(app, sel, 'change', 60);
  app.$(`[data-k="${kat.id}"][data-m="${prevYM()}"]`).click(); await H.tick(40);
  assert.match(app.$('#modalBody').textContent, /Listrik uji/);
});

test('KEU-02 a transfer to the same wallet is refused', async () => {
  const app = await admin();
  const f = await tabForm(app, 'mutasi');
  const n = (await app.w.DB.list('transaksi')).length;
  f.nilai.value = '100.000'; f.dompet_tujuan_id.value = f.dompet_id.value;
  await H.submit(app, f);
  assert.equal(H.toastText(app), 'Dompet asal dan tujuan tidak boleh sama.');
  assert.equal((await app.w.DB.list('transaksi')).length, n);
});

test('KEU-03 a transfer with a bank fee moves both balances correctly', async () => {
  const app = await admin();
  await H.reopen(app, 'keuangan');
  const a0 = saldoCard(app, 'Kas Mandiri Sherwood'), b0 = saldoCard(app, 'Kas Krom Sherwood');
  const f = await tabForm(app, 'mutasi');
  f.dompet_id.value = 'w-rek'; f.dompet_tujuan_id.value = 'w-krom'; f.nilai.value = '5.000.000'; f.biaya.value = '6.500'; f.keterangan.value = 'Mutasi uji';
  await H.submit(app, f);
  const fee = (await app.w.DB.list('transaksi')).find(t => t.tipe === 'pengeluaran' && /Biaya admin mutasi Kas Mandiri Sherwood → Kas Krom Sherwood/.test(t.keterangan) && t.tanggal === f.tanggal.value && Number(t.nilai) === 6500);
  assert.ok(fee, 'fee expense recorded');
  assert.equal(fee.dompet_id, 'w-rek');
  await H.reopen(app, 'keuangan');
  assert.equal(saldoCard(app, 'Kas Mandiri Sherwood'), Math.round((a0 - 5006500) * 100) / 100);
  assert.equal(saldoCard(app, 'Kas Krom Sherwood'), Math.round((b0 + 5000000) * 100) / 100);
});

test('KEU-04 "Sesuaikan saldo" sets the balance without creating a transaction', async () => {
  const app = await admin();
  const n = (await app.w.DB.list('transaksi')).length;
  await H.reopen(app, 'keuangan');
  app.$('[data-adj="w-t2"]').click(); await H.tick(40);
  app.$('#adjNyata').value = '1.250.000';
  await H.submit(app, app.$('#adjF'));
  assert.equal(H.toastText(app), 'Saldo disesuaikan');
  await H.reopen(app, 'keuangan');
  assert.equal(saldoCard(app, 'Tunai - Pak Ketua'), 1250000);
  assert.equal((await app.w.DB.list('transaksi')).length, n);
});

// Regression test for OBS-5 (fixed in 749682f)
test('KEU-05 a negative income amount is refused', async () => {
  const app = await admin();
  const f = await tabForm(app, 'pemasukan');
  f.nilai.value = '-50.000'; f.keterangan.value = 'negatif uji';
  await H.submit(app, f);
  assert.equal(H.toastText(app), 'Nilai harus lebih dari 0.');
  assert.equal((await app.w.DB.list('transaksi')).find(t => t.keterangan === 'negatif uji'), undefined);
});

test('NF-02 user text is shown literally, never as HTML', async () => {
  const app = await admin();
  const payload = '<b>tebal</b><img src=x onerror="window.__xss=1">';
  const f = await tabForm(app, 'pengeluaran');
  f.nilai.value = '1.000'; f.kategori_id.value = (await app.w.DB.list('kategori'))[0].id; f.keterangan.value = payload;
  await H.submit(app, f);
  await H.reopen(app, 'riwayat');
  assert.ok(app.$('#view').textContent.includes(payload));
  assert.equal(app.$('#view img'), null); assert.equal(app.$('#view tbody b'), null);
  await H.reopen(app, 'catatan');
  app.$('#cf').isi.value = payload; await H.submit(app, app.$('#cf'));
  assert.ok(app.$('#view').textContent.includes(payload));
  assert.equal(app.$('#view img'), null);
  assert.equal(app.w.__xss, undefined);
});

// Regression test for OBS-1 (fixed in 749682f); the demo adapter mirrors the new audit triggers
test('AUD-04 Audit Log shows wallet balance adjustments', async () => {
  const app = await admin();
  await H.reopen(app, 'keuangan');
  app.$('[data-adj="w-t2"]').click(); await H.tick(40);
  app.$('#adjNyata').value = '1.250.000';
  await H.submit(app, app.$('#adjF'));
  await H.reopen(app, 'audit');
  const row = app.$$('#view tbody tr').find(tr => tr.cells[2] && tr.cells[2].textContent === 'dompet');
  assert.ok(row, 'no dompet row in Audit Log');
  assert.equal(row.cells[1].textContent, 'UPDATE');
  assert.match(row.cells[3].textContent, /Tunai - Pak Ketua · saldo awal Rp0/);
  assert.match(row.cells[4].textContent, /saldo awal Rp1\.250\.000/);
});

// Regression test for OBS-6 (fixed in 749682f)
test('LAP-06 Excel export loads SheetJS on demand with SRI and writes 4 sheets', async () => {
  const app = await admin();
  await H.reopen(app, 'impor');
  assert.equal(app.w.XLSX, undefined);
  app.$('#xlsBtn').click(); await H.tick(30);
  const s = app.$('script[src*="cdn.sheetjs.com"]');
  assert.ok(s, 'SheetJS script not injected');
  assert.match(s.integrity, /^sha384-/);
  assert.equal(s.crossOrigin, 'anonymous');
  // Stand-in for the library that records what the app writes
  const written = {};
  app.w.XLSX = { utils: { book_new: () => ({ s: [] }), aoa_to_sheet: aoa => aoa, book_append_sheet: (wb, ws, n) => { wb.s.push([n, ws]); } },
    writeFile: (wb, name) => { written.name = name; written.sheets = wb.s; } };
  s.dispatchEvent(new app.w.Event('load')); await H.tick(60);
  assert.equal(written.name, `Rekap-Keuangan-${H.curY()}.xlsx`);
  assert.deepEqual([...written.sheets.map(x => x[0])], ['Transaksi', 'Ringkasan', 'Rekap Bayar', 'Pengeluaran']);
  assert.deepEqual([...written.sheets[0][1][0]], ['Tanggal', 'Tipe', 'Rumah', 'Bulan', 'Kategori', 'Mitra', 'Keterangan', 'Dompet', 'Dompet tujuan', 'Nilai']);
  assert.ok(written.sheets[0][1].length > 10, 'transactions exported');
  // A second click reuses the loaded library instead of injecting another script
  app.$('#xlsBtn').click(); await H.tick(30);
  assert.equal(app.$$('script[src*="cdn.sheetjs.com"]').length, 1);
});
