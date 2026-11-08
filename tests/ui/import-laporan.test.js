// CSV import (Impor / Ekspor) and report rules (demo mode).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../helpers/app');

async function admin() { const app = await H.boot('admin.html'); await H.login(app); return app; }
const HEAD = 'Timestamp,Tipe Transaksi,Tanggal Bayar,Jenis Bayar,Nama & Nomer Rumah,Jumlah Transfer,Bulan Bayar,x,Tanggal,Keterangan,Nilai,Kategori,y,Bulan,Dibayar dari';
async function importCsv(app, lines) {
  const csv = [HEAD, ...lines].join('\n');
  await H.reopen(app, 'impor');
  const inp = app.$('#csvFile');
  const file = new app.w.File([csv], 'data.csv', { type: 'text/csv' });
  file.text = async () => csv; // jsdom's File has no text()
  Object.defineProperty(inp, 'files', { value: [file] });
  await H.fire(app, inp, 'change', 150);
  app.$('#doImp').click(); await H.tick(300);
  const DB = app.w.DB, rumah = (await DB.list('rumah')).find(r => r.kode === 'KB9/77');
  return {
    rumah,
    iuran: [...(await DB.list('transaksi')).filter(t => rumah && t.rumah_id === rumah.id).map(t => Number(t.nilai))],
    bulan: JSON.parse(JSON.stringify((await DB.list('iuran_bulan')).filter(b => rumah && b.rumah_id === rumah.id).map(b => [b.bulan, Number(b.nominal)]).sort())),
    keluar: [...(await DB.list('transaksi')).filter(t => t.keterangan === 'Listrik impor').map(t => Number(t.nilai))],
  };
}

test('IMP-02 CSV with plain numbers splits dues over the listed months', async () => {
  const app = await admin();
  const r = await importCsv(app, [
    '01/10/2026 08:00:00,Pemasukan,01/10/2026,Transfer,KB9/77 - Warga Impor,150000,"Oktober 2026, November 2026",,,,,,,,',
    '02/10/2026 08:00:00,Pengeluaran,,,,,,,02/10/2026,Listrik impor,275500,Lainnya,,Oktober 2026,Transfer',
  ]);
  assert.deepEqual(r.iuran, [150000]);
  assert.deepEqual(r.bulan, [['2026-10', 75000], ['2026-11', 75000]]);
  assert.deepEqual(r.keluar, [275500]);
});

// Regression test for DEF-001 (fixed in 749682f)
test('IMP-01 CSV with Rupiah-formatted amounts imports the real amounts', async () => {
  const app = await admin();
  const r = await importCsv(app, [
    '01/10/2026 08:00:00,Pemasukan,01/10/2026,Transfer,KB9/77 - Warga Impor,"Rp150.000",Oktober 2026,,,,,,,,',
    '02/10/2026 08:00:00,Pengeluaran,,,,,,,02/10/2026,Listrik impor,"Rp275.500",Lainnya,,Oktober 2026,Transfer',
  ]);
  assert.deepEqual(r.iuran, [150000]);
  assert.equal(Number(r.rumah.ipl), 150000);
  assert.deepEqual(r.keluar, [275500]);
});

test('LAP-01 Ringkasan counts dues in the month they are for, not the payment month', async () => {
  const app = await admin();
  const prev = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
  if (prev.slice(0, 4) !== String(H.curY())) return; // January: previous month is in another year's report
  const masuk = async ym => {
    await H.reopen(app, 'dashboard');
    const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const label = `${BULAN[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`;
    const row = app.$$('.table-wrap.desk-only tbody tr').find(tr => tr.cells[0].textContent.startsWith(label));
    return row ? H.rpNum(row.cells[1].textContent) : 0;
  };
  const before = { prev: await masuk(prev), cur: await masuk(H.curYM()) };
  const h = await H.newHouse(app);
  const f = await H.iuranForm(app, h);
  for (const b of app.$$('#monthsBox button.sel')) b.click(); await H.tick(30);
  app.$(`#monthsBox button[data-m="${prev}"]`).click(); await H.tick(30);
  f.tanggal.value = `${H.curYM()}-01`;
  await H.submit(app, f);
  assert.equal(await masuk(prev), before.prev + 150000);
  assert.equal(await masuk(H.curYM()), before.cur);
});

test('LAP-02 residents see a partially paid month as paid (by design)', async () => {
  const app = await admin(); const h = await H.newHouse(app);
  const f = await H.iuranForm(app, h);
  app.$('#sebagian').checked = true; await H.fire(app, app.$('#sebagian'));
  f.nilai.value = '100.000'; await H.submit(app, f);
  assert.equal((await H.bayarCell(app, h.kode, 0)).className, 'cell partial');
  const stored = app.w.localStorage.getItem('rekap-rt-demo-v5');
  const res = await H.boot('index.html', { seed: w => w.localStorage.setItem('rekap-rt-demo-v5', stored) });
  await H.login(res);
  assert.equal((await H.bayarCell(res, h.kode, 0)).className, 'cell paid');
});
