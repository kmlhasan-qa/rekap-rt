// Roles and entry pages, in demo mode (jsdom). Server-side enforcement is covered by db/rls.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../helpers/app');

const navText = app => app.$$('#nav a, #nav .nav-group').map(e => e.textContent);

test('AUTH-01 admin lands on Input Transaksi with the Admin menu', async () => {
  const app = await H.boot('admin.html');
  await H.login(app);
  assert.equal(app.$('#pageTitle').textContent, 'Input Transaksi');
  assert.ok(navText(app).includes('Admin'));
  assert.match(app.$('#userInfo').textContent, /Admin$/);
});

test('AUTH-02 a warga session cannot open the admin page', async () => {
  const app = await H.boot('admin.html', { seed: H.asRole('warga') });
  await H.tick(50);
  assert.equal(app.$('#app').classList.contains('hidden'), true);
  assert.match(app.$('#loginError').textContent, /Anda sedang masuk sebagai warga/);
});

test('AUTH-03 an admin on the resident page gets the resident view', async () => {
  const app = await H.boot('index.html', { seed: H.asRole('admin') });
  await H.waitFor(() => app.$('#nav a'));
  assert.ok(!navText(app).includes('Admin'));
  assert.ok(!navText(app).includes('Input Transaksi'));
  assert.match(app.$('#userInfo').textContent, /Warga · lihat saja/);
  await H.go(app, 'bayar');
  assert.equal(app.$('.legend .l-partial'), null);
});

test('AUTH-04 viewer on the admin page is read-only', async () => {
  const app = await H.boot('admin.html', { seed: H.asRole('viewer') });
  await H.waitFor(() => app.$('#nav a'));
  assert.match(app.$('#userInfo').textContent, /Admin · lihat saja/);
  assert.ok(!navText(app).includes('Input Transaksi'));
  assert.ok(!navText(app).includes('Akun Pengguna'));
  assert.ok(navText(app).includes('Riwayat Transaksi'));
  await assert.rejects(app.w.DB.insert('catatan', { isi: 'x' }), /view only/);
});

test('LAP-04 residents see salary totals without paid/unpaid or debt columns', async () => {
  const app = await H.boot('index.html');
  await H.login(app);
  await H.go(app, 'gaji');
  const heads = [...new Set(app.$$('#view thead th').map(th => th.textContent))];
  assert.deepEqual(heads.filter(h => h !== 'Mitra' && h !== 'Bulan'), ['Gaji pokok', 'Lembur & lainnya', 'Total']);
  assert.doesNotMatch(app.$('#view').textContent, /Belum terbayar|Sudah terbayar/);
});
