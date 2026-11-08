// Partner salary payout (Pencairan), kasbon and debt instalments (admin, demo mode).
// Each test deactivates the seeded partners and adds its own, so amounts don't depend on today's date.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../helpers/app');

const M = H.curYM();
async function setup({ jenis = 'bulanan', gaji = 1000000, cicilan = [] } = {}) {
  const app = await H.boot('admin.html'); await H.login(app);
  const DB = app.w.DB;
  for (const m of await DB.list('mitra')) await DB.update('mitra', m.id, { aktif: false });
  const mitra = { id: 'm-uji', nama: 'Pak Uji', posisi: 'Satpam', jenis_gaji: jenis, gaji_pokok: gaji, aktif: true, tgl_resign: null };
  await DB.insert('mitra', mitra);
  for (const [i, n] of cicilan.entries()) await DB.insert('hutang_mitra', { id: 'h-uji-' + i, mitra_id: mitra.id, keterangan: 'Cicilan uji', bulan: M, cicilan_ke: i + 1, nominal: n, lunas: false, transaksi_id: null });
  return { app, DB, mitra };
}
async function pencairan(app, tahap) {
  await H.reopen(app, 'gaji');
  const sel = app.$('#pTahap');
  if (tahap && sel.value !== tahap) { sel.value = tahap; await H.fire(app, sel, 'change', 60); }
  return app.$('[data-amt="m-uji"]');
}
async function cair(app) { app.$('#doCair').click(); await H.confirmAsk(app); await H.tick(150); }
const gajiTx = async (DB, komponen) => (await DB.list('transaksi')).filter(t => t.mitra_id === 'm-uji' && t.komponen === komponen && t.bulan === M);

test('GAJI-01 mid-month payout defaults to half the salary rounded to 50.000', async () => {
  const { app, DB } = await setup({ gaji: 1525000 });
  const amt = await pencairan(app, 'tengah');
  assert.equal(amt.value, '750.000');
  await cair(app);
  const t = await gajiTx(DB, 'gaji_tengah');
  assert.equal(t.length, 1); assert.equal(Number(t[0].nilai), 750000);
});

test('GAJI-02 end-of-month payout deducts mid-month pay and the instalment, and marks it paid', async () => {
  const { app, DB } = await setup({ cicilan: [200000] });
  await pencairan(app, 'tengah'); await cair(app);
  const amt = await pencairan(app, 'akhir');
  assert.equal(amt.value, '300.000');
  await cair(app);
  const [t] = await gajiTx(DB, 'gaji');
  assert.equal(Number(t.nilai), 300000);
  assert.match(t.keterangan, /potong cicilan Rp200\.000/);
  const h = await DB.list('hutang_mitra');
  assert.deepEqual(JSON.parse(JSON.stringify(h.filter(x => x.id === 'h-uji-0').map(x => [x.lunas, x.transaksi_id]))), [[true, t.id]]);
});

test('GAJI-03 an instalment larger than the remaining salary is not deducted', async () => {
  const { app } = await setup({ cicilan: [800000] });
  await pencairan(app, 'tengah'); await cair(app);
  const amt = await pencairan(app, 'akhir');
  assert.equal(amt.value, '500.000');
  assert.match(app.$('#pcrBox').textContent, /Gaji tidak cukup, cicilan bulan ini tidak dipotong\./);
});

test('GAJI-04 per-visit pay covers only the ticked visits and locks them', async () => {
  const { app, DB } = await setup({ jenis: 'kedatangan', gaji: 800000 });
  await pencairan(app);
  for (let i = 0; i < 3; i++) { app.$('[data-vplus="m-uji"]').click(); await H.tick(120); }
  const third = app.$$('[data-visit]').find(c => c.closest('.visit').textContent.includes('ke-3'));
  third.checked = false; await H.fire(app, third, 'change', 60);
  assert.equal(app.$('[data-amt="m-uji"]').value, '1.600.000');
  await cair(app);
  const [t] = await gajiTx(DB, 'gaji');
  assert.equal(Number(t.nilai), 1600000);
  const v = (await DB.list('kedatangan_mitra')).filter(x => x.mitra_id === 'm-uji').sort((a, b) => a.ke - b.ke);
  assert.deepEqual(JSON.parse(JSON.stringify(v.map(x => x.transaksi_id === t.id))), [true, true, false]);
});

test('GAJI-05 deleting a payout puts the instalment back to unpaid', async () => {
  const { app, DB } = await setup({ cicilan: [200000] });
  await pencairan(app, 'akhir'); await cair(app);
  await H.reopen(app, 'riwayat');
  const q = app.$('#fQ'); q.value = 'Pak Uji'; await H.fire(app, q, 'change', 60);
  app.$('#view tbody [data-del]').click(); await H.confirmAsk(app); await H.tick(150);
  const h = (await DB.list('hutang_mitra')).find(x => x.id === 'h-uji-0');
  assert.equal(h.lunas, false); assert.equal(h.transaksi_id, null);
  assert.equal((await gajiTx(DB, 'gaji')).length, 0);
});

async function kasbon(app, mitraId) {
  await H.reopen(app, 'hutang');
  app.$('#addPlan').click(); await H.tick(40);
  const f = app.$('#hp');
  f.mitra_id.value = mitraId; f.total.value = '900.000'; f.n.value = '3'; f.mulai.value = '2026-12'; f.tanggal.value = '2026-11-05';
  await H.submit(app, f);
}

test('GAJI-06 a 900.000 kasbon in 3 instalments creates 3 expenses and 3 instalments', async () => {
  const { app, DB } = await setup();
  await kasbon(app, 'm-uji');
  const h = (await DB.list('hutang_mitra')).filter(x => x.mitra_id === 'm-uji').sort((a, b) => a.bulan.localeCompare(b.bulan));
  assert.deepEqual(JSON.parse(JSON.stringify(h.map(x => [x.bulan, x.nominal, x.lunas]))), [['2026-12', 300000, false], ['2027-01', 300000, false], ['2027-02', 300000, false]]);
  const tx = (await DB.list('transaksi')).filter(t => /Pinjaman\/dibayar dimuka ke Pak Uji/.test(t.keterangan));
  assert.deepEqual(JSON.parse(JSON.stringify(tx.map(t => [t.tanggal, t.bulan, t.nilai]).sort())), [['2026-11-05', '2026-12', 300000], ['2026-11-05', '2027-01', 300000], ['2026-11-05', '2027-02', 300000]]);
});

// Regression test for DEF-002 (fixed in 749682f)
test('GAJI-07 deleting a kasbon removes its instalments from future salary', async () => {
  const { app, DB } = await setup();
  await kasbon(app, 'm-uji');
  await H.reopen(app, 'riwayat');
  const q = app.$('#fQ'); q.value = 'Pinjaman/dibayar dimuka ke Pak Uji'; await H.fire(app, q, 'change', 60);
  app.$('#selAll').checked = true; await H.fire(app, app.$('#selAll'), 'change', 60);
  app.$('#selDel').click();
  await H.waitFor(() => app.$('.ask-msg'));
  assert.match(app.$('.ask-msg').textContent, /3 cicilan kasbon yang belum lunas \(total Rp900\.000\) juga akan dihapus/);
  await H.confirmAsk(app); await H.tick(200);
  assert.equal((await DB.list('transaksi')).filter(t => /Pinjaman\/dibayar dimuka ke Pak Uji/.test(t.keterangan)).length, 0);
  assert.equal((await DB.list('hutang_mitra')).filter(h => h.mitra_id === 'm-uji').length, 0);
  const pot = (await DB.rpc('potongan_gaji')).filter(p => p.mitra_id === 'm-uji');
  assert.equal(pot.length, 0, `still deducted: ${JSON.stringify(pot)}`);
});

test('GAJI-08 an instalment paid outside salary stops counting as a deduction', async () => {
  const { app, DB } = await setup();
  await DB.insert('hutang_mitra', { id: 'h-sep', mitra_id: 'm-uji', keterangan: 'Pinjaman lain', bulan: M, cicilan_ke: 1, nominal: 100000, lunas: true, transaksi_id: null });
  assert.equal((await DB.rpc('potongan_gaji')).filter(p => p.mitra_id === 'm-uji').length, 1);
  await H.reopen(app, 'hutang');
  const cb = app.$('#hLunas'); cb.checked = true; await H.fire(app, cb, 'change', 60);
  app.$('[data-terpisah="h-sep"]').click(); await H.tick(120);
  assert.equal((await DB.list('hutang_mitra')).find(x => x.id === 'h-sep').bayar_terpisah, true);
  assert.equal((await DB.rpc('potongan_gaji')).filter(p => p.mitra_id === 'm-uji').length, 0);
});
