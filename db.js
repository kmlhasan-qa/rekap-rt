// Lapisan data: Supabase (produksi) atau Demo (data contoh di browser).
(function () {
  const cfg = window.APP_CONFIG || {};
  const TABLES = ['pengaturan', 'rumah', 'rumah_rekening', 'kategori', 'dompet', 'mitra',
    'transaksi', 'iuran_bulan', 'hutang_mitra', 'kedatangan_mitra', 'catatan'];
  const KEYS = { pengaturan: 'key', rumah_rekening: 'rumah_id' };
  const keyOf = t => KEYS[t] || 'id';

  // ------------------------------------------------------------------
  // Supabase
  // ------------------------------------------------------------------
  function supabaseAdapter() {
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    const chk = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
    return {
      demo: false,
      TABLES,
      async session() {
        const { data } = await sb.auth.getSession();
        return data.session ? await this._profile(data.session.user) : null;
      },
      async _profile(user) {
        const rows = chk(await sb.from('profiles').select('*').eq('id', user.id));
        const p = rows[0];
        if (!p) throw new Error('Profil tidak ditemukan. Hubungi admin.');
        if (!p.aktif) { await sb.auth.signOut(); throw new Error('Akun Anda dinonaktifkan.'); }
        return { id: user.id, email: user.email, nama: p.nama || user.email, role: p.role };
      },
      async signIn(email, password) {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email atau password salah.' : error.message);
        return this._profile(data.user);
      },
      async signOut() { await sb.auth.signOut(); },
      async list(t, opts = {}) {
        let all = [], from = 0;
        for (;;) {
          let q = sb.from(t).select('*');
          if (opts.order) q = q.order(opts.order, { ascending: !opts.desc });
          if (opts.limit) { q = q.limit(opts.limit); return chk(await q); }
          const rows = chk(await q.range(from, from + 999));
          all = all.concat(rows);
          if (rows.length < 1000) return all;
          from += 1000;
        }
      },
      async insert(t, rows) {
        const arr = Array.isArray(rows) ? rows : [rows];
        let out = [];
        for (let i = 0; i < arr.length; i += 500) out = out.concat(chk(await sb.from(t).insert(arr.slice(i, i + 500)).select()));
        return out;
      },
      async upsert(t, rows) {
        return chk(await sb.from(t).upsert(rows, { onConflict: keyOf(t) }).select());
      },
      async update(t, id, patch) {
        return chk(await sb.from(t).update(patch).eq(keyOf(t), id).select())[0];
      },
      async remove(t, id) { chk(await sb.from(t).delete().eq(keyOf(t), id)); },
      async rpc(name) { return chk(await sb.rpc(name)) || []; },
      async removeWhere(t, col, val) { chk(await sb.from(t).delete().eq(col, val)); },
    };
  }

  // ------------------------------------------------------------------
  // Demo (localStorage)
  // ------------------------------------------------------------------
  function demoAdapter() {
    const LS = 'rekap-rt-demo-v5';
    let db;
    const save = () => { try { localStorage.setItem(LS, JSON.stringify(db)); } catch (e) { /* abaikan */ } };
    const load = () => { try { const s = localStorage.getItem(LS); return s ? JSON.parse(s) : null; } catch (e) { return null; } };
    const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id' + Math.random().toString(36).slice(2) + Date.now());
    db = load() || seed();
    save();
    let me = null;
    const audit = (aksi, lama, baru) => {
      db.audit_log.unshift({ id: Date.now() + Math.random(), waktu: new Date().toISOString(), user_id: me && me.id, aksi, tabel: 'transaksi', data_lama: lama, data_baru: baru });
      db.audit_log = db.audit_log.slice(0, 500);
    };
    const adminOnly = ['rumah_rekening', 'hutang_mitra', 'kedatangan_mitra', 'catatan', 'audit_log', 'profiles'];
    const guard = () => { if (!me || me.role !== 'admin') throw new Error('Hanya admin yang boleh mengubah data.'); };

    function seed() {
      const d = { profiles: [], audit_log: [] };
      TABLES.forEach(t => d[t] = d[t] || []);
      let r = 7; const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
      const now = new Date(); const yr = now.getFullYear(); const curM = now.getMonth() + 1;
      const ym = m => yr + '-' + String(m).padStart(2, '0');
      const day = (m, dd) => ym(m) + '-' + String(dd).padStart(2, '0');
      d.pengaturan = [{ key: 'nama_rt', value: 'Rekap Keuangan RT (Demo)' }, { key: 'mulai_tagih', value: ym(1) }];
      d.profiles = [
        { id: 'u-admin', email: 'admin@demo', nama: 'Admin (Demo)', role: 'admin', aktif: true, created_at: new Date().toISOString() },
        { id: 'u-warga', email: 'warga@demo', nama: 'Warga (Demo)', role: 'warga', aktif: true, created_at: new Date().toISOString() },
      ];
      const kat = ['Operasional - Gaji, THR, Kasbon Mitra', 'Operasional - Lembur Mitra', 'Operasional - Listrik, Air, Pulsa, Internet, Galon, dll',
        'Operasional - Biaya Admin, Pajak, dll', 'Maintenance Aset, Pemeliharaan Taman, Cluster, dll', 'Lainnya'];
      d.kategori = kat.map((n, i) => ({ id: 'k' + i, nama: n, urutan: i + 1 }));
      d.dompet = [
        { id: 'w-rek', nama: 'Kas Mandiri Sherwood', jenis: 'rekening', saldo_awal: 40000000, aktif: true },
        { id: 'w-krom', nama: 'Kas Krom Sherwood', jenis: 'rekening', saldo_awal: 15000000, aktif: true },
        { id: 'w-t1', nama: 'Tunai - Pak Bendahara', jenis: 'tunai', saldo_awal: 0, aktif: true },
        { id: 'w-t2', nama: 'Tunai - Pak Ketua', jenis: 'tunai', saldo_awal: 0, aktif: true },
      ];
      d.mitra = [
        { id: 'm1', nama: 'Pak Budi', posisi: 'Satpam', jenis_gaji: 'bulanan', gaji_pokok: 1500000, aktif: true, tgl_resign: null },
        { id: 'm2', nama: 'Pak Joko', posisi: 'Satpam', jenis_gaji: 'bulanan', gaji_pokok: 1500000, aktif: true, tgl_resign: null },
        { id: 'm3', nama: 'Pak Wawan', posisi: 'Tukang taman', jenis_gaji: 'kedatangan', gaji_pokok: 800000, aktif: true, tgl_resign: null },
      ];
      const names = ['Pak Andi', 'Bu Sari', 'Pak Dedi', 'Bu Rina', 'Pak Hendra', 'Bu Wati', 'Pak Agus', 'Bu Lina', 'Pak Rudi', 'Bu Yanti',
        'Pak Fajar', 'Bu Dewi', 'Pak Eko', 'Bu Nia', 'Pak Bayu', 'Bu Tika', 'Pak Irfan', 'Bu Maya', 'Pak Dimas', 'Bu Fitri', 'Pak Yoga', 'Bu Ratna', 'Pak Arif', 'Bu Desi'];
      const ipls = [100000, 150000, 150000, 250000];
      let n = 0;
      for (let b = 1; b <= 4; b++) for (let h = 1; h <= 6; h++) {
        const id = 'r' + n;
        d.rumah.push({ id, kode: `KB${b}/${h * 2}`, nama: names[n], grup: b <= 2 ? 'KB Lama' : 'KB Baru', blok: 'KB' + b, ipl: ipls[n % 4], aktif: true });
        d.rumah_rekening.push({ rumah_id: id, bank: ['BCA', 'Mandiri', 'BRI', 'BNI'][n % 4], nama_rekening: names[n].replace(/^(Pak|Bu) /, ''), no_hp: '' });
        n++;
      }
      let t = 0; const tid = () => 't' + (t++);
      const tx = (o) => { const id = tid(); d.transaksi.push(Object.assign({ id, dompet_tujuan_id: null, kategori_id: null, rumah_id: null, mitra_id: null, komponen: null, keterangan: '' }, o, { id, created_at: o.tanggal + 'T08:00:00.000Z' })); return id; };
      // Iuran
      d.rumah.forEach((rm, i) => {
        const lazy = i % 7 === 3; // beberapa rumah sering telat
        for (let m = 1; m <= curM; m++) {
          if (m === curM && rnd() < 0.45) continue;
          if (lazy && m > curM - 3) continue;
          if (rnd() < 0.06) continue;
          const tunai = rnd() < 0.2;
          const id = tx({ tipe: 'iuran', tanggal: day(m, 1 + Math.floor(rnd() * 20)), nilai: rm.ipl, dompet_id: tunai ? 'w-t1' : 'w-rek', rumah_id: rm.id, bulan: ym(m), keterangan: '' });
          d.iuran_bulan.push({ id: 'ib' + id, transaksi_id: id, rumah_id: rm.id, bulan: ym(m), nominal: rm.ipl });
        }
      });
      const ymN = n => (yr + Math.floor((n - 1) / 12)) + '-' + String(((n - 1) % 12) + 1).padStart(2, '0');
      const hutang = [0, 1, 2, 3, 4, 5].map(i => ({ id: 'h' + (i + 1), mitra_id: 'm1', keterangan: 'Cicilan pinjaman', bulan: ymN(Math.max(1, curM - 3) + i), cicilan_ke: i + 1, nominal: 300000, lunas: false, transaksi_id: null }));
      for (let m = 1; m <= curM; m++) {
        const full = m < curM, tengahPaid = m < curM || now.getDate() > 15;
        tx({ tipe: 'pemasukan', tanggal: day(m, 10), nilai: 500000, dompet_id: 'w-rek', bulan: ym(m), keterangan: 'Insentif provider internet' });
        tx({ tipe: 'mutasi', tanggal: day(m, 12), nilai: 1500000, dompet_id: 'w-rek', dompet_tujuan_id: 'w-t1', bulan: ym(m), keterangan: 'Tarik tunai untuk operasional' });
        // Pak Budi: tengah bulan + akhir bulan (dipotong cicilan)
        if (tengahPaid) tx({ tipe: 'pengeluaran', tanggal: day(m, 15), nilai: 600000, dompet_id: 'w-t1', kategori_id: 'k0', mitra_id: 'm1', komponen: 'gaji_tengah', bulan: ym(m), keterangan: 'Gaji tengah bulan - Pak Budi' });
        if (full) {
          const cic = hutang.filter(h => h.bulan === ym(m));
          const pot = cic.reduce((a, h) => a + h.nominal, 0);
          const tid = tx({ tipe: 'pengeluaran', tanggal: day(m, 28), nilai: 1500000 - 600000 - pot, dompet_id: 'w-rek', kategori_id: 'k0', mitra_id: 'm1', komponen: 'gaji', bulan: ym(m), keterangan: 'Gaji - Pak Budi' + (pot ? ' (potong cicilan)' : '') });
          cic.forEach(h => { h.lunas = true; h.transaksi_id = tid; });
          tx({ tipe: 'pengeluaran', tanggal: day(m, 28), nilai: 1500000, dompet_id: 'w-rek', kategori_id: 'k0', mitra_id: 'm2', komponen: 'gaji', bulan: ym(m), keterangan: 'Gaji - Pak Joko' });
          const n = m % 3 === 0 ? 2 : (m % 2 === 1 ? 1 : 0);
          if (n) {
            const tid = tx({ tipe: 'pengeluaran', tanggal: day(m, 28), nilai: 800000 * n, dompet_id: 'w-t1', kategori_id: 'k0', mitra_id: 'm3', komponen: 'gaji', bulan: ym(m), keterangan: `Gaji kedatangan ke-${n === 2 ? '1, 2' : '1'} - Pak Wawan` });
            for (let k = 1; k <= n; k++) d.kedatangan_mitra.push({ id: 'kd' + m + '-' + k, mitra_id: 'm3', bulan: ym(m), ke: k, transaksi_id: tid });
          }
        }
        tx({ tipe: 'pengeluaran', tanggal: day(m, 5), nilai: 250000 + Math.round(rnd() * 100) * 1000, dompet_id: 'w-rek', kategori_id: 'k2', bulan: ym(m), keterangan: 'Listrik pos & lampu jalan' });
        tx({ tipe: 'pengeluaran', tanggal: day(m, 6), nilai: 6500, dompet_id: 'w-rek', kategori_id: 'k3', bulan: ym(m), keterangan: 'Biaya admin bank' });
        tx({ tipe: 'pengeluaran', tanggal: day(m, 8), nilai: 120000, dompet_id: 'w-t1', kategori_id: 'k2', bulan: ym(m), keterangan: 'Galon & pulsa pos' });
        if (m % 3 === 0) tx({ tipe: 'pengeluaran', tanggal: day(m, 18), nilai: 750000, dompet_id: 'w-t1', kategori_id: 'k4', bulan: ym(m), keterangan: 'Potong rumput & perawatan taman' });
        if (m % 4 === 1) tx({ tipe: 'pengeluaran', tanggal: day(m, 20), nilai: 400000, dompet_id: 'w-rek', kategori_id: 'k1', mitra_id: 'm2', komponen: 'lembur', bulan: ym(m), keterangan: 'Lembur jaga malam' });
      }
      d.hutang_mitra = hutang;
      if (curM >= 3) {
        tx({ tipe: 'mutasi', tanggal: day(3, 20), nilai: 5000000, dompet_id: 'w-rek', dompet_tujuan_id: 'w-krom', bulan: ym(3), keterangan: 'Pindah dana ke Krom' });
        tx({ tipe: 'pengeluaran', tanggal: day(3, 20), nilai: 6500, dompet_id: 'w-rek', kategori_id: 'k3', bulan: ym(3), keterangan: 'Biaya admin mutasi Kas Mandiri Sherwood → Kas Krom Sherwood' });
        tx({ tipe: 'pemasukan', tanggal: day(Math.min(curM, 9), 30 > 28 ? 28 : 30), nilai: 41235.67, dompet_id: 'w-krom', bulan: ym(Math.min(curM, 9)), keterangan: 'Non Iuran - Bunga Bank Krom' });
      }
      const tidNow = tx({ tipe: 'pengeluaran', tanggal: day(curM, 10), nilai: 800000, dompet_id: 'w-t1', kategori_id: 'k0', mitra_id: 'm3', komponen: 'gaji', bulan: ym(curM), keterangan: 'Gaji kedatangan ke-1 - Pak Wawan' });
      [1, 2, 3].forEach(k => d.kedatangan_mitra.push({ id: 'kdnow-' + k, mitra_id: 'm3', bulan: ym(curM), ke: k, transaksi_id: k === 1 ? tidNow : null }));
      d.catatan = [
        { id: 'c1', tanggal: day(Math.max(1, curM - 1), 3), isi: 'Ada transfer Rp500.000 tanpa konfirmasi WA, belum diketahui dari rumah mana.', status: 'Open' },
        { id: 'c2', tanggal: day(Math.max(1, curM - 2), 11), isi: 'Reimburse parkir saat tarik tunai Rp2.000.', status: 'Clear' },
      ];
      return d;
    }

    return {
      demo: true,
      TABLES,
      async session() { try { const s = sessionStorage.getItem(LS + '-me'); me = s ? JSON.parse(s) : null; } catch (e) { me = null; } return me; },
      async signInDemo(role) {
        const p = db.profiles.find(x => x.role === role);
        me = { id: p.id, email: p.email, nama: p.nama, role };
        try { sessionStorage.setItem(LS + '-me', JSON.stringify(me)); } catch (e) { /* abaikan */ }
        return me;
      },
      async signOut() { me = null; try { sessionStorage.removeItem(LS + '-me'); } catch (e) { /* abaikan */ } },
      async list(t, opts = {}) {
        if (adminOnly.includes(t) && (!me || me.role !== 'admin')) return t === 'profiles' ? db.profiles.filter(p => me && p.id === me.id) : [];
        let rows = (db[t] || []).map(x => Object.assign({}, x));
        if (opts.order) rows.sort((a, b) => (a[opts.order] > b[opts.order] ? 1 : -1) * (opts.desc ? -1 : 1));
        if (opts.limit) rows = rows.slice(0, opts.limit);
        return rows;
      },
      async insert(t, rows) {
        guard();
        db[t] = db[t] || [];
        const arr = (Array.isArray(rows) ? rows : [rows]).map(r => Object.assign({}, r));
        arr.forEach(r => {
          if (keyOf(t) === 'id' && !r.id) r.id = uid();
          if (t === 'transaksi') { r.created_at = new Date().toISOString(); audit('INSERT', null, r); }
          db[t].push(r);
        });
        save();
        return arr.map(r => Object.assign({}, r));
      },
      async upsert(t, rows) {
        guard();
        const k = keyOf(t);
        (Array.isArray(rows) ? rows : [rows]).forEach(r => {
          const i = db[t].findIndex(x => x[k] === r[k]);
          if (i >= 0) db[t][i] = Object.assign(db[t][i], r); else db[t].push(Object.assign({}, r));
        });
        save();
        return rows;
      },
      async update(t, id, patch) {
        guard();
        const k = keyOf(t);
        const row = db[t].find(x => x[k] === id);
        if (!row) throw new Error('Data tidak ditemukan');
        const lama = Object.assign({}, row);
        Object.assign(row, patch);
        if (t === 'transaksi') audit('UPDATE', lama, Object.assign({}, row));
        save();
        return Object.assign({}, row);
      },
      async remove(t, id) {
        guard();
        const k = keyOf(t);
        db[t] = db[t] || [];
        const row = db[t].find(x => x[k] === id);
        db[t] = db[t].filter(x => x[k] !== id);
        if (t === 'transaksi') { db.iuran_bulan = db.iuran_bulan.filter(x => x.transaksi_id !== id); audit('DELETE', row, null); }
        if (t === 'rumah') db.rumah_rekening = db.rumah_rekening.filter(x => x.rumah_id !== id);
        save();
      },
      async removeWhere(t, col, val) { guard(); db[t] = db[t].filter(x => x[col] !== val); save(); },
      async rpc(name) {
        const grp = (rows, val) => { const m = new Map(); rows.forEach(r => { const k = r.mitra_id + '|' + r.bulan; m.set(k, (m.get(k) || 0) + val(r)); });
          return [...m].map(([k, v]) => ({ mitra_id: k.split('|')[0], bulan: k.split('|')[1], v })); };
        if (name === 'potongan_gaji') return grp(db.hutang_mitra.filter(h => h.mitra_id), h => Number(h.nominal)).map(x => ({ mitra_id: x.mitra_id, bulan: x.bulan, nominal: x.v }));
        if (name === 'kedatangan_bulan') return grp(db.kedatangan_mitra, () => 1).map(x => ({ mitra_id: x.mitra_id, bulan: x.bulan, jumlah: x.v }));
        return [];
      },
      resetDemo() { db = seed(); save(); },
    };
  }

  window.DB = (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) ? supabaseAdapter() : demoAdapter();
})();
