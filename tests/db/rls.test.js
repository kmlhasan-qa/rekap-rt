// Row Level Security, RPC grants and audit behaviour of schema.sql, on a throwaway Postgres.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startDb, TABLES } = require('../helpers/db');

let db;
before(async () => { db = await startDb('rekap_rls'); });
after(() => db && db.stop());

const counts = as => {
  const sql = TABLES.map(t => `select '${t}', count(*) from public.${t};`).join('\n');
  const r = db.query(sql, { as });
  assert.ok(r.ok, r.err);
  return Object.fromEntries(r.out.split('\n').map(l => { const [t, n] = l.split('|'); return [t, +n]; }));
};
const affected = (sql, as) => db.query(`with x as (${sql} returning 1) select count(*) from x;`, { as });

test('DB-01 anon reads 0 rows from every table', () => {
  const c = counts('anon');
  for (const t of TABLES) assert.equal(c[t], 0, `${t} visible to anon`);
});

test('DB-02 warga reads report tables only, and only its own profile', () => {
  const c = counts('warga');
  for (const t of ['rumah', 'kategori', 'dompet', 'mitra', 'transaksi', 'iuran_bulan', 'pengaturan']) assert.ok(c[t] > 0, `${t} should be readable`);
  for (const t of ['rumah_rekening', 'hutang_mitra', 'kedatangan_mitra', 'catatan', 'audit_log']) assert.equal(c[t], 0, `${t} leaked to warga`);
  assert.equal(c.profiles, 1);
});

test('DB-03 warga cannot insert, update or delete', () => {
  const ins = db.query(`insert into transaksi(tipe,tanggal,nilai,dompet_id) select 'pemasukan','2026-11-02',1,id from dompet limit 1;`, { as: 'warga' });
  assert.equal(ins.ok, false);
  assert.match(ins.err, /row-level security/);
  assert.equal(affected('update transaksi set nilai = 1', 'warga').out, '0');
  assert.equal(affected('delete from rumah', 'warga').out, '0');
});

test('DB-04 warga cannot promote itself or create an admin profile', () => {
  assert.equal(affected(`update profiles set role = 'admin' where id = auth.uid()`, 'warga').out, '0');
  const ins = db.query(`insert into profiles(id,email,role) values ('00000000-0000-0000-0000-0000000000ff','x@example.com','admin');`, { as: 'warga' });
  assert.equal(ins.ok, false);
  assert.match(ins.err, /row-level security/);
});

test('DB-05 viewer reads everything but writes nothing', () => {
  const c = counts('viewer');
  for (const t of TABLES.filter(t => t !== 'kedatangan_mitra')) assert.ok(c[t] > 0, `${t} should be readable by viewer`);
  assert.equal(affected('update transaksi set nilai = 1', 'viewer').out, '0');
  assert.equal(affected('delete from catatan', 'viewer').out, '0');
});

test('DB-06 deactivated user reads nothing but its own profile', () => {
  const c = counts('inactive');
  for (const t of TABLES.filter(t => t !== 'profiles')) assert.equal(c[t], 0, `${t} visible to inactive user`);
});

test('AUTH-07 a freshly created auth user becomes an active warga (why sign-up must stay disabled)', () => {
  const r = db.query(`select role || '/' || aktif from profiles where email = 'newuser@example.com';`);
  assert.equal(r.out, 'warga/true');
  assert.ok(counts('newuser').transaksi > 0);
});

test('DB-07 / DB-14 anon cannot execute the aggregate RPCs', () => {
  for (const fn of ['potongan_gaji', 'kedatangan_bulan']) {
    const r = db.query(`select count(*) from ${fn}();`, { as: 'anon' });
    assert.equal(r.ok, false, `${fn} executable by anon`);
    assert.match(r.err, new RegExp(`permission denied for function ${fn}`));
  }
});

// Regression test for OBS-7 (fixed in 749682f): residents learn only which months have a deduction
test('DB-11 residents cannot read partners\' debt instalments', () => {
  const warga = db.query(`select bulan || ':' || coalesce(nominal::text, 'null') from potongan_gaji();`, { as: 'warga' });
  assert.ok(warga.ok, warga.err);
  assert.equal(warga.out, '2026-11:null');
  assert.equal(db.query('select nominal from potongan_gaji();', { as: 'admin' }).out, '300000.00');
  assert.equal(db.query('select nominal from potongan_gaji();', { as: 'viewer' }).out, '300000.00');
  assert.equal(db.query('select jumlah from kedatangan_bulan();', { as: 'warga' }).out, '1');
});

test('AUD-03 settings, bank details and categories are audited', { todo: 'OBS-9: pengaturan, rumah_rekening and kategori have no audit trigger' }, () => {
  const r = db.query(`
    update pengaturan set value = '2025-01' where key = 'mulai_tagih';
    insert into pengaturan values ('ipl_riwayat', '{}') on conflict (key) do update set value = excluded.value;
    update rumah_rekening set no_hp = '0899';
    update kategori set nama = nama || ' x' where urutan = 9;
    select string_agg(distinct tabel, ',' order by tabel) from audit_log where tabel in ('pengaturan', 'rumah_rekening', 'kategori');`, { as: 'admin' });
  assert.ok(r.ok, r.err);
  assert.equal(r.out.split('\n').pop(), 'kategori,pengaturan,rumah_rekening');
});

test('DB-13 schema.sql upgrade tolerates old rows that break the new constraints', () => {
  // Simulate a pre-749682f row: drop the constraint, insert a mutasi without target, then re-run schema.sql
  const psqlRaw = sql => db.raw(sql);
  assert.ok(psqlRaw(`alter table transaksi drop constraint transaksi_mutasi_tujuan;
    insert into transaksi(id,tipe,tanggal,nilai,dompet_id) select '30000000-0000-0000-0000-0000000000d1','mutasi','2025-01-01',1000,id from dompet limit 1;`).ok);
  const rerun = db.file(path.resolve(__dirname, '..', '..', 'schema.sql'));
  try {
    assert.ok(rerun.ok, rerun.err);
    assert.match(rerun.err, /Ada data lama di transaksi yang melanggar transaksi_mutasi_tujuan/);
    assert.equal(db.query(`select convalidated from pg_constraint where conname = 'transaksi_mutasi_tujuan';`).out, 'f');
    // New bad rows are still rejected, and the old row cannot be edited until it is corrected
    assert.equal(db.query(`insert into transaksi(tipe,tanggal,nilai,dompet_id) select 'mutasi','2026-11-03',1000,id from dompet limit 1;`, { as: 'admin' }).ok, false);
    const edit = db.query(`update transaksi set keterangan = 'koreksi' where id = '30000000-0000-0000-0000-0000000000d1';`, { as: 'admin' });
    assert.match(edit.err, /violates check constraint "transaksi_mutasi_tujuan"/);
  } finally {
    psqlRaw(`delete from transaksi where id = '30000000-0000-0000-0000-0000000000d1';`);
    db.file(path.resolve(__dirname, '..', '..', 'schema.sql'));
  }
});

test('DB-08 audit log cannot be changed or deleted, even by admin', () => {
  assert.equal(affected(`update audit_log set aksi = 'X'`, 'admin').out, '0');
  assert.equal(affected('delete from audit_log', 'admin').out, '0');
});

test('DB-09 schema.sql can be re-run on an existing database', () => {
  const r = db.file(path.resolve(__dirname, '..', '..', 'schema.sql'));
  assert.ok(r.ok, r.err);
  assert.equal(db.query('select count(*) from transaksi;').out, '1');
});

test('AUD-01 insert, update and delete of transaksi are audited', () => {
  const r = db.query(`
    insert into transaksi(id,tipe,tanggal,nilai,dompet_id) select '30000000-0000-0000-0000-0000000000a1','pemasukan','2026-11-05',1000,id from dompet limit 1;
    update transaksi set nilai = 2000 where id = '30000000-0000-0000-0000-0000000000a1';
    delete from transaksi where id = '30000000-0000-0000-0000-0000000000a1';
    select string_agg(aksi, ',' order by id) from audit_log where coalesce(data_baru, data_lama)->>'id' = '30000000-0000-0000-0000-0000000000a1';`, { as: 'admin' });
  assert.ok(r.ok, r.err);
  assert.equal(r.out.split('\n').pop(), 'INSERT,UPDATE,DELETE');
});

// Regression test for OBS-1 (fixed in 749682f)
test('AUD-02 balance-affecting changes outside transaksi are audited', () => {
  const r = db.query(`
    update dompet set saldo_awal = saldo_awal + 10000000;
    update iuran_bulan set nominal = 1;
    update hutang_mitra set lunas = true;
    select count(*) from audit_log where tabel <> 'transaksi';`, { as: 'admin' });
  assert.ok(r.ok, r.err);
  assert.ok(+r.out.split('\n').pop() >= 3);
});

test('transaksi.nilai rejects negative amounts', () => {
  const r = db.query(`insert into transaksi(tipe,tanggal,nilai,dompet_id) select 'pemasukan','2026-11-03',-1000,id from dompet limit 1;`, { as: 'admin' });
  assert.equal(r.ok, false);
  assert.match(r.err, /transaksi_nilai_check/);
});

const mustReject = (label, sql) => {
  const r = db.query(sql, { as: 'admin' });
  assert.equal(r.ok, false, `${label} was accepted`);
};
// Regression test for OBS-4 (fixed in 749682f)
test('DB-10 constraints reject inconsistent rows', () => {
  mustReject('negative iuran_bulan.nominal', `insert into iuran_bulan(transaksi_id,rumah_id,bulan,nominal) values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','2026-12',-150000);`);
  mustReject('negative hutang nominal', `insert into hutang_mitra(mitra_id,bulan,nominal) values ('20000000-0000-0000-0000-000000000001','2026-12',-1);`);
  mustReject('negative rumah.ipl', `update rumah set ipl = -5;`);
  mustReject('mutasi to same wallet', `insert into transaksi(tipe,tanggal,nilai,dompet_id,dompet_tujuan_id) select 'mutasi','2026-11-03',1000,id,id from dompet limit 1;`);
  mustReject('mutasi without target', `insert into transaksi(tipe,tanggal,nilai,dompet_id) select 'mutasi','2026-11-03',1000,id from dompet limit 1;`);
  mustReject('iuran without rumah', `insert into transaksi(tipe,tanggal,nilai,dompet_id) select 'iuran','2026-11-03',1000,id from dompet limit 1;`);
  mustReject('month 2026-13', `insert into transaksi(tipe,tanggal,nilai,dompet_id,bulan) select 'pemasukan','2026-11-03',1000,id,'2026-13' from dompet limit 1;`);
});
