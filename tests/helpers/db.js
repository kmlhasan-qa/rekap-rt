// Throwaway PostgreSQL for schema/RLS tests. Never points at Supabase.
// Uses an existing local server when REKAP_PG_PORT is set (127.0.0.1, user postgres, trust auth);
// otherwise creates a temporary cluster with initdb on a free TCP port and removes it afterwards.
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const ROOT = path.resolve(__dirname, '..', '..');
const env = { ...process.env, LANG: 'C', LC_ALL: 'C' };

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });

async function startDb(name = 'rekap_test') {
  let port = process.env.REKAP_PG_PORT, dataDir = null;
  if (!port) {
    port = String(await freePort());
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rekap-pg-'));
    execFileSync('initdb', ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '--no-locale'], { env, stdio: 'ignore' });
    execFileSync('pg_ctl', ['-D', dataDir, '-o', `-p ${port} -c unix_socket_directories='' -c listen_addresses=127.0.0.1`, '-l', path.join(dataDir, 'log'), '-w', 'start'], { env, stdio: 'ignore' });
  }
  const base = ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-tA'];
  const psql = (db, args, input) => spawnSync('psql', [...base, '-d', db, ...args], { env, input, encoding: 'utf8' });
  psql('postgres', ['-c', `drop database if exists ${name}`, '-c', `create database ${name}`]);
  for (const f of [path.join(__dirname, 'supabase_stub.sql'), path.join(ROOT, 'schema.sql'), path.join(__dirname, 'seed.sql')]) {
    const r = psql(name, ['-f', f]);
    if (r.status !== 0) throw new Error(`loading ${path.basename(f)} failed: ${r.stderr}`);
  }
  const db = {
    port, name,
    // Runs SQL inside a transaction that is always rolled back. `as` = 'anon' or a seeded user key.
    query(sql, { as } = {}) {
      const who = as == null ? '' : as === 'anon' ? 'set local role anon;\n'
        : `set local role authenticated;\nset local request.jwt.claim.sub = '${USERS[as]}';\n`;
      const r = psql(name, [], `begin;\n${who}${sql}\nrollback;\n`);
      return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr.trim() };
    },
    // Raw psql calls (no transaction wrapper, changes persist), e.g. to re-run schema.sql
    file(f) { const r = psql(name, ['-f', f]); return { ok: r.status === 0, err: r.stderr.trim() }; },
    raw(sql) { const r = psql(name, [], sql); return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr.trim() }; },
    stop() {
      if (dataDir) { spawnSync('pg_ctl', ['-D', dataDir, '-m', 'fast', 'stop'], { env, stdio: 'ignore' }); fs.rmSync(dataDir, { recursive: true, force: true }); }
      else psql('postgres', ['-c', `drop database if exists ${name}`]);
    },
  };
  return db;
}

const USERS = {
  admin: '00000000-0000-0000-0000-00000000000a',
  viewer: '00000000-0000-0000-0000-00000000000b',
  warga: '00000000-0000-0000-0000-00000000000c',
  inactive: '00000000-0000-0000-0000-00000000000d',
  newuser: '00000000-0000-0000-0000-00000000000e',
};
const TABLES = ['profiles', 'pengaturan', 'rumah', 'rumah_rekening', 'kategori', 'dompet', 'mitra', 'transaksi', 'iuran_bulan', 'hutang_mitra', 'kedatangan_mitra', 'catatan', 'audit_log'];

module.exports = { startDb, USERS, TABLES };
