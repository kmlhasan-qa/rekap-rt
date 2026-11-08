// Iuran (IPL dues) input, partial payments, edit/delete and the arrears matrix (admin, demo mode).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../helpers/app');

const Y = H.curY(), JAN = `${Y}-01`, FEB = `${Y}-02`;
const ibOf = async (app, house) => JSON.parse(JSON.stringify((await app.w.DB.list("iuran_bulan")).filter(b => b.rumah_id === house.id).map(b => [b.bulan, Number(b.nominal)]).sort()));
async function admin() { const app = await H.boot('admin.html'); await H.login(app); return app; }

test('BAYAR-01 paying two months fills the amount and stores one row per month', async () => {
  const app = await admin(); const h = await H.newHouse(app);
  const f = await H.iuranForm(app, h);
  assert.ok(H.monthBtn(app, JAN).classList.contains('sel'), 'oldest unpaid month preselected');
  H.monthBtn(app, FEB).click(); await H.tick(30);
  assert.equal(f.nilai.value, '300.000');
  assert.equal(f.nilai.readOnly, true);
  await H.submit(app, f);
  assert.equal(H.toastText(app), 'Transaksi disimpan');
  assert.deepEqual(await ibOf(app, h), [[JAN, 150000], [FEB, 150000]]);
  assert.equal((await H.bayarCell(app, h.kode, 0)).className, 'cell paid');
});

test('BAYAR-02 an amount above the bill is refused', async () => {
  const app = await admin(); const h = await H.newHouse(app);
  const f = await H.iuranForm(app, h);
  app.$('#sebagian').checked = true; await H.fire(app, app.$('#sebagian'));
  f.nilai.value = '200.000';
  await H.submit(app, f);
  assert.equal(H.toastText(app), 'Jumlah melebihi tagihan bulan yang dipilih (Rp150.000).');
  assert.deepEqual(await ibOf(app, h), []);
});

test('BAYAR-03 partial payment shows ½ and the remainder completes the month', async () => {
  const app = await admin(); const h = await H.newHouse(app);
  let f = await H.iuranForm(app, h);
  app.$('#sebagian').checked = true; await H.fire(app, app.$('#sebagian'));
  f.nilai.value = '100.000';
  await H.submit(app, f);
  assert.deepEqual(await ibOf(app, h), [[JAN, 100000]]);
  assert.equal((await H.bayarCell(app, h.kode, 0)).className, 'cell partial');

  f = await H.iuranForm(app, h);
  const jan = H.monthBtn(app, JAN);
  assert.ok(jan.classList.contains('part'));
  assert.match(jan.textContent, /sisa 50\.000/);
  assert.equal(f.nilai.value, '50.000');
  await H.submit(app, f);
  assert.deepEqual(await ibOf(app, h), [[JAN, 100000], [JAN, 50000]]);
  assert.equal((await H.bayarCell(app, h.kode, 0)).className, 'cell paid');
});

test('BAYAR-04 paid months are disabled in the form', async () => {
  const app = await admin(); const h = await H.newHouse(app);
  const f = await H.iuranForm(app, h);
  await H.submit(app, f);
  await H.iuranForm(app, h);
  const jan = H.monthBtn(app, JAN);
  assert.equal(jan.disabled, true);
  assert.match(jan.textContent, /✓/);
});

async function payTwoMonths(app, h) {
  const f = await H.iuranForm(app, h);
  H.monthBtn(app, FEB).click(); await H.tick(30);
  await H.submit(app, f);
  return (await app.w.DB.list('transaksi')).find(t => t.rumah_id === h.id);
}
async function riwayatRow(app, h) {
  await H.reopen(app, 'riwayat');
  const q = app.$('#fQ'); q.value = h.kode; await H.fire(app, q, 'change', 60);
  return app.$$('#view tbody tr').find(tr => tr.textContent.includes(h.kode));
}

test('BAYAR-05 editing an iuran replaces its month rows', async () => {
  const app = await admin(); const h = await H.newHouse(app);
  await payTwoMonths(app, h);
  (await riwayatRow(app, h)).querySelector('[data-edit]').click(); await H.tick(60);
  H.monthBtn(app, FEB).click(); await H.tick(30);
  const f = app.$('#editBox #trxForm');
  assert.equal(f.nilai.value, '150.000');
  await H.submit(app, f);
  assert.equal(H.toastText(app), 'Perubahan disimpan');
  assert.deepEqual(await ibOf(app, h), [[JAN, 150000]]);
  const t = (await app.w.DB.list('transaksi')).filter(x => x.rumah_id === h.id);
  assert.equal(t.length, 1); assert.equal(Number(t[0].nilai), 150000);
});

test('BAYAR-06 deleting an iuran makes its months unpaid again', async () => {
  const app = await admin(); const h = await H.newHouse(app);
  await payTwoMonths(app, h);
  (await riwayatRow(app, h)).querySelector('[data-del]').click();
  await H.confirmAsk(app); await H.tick(100);
  assert.deepEqual(await ibOf(app, h), []);
  assert.equal((await H.bayarCell(app, h.kode, 0)).className, 'cell unpaid');
});

test('BAYAR-10 WhatsApp reminder link uses +62 and lists the unpaid months', async () => {
  const app = await admin(); const h = await H.newHouse(app);
  await app.w.DB.upsert('rumah_rekening', [{ rumah_id: h.id, bank: '', nama_rekening: '', no_hp: '0812-3456' }]);
  await H.reopen(app, 'bayar');
  const a = app.$$('table.matrix tbody tr').find(tr => tr.textContent.includes(h.kode)).querySelector('a[href*="wa.me"]');
  assert.match(a.href, /^https:\/\/wa\.me\/628123456\?text=/);
  assert.match(decodeURIComponent(a.href), new RegExp(`- Januari ${Y}`));
  assert.equal(a.rel, 'noopener');
});

// Regression test for OBS-2 (fixed in 749682f)
test('BAYAR-08 a house with IPL 0 is not listed as in arrears', async () => {
  const app = await admin(); const h = await H.newHouse(app, 0);
  await H.reopen(app, 'bayar');
  const row = app.$$('table.matrix tbody tr').find(tr => tr.textContent.includes(h.kode));
  assert.equal(row.querySelector('a[href*="wa.me"]'), null);
  assert.ok(![...row.querySelectorAll('td.cell')].some(c => c.classList.contains('unpaid')));
});

// Regression test for OBS-5 (fixed in 749682f)
test('BAYAR-09 a negative partial payment gets a validation message', async () => {
  const app = await admin(); const h = await H.newHouse(app);
  const errors = []; const onRej = e => errors.push(e); process.on('unhandledRejection', onRej);
  const f = await H.iuranForm(app, h);
  app.$('#sebagian').checked = true; await H.fire(app, app.$('#sebagian'));
  f.nilai.value = '-50.000';
  await H.submit(app, f, 200);
  process.off('unhandledRejection', onRej);
  assert.deepEqual(errors, []);
  assert.equal(H.toastText(app), 'Nilai harus lebih dari 0.');
});

// Regression test for OBS-4 (fixed in 749682f): the master form refuses what the database now rejects
test('BAYAR-11 Master Data refuses a negative IPL', async () => {
  const app = await admin(); const h = await H.newHouse(app);
  await H.reopen(app, 'master');
  app.$(`[data-edit="${h.id}"]`).click(); await H.tick(60);
  const f = app.$('#mForm'); f.ipl.value = '-5'; await H.fire(app, f.ipl);
  await H.submit(app, f);
  assert.equal(H.toastText(app), 'IPL per bulan tidak boleh negatif.');
  assert.equal(Number((await app.w.DB.list('rumah')).find(r => r.id === h.id).ipl), 150000);
});
