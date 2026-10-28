(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const TIPE_LABEL = { iuran: 'Iuran', pemasukan: 'Pemasukan lain', pengeluaran: 'Pengeluaran', mutasi: 'Mutasi' };
  const TIPE_BADGE = { iuran: 'ok', pemasukan: 'info', pengeluaran: 'bad', mutasi: 'warn' };
  const KOMPONEN = { gaji_tengah: 'Gaji tengah bulan', gaji: 'Gaji akhir bulan', kasbon: 'Kasbon', lembur: 'Lembur', thr: 'THR', lainnya: 'Lainnya' };
  const gajiLabel = m => m.jenis_gaji === 'kedatangan' ? `${rp(m.gaji_pokok)} per kedatangan` : `${rp(m.gaji_pokok)}/bulan`;

  const S = { me: null, d: {}, idx: {}, paid: new Map(), year: new Date().getFullYear(), charts: [] };

  // ------------------------------------------------------------------ utils
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtNum = n => { const v = Math.round((Number(n) || 0) * 100) / 100; return v.toLocaleString('id-ID', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }); };
  const rp = n => (n < 0 ? '-' : '') + 'Rp' + fmtNum(Math.abs(n || 0));
  const num0 = n => n ? fmtNum(n) : '-';
  // Format Indonesia: titik = ribuan, koma = desimal (maks. 2 angka). "62342.5" juga dibaca sebagai desimal.
  const parseRp = v => {
    let s = String(v ?? '').replace(/[^\d.,-]/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (!/^\d+\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '');
    const n = parseFloat(s); return isNaN(n) ? 0 : Math.round(n * 100) / 100;
  };
  const pad = n => String(n).padStart(2, '0');
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const curYM = () => todayISO().slice(0, 7);
  const ymOf = (y, m) => `${y}-${pad(m)}`;
  const ymAdd = (ym, n) => { let y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return ymOf(y, m + 1); };
  const ymRange = (a, b) => { const out = []; for (let x = a; x <= b; x = ymAdd(x, 1)) out.push(x); return out; };
  const fmtBulan = ym => ym ? `${BULAN[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}` : '';
  const fmtTgl = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '';
  const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f ? f(x) : x) || 0), 0);
  // Halaman warga (index.html) selalu tampil sebagai warga; halaman admin (admin.html) khusus akun admin
  const MODE = window.APP_MODE === 'admin' ? 'admin' : 'warga';
  const isAdmin = () => MODE === 'admin' && S.me && (S.me.role === 'admin' || S.me.role === 'viewer');
  const canWrite = () => isAdmin() && S.me.role === 'admin';
  const setting = k => (S.d.pengaturan.find(x => x.key === k) || {}).value;
  const mulaiTagih = () => setting('mulai_tagih') || ymOf(new Date().getFullYear(), 1);
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)));
  const get = (t, id) => (S.idx[t] && S.idx[t].get(id)) || null;
  const rumahLabel = r => r ? `${r.kode} - ${r.nama || ''}` : '-';
  const sortRumah = (a, b) => a.kode.localeCompare(b.kode, 'id', { numeric: true });
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  function toast(msg, err) {
    const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', !!err); t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function openModal(title, html, onMount) {
    $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html;
    $('#modal').classList.remove('hidden'); if (onMount) onMount($('#modalBody'));
  }
  const warn = msg => toast(msg, true);
  const framed = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
  function ask(msg) {
    return new Promise(res => openModal('Konfirmasi', `<p>${esc(msg)}</p><div class="form-actions"><button class="btn" id="askNo">Batal</button><button class="btn primary" id="askYes">Ya, lanjutkan</button></div>`, b => {
      $('#askNo', b).onclick = () => { closeModal(); res(false); };
      $('#askYes', b).onclick = () => { closeModal(); res(true); };
    }));
  }
  function closeModal() { $('#modal').classList.add('hidden'); $('#modalBody').innerHTML = ''; }
  async function run(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); return true; } catch (e) { console.error(e); warn('Gagal: ' + e.message); return false; }
  }
  function moneyInputs(root) {
    $$('input[data-money]', root).forEach(i => {
      i.addEventListener('blur', () => { if (i.value !== '') i.value = fmtNum(parseRp(i.value)); });
      if (i.value !== '' && !isNaN(+i.value)) i.value = fmtNum(+i.value);
    });
  }
  const opt = (v, label, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(label)}</option>`;

  // ------------------------------------------------------------------ data
  async function loadAll() {
    const res = await Promise.all(DB.TABLES.map(t => DB.list(t)));
    DB.TABLES.forEach((t, i) => S.d[t] = res[i]);
    reindex();
    await loadAgg();
  }
  async function reload(...tables) {
    const res = await Promise.all(tables.map(t => DB.list(t)));
    tables.forEach((t, i) => S.d[t] = res[i]);
    reindex();
    if (tables.some(t => ['transaksi', 'hutang_mitra', 'kedatangan_mitra'].includes(t))) await loadAgg();
  }
  // Ringkasan potongan gaji & jumlah kedatangan per mitra per bulan (bisa dibaca warga tanpa membuka data hutang)
  async function loadAgg() {
    S.agg = { pot: new Map(), kd: new Map() };
    try {
      const [pot, kd] = await Promise.all([DB.rpc('potongan_gaji'), DB.rpc('kedatangan_bulan')]);
      pot.forEach(r => S.agg.pot.set(r.mitra_id + '|' + r.bulan, Number(r.nominal)));
      kd.forEach(r => S.agg.kd.set(r.mitra_id + '|' + r.bulan, Number(r.jumlah)));
    } catch (e) { console.warn('agg', e); }
  }
  function reindex() {
    DB.TABLES.forEach(t => S.idx[t] = new Map(S.d[t].map(r => [r.id || r.key || r.rumah_id, r])));
    S.d.transaksi.forEach(t => t.nilai = Number(t.nilai));
    S.d.rumah.forEach(r => r.ipl = Number(r.ipl));
    S.d.dompet.forEach(w => w.saldo_awal = Number(w.saldo_awal));
    S.paid = new Map();
    S.iuranByTrx = new Map();
    S.d.iuran_bulan.forEach(b => {
      const k = b.rumah_id + '|' + b.bulan;
      S.paid.set(k, (S.paid.get(k) || 0) + Number(b.nominal));
      if (!S.iuranByTrx.has(b.transaksi_id)) S.iuranByTrx.set(b.transaksi_id, []);
      S.iuranByTrx.get(b.transaksi_id).push(b);
    });
    S.d.rumah.sort(sortRumah);
    S.d.kategori.sort((a, b) => (a.urutan || 0) - (b.urutan || 0) || a.nama.localeCompare(b.nama));
    S.d.dompet.sort((a, b) => (a.jenis === 'rekening' ? 0 : 1) - (b.jenis === 'rekening' ? 0 : 1) || a.nama.localeCompare(b.nama));
    S.d.transaksi.sort((a, b) => a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0);
  }

  // Pergerakan kas per dompet. beforeDate (YYYY-MM-DD) = hanya transaksi sebelum tanggal itu.
  function saldo(dompetId, beforeDate) {
    const w = get('dompet', dompetId); let s = w ? w.saldo_awal : 0;
    for (const t of S.d.transaksi) {
      if (beforeDate && t.tanggal >= beforeDate) continue;
      if (t.tipe === 'iuran' || t.tipe === 'pemasukan') { if (t.dompet_id === dompetId) s += t.nilai; }
      else if (t.tipe === 'pengeluaran') { if (t.dompet_id === dompetId) s -= t.nilai; }
      else if (t.tipe === 'mutasi') { if (t.dompet_id === dompetId) s -= t.nilai; if (t.dompet_tujuan_id === dompetId) s += t.nilai; }
    }
    return s;
  }
  const totalKas = beforeDate => sum(S.d.dompet, w => saldo(w.id, beforeDate));


  function statusBulan(r, ym) {
    const paid = S.paid.get(r.id + '|' + ym) || 0;
    if (r.ipl > 0 && paid >= r.ipl) return { s: 'paid', paid };
    if (paid > 0) return { s: r.ipl > 0 && isAdmin() ? 'partial' : 'paid', paid };
    if (ym > curYM() || ym < mulaiTagih()) return { s: 'future', paid };
    return { s: 'unpaid', paid };
  }
  function tunggakan(r) {
    if (!r.aktif) return { bulan: [], total: 0 };
    const list = ymRange(mulaiTagih(), curYM()).map(ym => ({ ym, st: statusBulan(r, ym) })).filter(x => x.st.s === 'unpaid' || x.st.s === 'partial');
    return { bulan: list.map(x => x.ym), total: sum(list, x => r.ipl - x.st.paid) };
  }
  function years() {
    const ys = new Set([new Date().getFullYear()]);
    S.d.transaksi.forEach(t => ys.add(+t.tanggal.slice(0, 4)));
    const man = ringkasanSheet(); if (man) Object.keys(man.bulan).forEach(k => ys.add(+k.slice(0, 4)));
    const nowY = new Date().getFullYear();
    // Tahun yang punya status bayar warga (mis. sejak 2024) ikut tampil
    S.d.iuran_bulan.forEach(b => ys.add(+b.bulan.slice(0, 4)));
    if (isAdmin()) {
      // Admin juga melihat tahun depan jika sudah ada iuran dibayar dimuka / kasbon / cicilan hutang
      S.d.iuran_bulan.forEach(b => ys.add(+b.bulan.slice(0, 4)));
      S.d.transaksi.forEach(t => { if (t.bulan) ys.add(+t.bulan.slice(0, 4)); });
      S.d.hutang_mitra.forEach(h => ys.add(+h.bulan.slice(0, 4)));
    } else return [...ys].filter(y => y <= nowY).sort((a, b) => b - a);
    return [...ys].sort((a, b) => b - a);
  }
  const yearSelect = () => `<label>Tahun<select id="fYear">${years().map(y => opt(y, y, y === S.year)).join('')}</select></label>`;
  function bindYear(el, rerender) { const s = $('#fYear', el); if (s) s.onchange = () => { S.year = +s.value; rerender(); }; }
  const monthsOfYear = y => Array.from({ length: 12 }, (_, i) => ymOf(y, i + 1));
  function trxDesc(t) {
    if (t.tipe === 'iuran') {
      const bl = (S.iuranByTrx.get(t.id) || []).map(b => b.bulan).sort();
      return `${esc(rumahLabel(get('rumah', t.rumah_id)))}<div class="muted small">${bl.map(fmtBulan).join(', ')}</div>`;
    }
    if (t.tipe === 'mutasi') return `${esc((get('dompet', t.dompet_id) || {}).nama)} &rarr; ${esc((get('dompet', t.dompet_tujuan_id) || {}).nama)}<div class="muted small">${esc(t.keterangan)}</div>`;
    const k = get('kategori', t.kategori_id), m = get('mitra', t.mitra_id);
    return `${esc(t.keterangan || '-')}<div class="muted small">${esc(k ? k.nama : '')}${m ? ' · ' + esc(m.nama) + (t.komponen ? ' (' + KOMPONEN[t.komponen] + ')' : '') : ''}</div>`;
  }
  function destroyCharts() { S.charts.forEach(c => c.destroy()); S.charts = []; }

  // ------------------------------------------------------------------ pages
  const PAGES = [
    { group: 'Laporan' },
    { key: 'dashboard', title: 'Ringkasan', render: pgDashboard },
    { key: 'bayar', title: 'Rekap Bayar Warga', render: pgBayar },
    { key: 'pengeluaran', title: 'Rekap Pengeluaran', render: pgPengeluaran },
    { key: 'gaji', title: 'Gaji Mitra', render: pgGaji },
    { key: 'ipl', title: 'Besaran IPL', render: pgIpl, staff: true },
    { group: 'Admin', admin: true },
    { key: 'input', title: 'Input Transaksi', render: pgInput, admin: true, write: true },
    { key: 'keuangan', title: 'Rekap Keuangan', render: pgKeuangan, admin: true },
    { key: 'riwayat', title: 'Riwayat Transaksi', render: pgRiwayat, admin: true },
    { key: 'master', title: 'Master Data', render: pgMaster, admin: true },
    { key: 'hutang', title: 'Hutang Mitra', render: pgHutang, admin: true },
    { key: 'catatan', title: 'Catatan', render: pgCatatan, admin: true },
    { key: 'akun', title: 'Akun Pengguna', render: pgAkun, admin: true, write: true },
    { key: 'audit', title: 'Audit Log', render: pgAudit, admin: true },
    { key: 'impor', title: 'Impor / Ekspor', render: pgImpor, admin: true },
  ];

  const canSee = p => (!(p.admin || p.staff) || isAdmin()) && (!p.write || canWrite());
  const ICON = {
    dashboard: '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 4v3h6V4z"/>',
    bayar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 14l2 2 4-4"/>',
    pengeluaran: '<path d="M4 8h16v11H4zM6 8l2-4h8l2 4M9 13h6"/>',
    gaji: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    input: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    riwayat: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  };
  const SHORT = { dashboard: 'Ringkasan', bayar: 'Iuran', pengeluaran: 'Pengeluaran', gaji: 'Mitra', input: 'Input', riwayat: 'Riwayat' };
  const svg = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
  function buildNav() {
    $('#nav').innerHTML = PAGES.filter(canSee).map(p => p.group
      ? `<div class="nav-group">${p.group}</div>`
      : `<a href="#${p.key}" data-key="${p.key}">${p.title}</a>`).join('');
    const keys = isAdmin() ? ['dashboard', 'bayar', canWrite() ? 'input' : 'pengeluaran', 'riwayat'] : ['dashboard', 'bayar', 'pengeluaran', 'gaji'];
    $('#bottomNav').innerHTML = keys.map(k => `<a href="#${k}" data-key="${k}">${svg(k)}<span>${SHORT[k]}</span></a>`).join('')
      + (isAdmin() ? `<button type="button" id="bnMenu">${svg('menu')}<span>Lainnya</span></button>` : '');
    if ($('#bnMenu')) $('#bnMenu').onclick = () => $('#menuBtn').click();
  }
  function route() {
    let key = (location.hash.match(/^#\/?(\w+)/) || [])[1] || (canWrite() ? 'input' : 'dashboard');
    if (key === 'pencairan') key = 'gaji';
    let page = PAGES.find(p => p.key === key);
    if (!page || page.group || !canSee(page)) { page = PAGES[1]; }
    $$('#nav a, #bottomNav a').forEach(a => a.classList.toggle('active', a.dataset.key === page.key));
    $('#pageTitle').textContent = page.title;
    $('#sidebar').classList.remove('open'); $('#backdrop').classList.remove('show');
    destroyCharts(); closeModal();
    const view = $('#view'); view.innerHTML = '';
    try { page.render(view); } catch (e) { console.error(e); view.innerHTML = `<div class="panel error">Terjadi kesalahan: ${esc(e.message)}</div>`; }
    window.scrollTo(0, 0);
  }
  const rerender = () => route();

  // ---------- Ringkasan
  // Bulan s.d. "cutoff" memakai angka tab Ringkasan sheet lama (disimpan di pengaturan 'ringkasan_sheet');
  // bulan sesudahnya dihitung dari transaksi aplikasi.
  function ringkasanSheet() { try { const r = JSON.parse(setting('ringkasan_sheet') || 'null'); return r && r.bulan ? r : null; } catch (e) { return null; } }
  function ringkasanTahun(y) {
    const man = ringkasanSheet(), mb = man ? man.bulan : {}, cutoff = man ? man.cutoff : '';
    const nowY = new Date().getFullYear(), lastM = y === nowY ? new Date().getMonth() + 1 : (y > nowY ? 0 : 12);
    const rows = [];
    if (y > nowY) {
      // Tahun yang belum berjalan (khusus admin): berdasarkan bulan pembebanan
      if (!isAdmin()) return rows;
      monthsOfYear(y).forEach(ym => {
        const masuk = sum(S.d.iuran_bulan.filter(b => b.bulan === ym), b => Number(b.nominal)) + sum(S.d.transaksi.filter(t => t.tipe === 'pemasukan' && t.bulan === ym), t => t.nilai);
        const keluar = sum(S.d.transaksi.filter(t => t.tipe === 'pengeluaran' && t.bulan === ym), t => t.nilai);
        const hutang = sum(S.d.hutang_mitra.filter(h => h.bulan === ym), h => Number(h.nominal));
        if (masuk || keluar || hutang) rows.push({ ym, future: true, masuk, keluar, selisih: masuk - keluar, saldo: null, hutang });
      });
      return rows;
    }
    monthsOfYear(y).slice(0, lastM).forEach(ym => {
      if (cutoff && ym <= cutoff) {
        const m = mb[ym]; if (!m) return;
        rows.push({ ym, sheet: true, masuk: m.masuk, keluar: m.keluar, selisih: m.selisih != null ? m.selisih : m.masuk - m.keluar, saldo: m.saldo });
        return;
      }
      const tx = S.d.transaksi.filter(t => t.tanggal.slice(0, 7) === ym);
      const iuran = sum(tx.filter(t => t.tipe === 'iuran'), t => t.nilai), non = sum(tx.filter(t => t.tipe === 'pemasukan'), t => t.nilai);
      const keluar = sum(tx.filter(t => t.tipe === 'pengeluaran'), t => t.nilai);
      rows.push({ ym, sheet: false, iuran, non, masuk: iuran + non, keluar, selisih: iuran + non - keluar, saldo: totalKas(ymAdd(ym, 1) + '-01') });
    });
    return rows;
  }
  function kasAwalTahun(y) {
    if (y > new Date().getFullYear()) return null;
    const man = ringkasanSheet(), prev = `${y - 1}-12`;
    if (man && man.kasAwal && man.kasAwal[y] != null) return man.kasAwal[y];
    if (man && man.bulan[`${y}-01`] && `${y}-01` <= man.cutoff) return null;
    if (man && man.bulan[prev] && prev <= man.cutoff && man.bulan[prev].saldo != null) return man.bulan[prev].saldo;
    const first = ringkasanTahun(y)[0];
    if (first && first.sheet) return first.saldo != null ? first.saldo - first.selisih : null;
    return totalKas(`${y}-01-01`);
  }
  function pgDashboard(el) {
    const y = S.year;
    const kasAwal = kasAwalTahun(y);
    const shown = ringkasanTahun(y);
    const isNowY = y === new Date().getFullYear();
    const kasAkhir = isNowY || !shown.length ? totalKas() : shown[shown.length - 1].saldo;
    const rpx = v => v == null ? '—' : rp(v);
    // Pemasukan, pengeluaran, selisih selalu dengan 2 angka desimal
    const rp2 = n => (n < 0 ? '-' : '') + 'Rp' + Math.abs(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const rek = sum(S.d.dompet.filter(w => w.jenis === 'rekening'), w => saldo(w.id));
    const tunai = sum(S.d.dompet.filter(w => w.jenis === 'tunai'), w => saldo(w.id));
    const isNow = y === new Date().getFullYear(), adm = isAdmin();
    el.innerHTML = `
      <div class="toolbar">${yearSelect()}<span class="spacer"></span>${framed ? '' : '<button class="btn desk-only" id="printBtn">Print</button>'}</div>
      <div class="cards">
        <div class="card"><div class="label">Kas awal ${y}</div><div class="value">${rpx(kasAwal)}</div></div>
        <div class="card"><div class="label">${isNow ? 'Kas berjalan' : 'Kas akhir ' + y}</div><div class="value">${rpx(kasAkhir)}</div></div>
        <div class="card"><div class="label">Saldo rekening (saat ini)</div><div class="value">${rp(rek)}</div></div>
        <div class="card"><div class="label">Saldo tunai (saat ini)</div><div class="value">${rp(tunai)}</div></div>
      </div>
      <div class="panel"><h3>Pemasukan vs pengeluaran ${y}</h3><div class="chart-box"><canvas id="chart"></canvas></div></div>
      <div class="mlist">${shown.slice().reverse().map(r => `<div class="mitem">
          <div class="mhead"><b>${fmtBulan(r.ym)}</b><span class="${r.selisih < 0 ? 'neg' : 'pos'}">${r.selisih > 0 ? '+' : ''}${rp2(r.selisih)}</span></div>
          <div class="mrow"><span>Pemasukan</span><span>${rp2(r.masuk)}</span></div>
          <div class="mrow"><span>Pengeluaran</span><span>${rp2(r.keluar)}</span></div>
          ${r.saldo == null ? '' : `<div class="mrow strong"><span>Saldo akhir</span><span>${rp(r.saldo)}</span></div>`}
          </div>`).join('') || '<div class="empty">Belum ada data</div>'}</div>
      <div class="table-wrap desk-only"><table>
        <thead><tr><th>Bulan</th><th class="num">Pemasukan</th><th class="num">Pengeluaran</th><th class="num">Selisih</th><th class="num">Saldo akhir</th></tr></thead>
        <tbody>${shown.slice().reverse().map(r => `<tr><td>${fmtBulan(r.ym)}</td><td class="num">${rp2(r.masuk)}</td>
          <td class="num">${rp2(r.keluar)}</td><td class="num ${r.selisih < 0 ? 'neg' : 'pos'}">${rp2(r.selisih)}</td><td class="num">${rpx(r.saldo)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Belum ada data</td></tr>'}</tbody>
        <tfoot><tr class="total"><td>Total</td><td class="num">${rp2(sum(shown, r => r.masuk))}</td>
          <td class="num">${rp2(sum(shown, r => r.keluar))}</td><td class="num">${rp2(sum(shown, r => r.selisih))}</td><td class="num"></td></tr></tfoot>
      </table></div>
      ${shown.some(r => r.future) ? `<p class="hint" style="margin-top:8px">Tahun ${y} belum berjalan. Pemasukan = iuran yang sudah dibayar dimuka untuk bulan tersebut; pengeluaran = yang dibebankan ke bulan tersebut. Cicilan hutang mitra yang akan dipotong: ${shown.filter(r => r.hutang).map(r => `${BLN[+r.ym.slice(5) - 1]} ${rp(r.hutang)}`).join(', ') || 'tidak ada'}. Hanya terlihat oleh admin.</p>` : ''}
      ${shown.some(r => r.sheet) ? `<p class="hint" style="margin-top:8px">Angka s.d. ${fmtBulan(ringkasanSheet().cutoff)} diambil dari Ringkasan Google Sheet lama.</p>` : ''}
      ${adm ? `<div class="panel" style="margin-top:18px"><h3>Saldo per dompet (saat ini)</h3><div class="table-wrap"><table><tbody>
        ${S.d.dompet.map(w => `<tr><td>${esc(w.nama)} <span class="badge">${w.jenis}</span></td><td class="num">${rp(saldo(w.id))}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}`;
    bindYear(el, rerender);
    if ($('#printBtn', el)) $('#printBtn', el).onclick = () => window.print();
    if (window.Chart) {
      S.charts.push(new Chart($('#chart', el), {
        type: 'bar',
        data: {
          labels: shown.map(r => BLN[+r.ym.slice(5, 7) - 1]),
          datasets: [
            { label: 'Pemasukan', data: shown.map(r => r.masuk), backgroundColor: cssVar('--ok'), borderRadius: 4 },
            { label: 'Pengeluaran', data: shown.map(r => r.keluar), backgroundColor: cssVar('--bad'), borderRadius: 4 },
          ],
        },
        options: {
          maintainAspectRatio: false,
          plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${rp(c.raw)}` } }, legend: { labels: { color: cssVar('--text') } } },
          scales: { y: { ticks: { color: cssVar('--muted'), callback: v => (v / 1e6).toLocaleString('id-ID') + ' jt' }, grid: { color: cssVar('--border') } }, x: { ticks: { color: cssVar('--muted') }, grid: { display: false } } },
        },
      }));
    }
  }

  // ---------- Rekap bayar
  function pgBayar(el) {
    const adm = isAdmin();
    const f = S.fBayar || (S.fBayar = { q: '', min: 0 });
    const ms = monthsOfYear(S.year);
    const rumah = S.d.rumah.filter(r => r.aktif || ms.some(m => S.paid.get(r.id + '|' + m)))
      .filter(r => !f.q || rumahLabel(r).toLowerCase().includes(f.q.toLowerCase()))
      .map(r => ({ r, tg: adm ? tunggakan(r) : null }))
      .filter(x => !adm || x.tg.bulan.length >= f.min);
    const sym = { paid: '✓', partial: '½', unpaid: '✗', future: '·' };
        el.innerHTML = `
      <div class="toolbar">${yearSelect()}
        ${adm ? `<label>Menunggak ≥<select id="fMin">${[0, 1, 2, 3, 6].map(n => opt(n, n === 0 ? 'Semua' : n + ' bulan', n === f.min)).join('')}</select></label>` : ''}
        <label>Cari<input id="fQ" value="${esc(f.q)}" placeholder="Kode / nama"></label>
      </div>
      <div class="legend"><span class="l-paid">Lunas</span>${adm ? '<span class="l-partial">Sebagian</span>' : ''}<span class="l-unpaid">Belum</span><span class="l-future">Belum jatuh tempo</span></div>
      <div class="table-wrap"><table class="matrix">
        <thead><tr><th class="sticky-col">Rumah</th>${adm ? '<th class="num">IPL</th>' : ''}${ms.map(m => `<th class="num">${BLN[+m.slice(5) - 1]}</th>`).join('')}${adm ? '<th class="num">Tunggakan</th><th class="num">Total tunggakan</th><th></th>' : ''}</tr></thead>
        <tbody>${rumah.map(({ r, tg }) => `<tr>
          <td class="sticky-col rumah-col"><b>${esc(r.kode)}</b> <span class="nm">${esc(r.nama || '')}</span>${r.aktif ? '' : ' <span class="badge">nonaktif</span>'}</td>${adm ? `<td class="num">${rp(r.ipl)}</td>` : ''}
          ${ms.map(m => { const st = statusBulan(r, m); return `<td class="cell ${st.s}" title="${fmtBulan(m)}${adm ? ': ' + rp(st.paid) : ''}">${sym[st.s]}</td>`; }).join('')}
          ${adm ? `<td class="num ${tg.bulan.length ? 'neg' : ''}">${tg.bulan.length} bln</td><td class="num ${tg.total ? 'neg' : ''}">${rp(tg.total)}</td>
          <td>${tg.bulan.length ? `<a class="btn small" target="_blank" rel="noopener" href="${waLink(r, tg)}">Pengingat WA</a>` : ''}</td>` : ''}
        </tr>`).join('') || `<tr><td colspan="${ms.length + 1 + (adm ? 4 : 0)}" class="empty">Tidak ada data</td></tr>`}</tbody>
        <tfoot>
          <tr class="total"><td class="sticky-col">Rumah lunas</td>${adm ? '<td></td>' : ''}${ms.map(m => `<td class="num">${rumah.filter(x => statusBulan(x.r, m).s === 'paid').length}</td>`).join('')}${adm ? `<td></td><td class="num">${rp(sum(rumah, x => x.tg.total))}</td><td></td>` : ''}</tr>
          ${adm ? `<tr class="total"><td class="sticky-col">Terkumpul</td><td></td>${ms.map(m => `<td class="num small">${(sum(rumah, x => S.paid.get(x.r.id + '|' + m) || 0) / 1000).toLocaleString('id-ID')}rb</td>`).join('')}<td></td><td></td><td></td></tr>` : ''}
        </tfoot>
      </table></div>`;
    bindYear(el, rerender);
    if (adm) {
      $('#fMin', el).onchange = e => { f.min = +e.target.value; rerender(); };
    }
    $('#fQ', el).onchange = e => { f.q = e.target.value; rerender(); };
  }

  function waLink(r, tg) {
    const rek = get('rumah_rekening', r.id) || {};
    const text = `Halo ${r.nama || ''} (${r.kode}),\n\nMengingatkan iuran IPL yang belum tercatat:\n${tg.bulan.map(m => '- ' + fmtBulan(m)).join('\n')}\n\nTotal: ${rp(tg.total)}\n\nJika sudah membayar, mohon konfirmasi. Terima kasih.`;
    let hp = String(rek.no_hp || '').replace(/[^\d]/g, ''); if (hp.startsWith('0')) hp = '62' + hp.slice(1);
    return esc(`https://wa.me/${hp}?text=${encodeURIComponent(text)}`);
  }

  // ---------- Rekap pengeluaran
  function pgPengeluaran(el) {
    const ms = monthsOfYear(S.year);
    const tx = S.d.transaksi.filter(t => t.tipe === 'pengeluaran' && ms.includes(t.bulan || t.tanggal.slice(0, 7)));
    const bm = t => t.bulan || t.tanggal.slice(0, 7);
    const kats = S.d.kategori.slice();
    if (tx.some(t => !get('kategori', t.kategori_id))) kats.push({ id: null, nama: 'Tanpa kategori' });
    const cell = (kid, m) => tx.filter(t => (get('kategori', t.kategori_id) ? t.kategori_id : null) === kid && (!m || bm(t) === m));
    {
      // Filter bulan: default bulan berjalan; "" = semua bulan
      if (S.pengBulan === undefined || (S.pengBulan && S.pengBulan.slice(0, 4) !== String(S.year))) S.pengBulan = String(S.year) === curYM().slice(0, 4) ? curYM() : '';
      const sel = S.pengBulan;
      const months = ms.filter(m => (!sel || m === sel) && tx.some(t => bm(t) === m)).reverse();
      const shownTx = sel ? tx.filter(t => bm(t) === sel) : tx;
      el.innerHTML = `
      <div class="toolbar">${yearSelect()}
        <label>Bulan<select id="fBulan">${opt('', 'Semua bulan', !sel)}${ms.slice().reverse().map(m => opt(m, BULAN[+m.slice(5) - 1], m === sel)).join('')}</select></label>
        <span class="muted small">Ketuk kategori untuk melihat rincian.</span></div>
      <div class="table-wrap"><table class="sectioned">
        <thead><tr><th>Kategori</th><th class="num">Nilai</th></tr></thead>
        ${months.map(m => `<tbody><tr class="sep"><td colspan="2">${fmtBulan(m)}</td></tr>
          ${kats.map(k => { const v = sum(cell(k.id, m), t => t.nilai); return v ? `<tr class="clickable-row" data-k="${k.id}" data-m="${m}"><td class="wrap">${esc(k.nama)}</td><td class="num">${rp(v)}</td></tr>` : ''; }).join('')}
          <tr class="subtotal"><td>Total ${fmtBulan(m)}</td><td class="num">${rp(sum(tx.filter(t => bm(t) === m), t => t.nilai))}</td></tr></tbody>`).join('') || `<tbody><tr><td colspan="2" class="empty">Belum ada pengeluaran${sel ? ' di ' + fmtBulan(sel) : ''}</td></tr></tbody>`}
        ${sel ? '' : `<tfoot><tr class="total"><td>Total ${S.year}</td><td class="num">${rp(sum(shownTx, t => t.nilai))}</td></tr></tfoot>`}
      </table></div>`;
    }
    bindYear(el, rerender);
    if ($('#fBulan', el)) $('#fBulan', el).onchange = e => { S.pengBulan = e.target.value; rerender(); };
    $$('[data-m]', el).forEach(s => s.onclick = () => {
      const kid = s.dataset.k === 'null' ? null : s.dataset.k;
      const list = cell(kid, s.dataset.m);
      openModal(`${kid ? get('kategori', kid).nama : 'Tanpa kategori'} — ${fmtBulan(s.dataset.m)}`, `<div class="table-wrap"><table class="stack">
        <thead><tr><th>Tanggal</th><th>Keterangan</th><th>Dompet</th><th class="num">Nilai</th></tr></thead>
        <tbody>${list.map(t => `<tr><td>${fmtTgl(t.tanggal)}</td><td class="wrap">${trxDesc(t)}</td><td class="meta">${esc((get('dompet', t.dompet_id) || {}).nama)}</td><td class="num">${rp(t.nilai)}</td></tr>`).join('')}</tbody>
        <tfoot><tr class="total"><td colspan="3">Total</td><td class="num">${rp(sum(list, t => t.nilai))}</td></tr></tfoot></table></div>`);
    });
  }

  // ---------- Gaji mitra
  // Per mitra per bulan:
  //  gaji     = gaji pokok (bulanan) atau jumlah kedatangan x tarif
  //  terbayar = gaji tengah/akhir/kasbon yang dibayar + semua cicilan hutang bulan itu
  //  belum    = gaji - terbayar;  lain = lembur, THR, lainnya;  total = terbayar + lain
  function gajiCalc(mt, m) {
    const isLain = t => ['lembur', 'thr', 'lainnya'].includes(t.komponen);
    const agg = S.agg || { pot: new Map(), kd: new Map() };
    const a = S.d.transaksi.filter(t => t.tipe === 'pengeluaran' && t.mitra_id === mt.id && (t.bulan || t.tanggal.slice(0, 7)) === m);
    const k = mt.id + '|' + m;
    const terbayar = sum(a.filter(t => !isLain(t)), t => t.nilai) + (agg.pot.get(k) || 0);
    const lain = sum(a.filter(isLain), t => t.nilai);
    let gaji;
    if (mt.jenis_gaji === 'kedatangan') gaji = agg.kd.has(k) ? agg.kd.get(k) * (Number(mt.gaji_pokok) || 0) : terbayar;
    else gaji = (a.length || agg.pot.has(k) || m === curYM()) ? Number(mt.gaji_pokok) || 0 : 0;
    return { gaji, terbayar, belum: Math.max(0, gaji - terbayar), lain, total: terbayar + lain };
  }
  function pgGaji(el) {
    const adm = isAdmin();
    const ms = monthsOfYear(S.year);
    const bm = t => t.bulan || t.tanggal.slice(0, 7);
    const tx = S.d.transaksi.filter(t => t.tipe === 'pengeluaran' && t.mitra_id && ms.includes(bm(t)));
    // Urut berdasarkan posisi (Satpam, Taman, lainnya), lalu nama
    const posRank = p => { const i = ['satpam', 'taman'].findIndex(x => String(p || '').toLowerCase().includes(x)); return i < 0 ? 9 : i; };
    const mitra = S.d.mitra.filter(m => m.aktif).sort((a, b) => posRank(a.posisi) - posRank(b.posisi) || String(a.posisi || '').localeCompare(String(b.posisi || ''), 'id') || a.nama.localeCompare(b.nama, 'id'));
    const shownMs = ms.filter(m => m <= curYM() || tx.some(t => bm(t) === m));
    const calc = gajiCalc;
    // Admin: gaji, sudah/belum terbayar, lain-lain, total diterima. Warga: gaji pokok seharusnya + lain-lain yang sudah diterima.
    const nCol = adm ? 6 : 4;
    const head = first => adm
      ? `<tr><th>${first}</th><th class="num">Gaji</th><th class="num">Sudah terbayar</th><th class="num">Belum terbayar</th><th class="num">Lembur & lainnya</th><th class="num">Total</th></tr>`
      : `<tr><th>${first}</th><th class="num">Gaji pokok</th><th class="num">Lembur & lainnya</th><th class="num">Total</th></tr>`;
    const cells = c => adm
      ? `<td class="num">${num0(c.gaji)}</td><td class="num">${num0(c.terbayar)}</td><td class="num ${c.belum ? 'neg' : ''}">${num0(c.belum)}</td><td class="num">${num0(c.lain)}</td><td class="num"><b>${num0(c.total)}</b></td>`
      : `<td class="num">${num0(c.gaji)}</td><td class="num">${num0(c.lain)}</td><td class="num"><b>${num0(c.gaji + c.lain)}</b></td>`;
    const foot = list => adm
      ? `<td class="num">${num0(sum(list, c => c.gaji))}</td><td class="num">${num0(sum(list, c => c.terbayar))}</td><td class="num">${num0(sum(list, c => c.belum))}</td><td class="num">${num0(sum(list, c => c.lain))}</td><td class="num">${num0(sum(list, c => c.total))}</td>`
      : `<td class="num">${num0(sum(list, c => c.gaji))}</td><td class="num">${num0(sum(list, c => c.lain))}</td><td class="num">${num0(sum(list, c => c.gaji + c.lain))}</td>`;
    if (S.gajiBulan === undefined || (S.gajiBulan && S.gajiBulan.slice(0, 4) !== String(S.year))) S.gajiBulan = String(S.year) === curYM().slice(0, 4) ? curYM() : '';
    const sel = S.gajiBulan;
    const bulanSelect = `<label>Bulan<select id="fBulanGaji">${opt('', 'Semua bulan', !sel)}${shownMs.slice().reverse().map(m => opt(m, BULAN[+m.slice(5) - 1], m === sel)).join('')}</select></label>`;
    let body;
    if (sel) {
      const rows = mitra.map(mt => ({ mt, c: calc(mt, sel) }));
      body = `<div class="table-wrap"><table class="sectioned compact">
        <thead><tr class="sep"><td colspan="${nCol}">${fmtBulan(sel)}</td></tr>${head('Mitra')}</thead>
        <tbody>${rows.map(r => `<tr><td>${esc(r.mt.nama)}<div class="muted small">${esc(r.mt.posisi || '')}${r.mt.jenis_gaji === 'kedatangan' ? ' · per kedatangan' : ''}</div></td>${cells(r.c)}</tr>`).join('') || `<tr><td colspan="${nCol}" class="empty">Belum ada mitra aktif</td></tr>`}</tbody>
        <tfoot><tr class="subtotal"><td>Total</td>${foot(rows.map(r => r.c))}</tr></tfoot>
      </table></div>`;
    } else {
      body = mitra.map(mt => {
        const list = shownMs.map(m => ({ m, c: calc(mt, m) }));
        return `<div class="table-wrap mitra-block"><table class="sectioned compact">
          <thead><tr class="sep"><td colspan="${nCol}">${esc(mt.nama)} <span class="sep-sub">${esc(mt.posisi || '')}${adm ? ' · ' + gajiLabel(mt) : (mt.jenis_gaji === 'kedatangan' ? ' · per kedatangan' : '')}</span></td></tr>${head('Bulan')}</thead>
          <tbody>${list.map(x => `<tr><td>${BLN[+x.m.slice(5) - 1]}</td>${cells(x.c)}</tr>`).join('')}</tbody>
          <tfoot><tr class="subtotal"><td>Total</td>${foot(list.map(x => x.c))}</tr></tfoot>
        </table></div>`;
      }).join('') || '<div class="empty">Belum ada mitra aktif</div>';
    }
    el.innerHTML = `
      <div class="toolbar">${yearSelect()}${bulanSelect}</div>
      ${body}
      <p class="hint">${adm ? 'Angka dalam Rupiah. Sudah terbayar = gaji yang sudah dibayarkan, termasuk kasbon dan cicilan hutang bulan itu (yang akan dipotong saat pencairan). Total = gaji yang sudah diterima + lembur & lainnya. Mitra yang sudah resign tidak ditampilkan.' : 'Angka dalam Rupiah. Total = gaji pokok + lembur & lainnya yang sudah diterima.'}</p>
      ${adm && sel ? '<div class="panel rw" style="margin-top:18px"><h3>Pencairan gaji ' + fmtBulan(sel) + '</h3><div id="pcrBox"></div></div>' : ''}`;
    bindYear(el, rerender);
    $('#fBulanGaji', el).onchange = e => { S.gajiBulan = e.target.value; rerender(); };
    if (adm && sel) pgPencairan($('#pcrBox', el), sel);
  }

  // ---------- Rekap keuangan (saldo per rekening & tunai)
  function pgKeuangan(el) {
    const adm = isAdmin(), tx = S.d.transaksi;
    const info = w => {
      const by = f => sum(tx.filter(f), t => t.nilai);
      return { w, saldo: saldo(w.id),
        masuk: by(t => (t.tipe === 'iuran' || t.tipe === 'pemasukan') && t.dompet_id === w.id),
        keluar: by(t => t.tipe === 'pengeluaran' && t.dompet_id === w.id),
        mIn: by(t => t.tipe === 'mutasi' && t.dompet_tujuan_id === w.id),
        mOut: by(t => t.tipe === 'mutasi' && t.dompet_id === w.id) };
    };
    const list = jenis => S.d.dompet.filter(w => w.jenis === jenis && (w.aktif || Math.abs(saldo(w.id)) > 0.004)).map(info);
    const rek = list('rekening'), tun = list('tunai');
    const card = x => `<div class="pc-card">
        <div class="mhead"><b>${esc(x.w.nama)}</b>${x.w.aktif ? '' : ' <span class="badge">nonaktif</span>'}</div>
        <div class="kas-saldo ${x.saldo < 0 ? 'neg' : ''}">${rp(x.saldo)}</div>
        <div class="pc-calc">
          <div class="mrow"><span>Saldo awal</span><span>${rp(x.w.saldo_awal)}</span></div>
          <div class="mrow"><span>+ Uang masuk</span><span>${rp(x.masuk)}</span></div>
          <div class="mrow"><span>− Uang keluar</span><span>${rp(x.keluar)}</span></div>
          <div class="mrow"><span>+ Mutasi masuk</span><span>${rp(x.mIn)}</span></div>
          <div class="mrow"><span>− Mutasi keluar</span><span>${rp(x.mOut)}</span></div>
        </div>
        ${adm ? `<div class="row-actions"><button class="btn small" data-adj="${x.w.id}">Sesuaikan saldo</button><button class="btn small" data-riw="${x.w.id}">Lihat transaksi</button></div>` : ''}
      </div>`;
    const muts = tx.filter(t => t.tipe === 'mutasi').slice(-20).reverse();
    el.innerHTML = `
      <div class="cards">
        <div class="card"><div class="label">Total kas</div><div class="value">${rp(sum(rek, x => x.saldo) + sum(tun, x => x.saldo))}</div></div>
        <div class="card"><div class="label">Total rekening</div><div class="value">${rp(sum(rek, x => x.saldo))}</div></div>
        <div class="card"><div class="label">Total tunai</div><div class="value">${rp(sum(tun, x => x.saldo))}</div></div>
      </div>
      ${adm ? '<div class="toolbar"><span class="spacer"></span><button class="btn primary" id="newMut">+ Catat mutasi</button></div>' : ''}
      <h3 class="pc-title">Saldo rekening</h3><div class="pc-list">${rek.map(card).join('') || '<div class="empty">Belum ada rekening</div>'}</div>
      <h3 class="pc-title">Saldo tunai</h3><div class="pc-list">${tun.map(card).join('') || '<div class="empty">Belum ada pemegang tunai</div>'}</div>
      <div class="panel"><h3>Mutasi terakhir</h3>${muts.length ? `<div class="table-wrap"><table class="stack"><tbody>
        ${muts.map(t => `<tr><td>${fmtTgl(t.tanggal)}</td><td class="wrap">${trxDesc(t)}</td><td class="num">${rp(t.nilai)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Belum ada mutasi</div>'}</div>`;
    if ($('#newMut', el)) $('#newMut', el).onclick = () => { S.inputTipe = 'mutasi'; location.hash = '#input'; };
    $$('[data-riw]', el).forEach(b => b.onclick = () => { S.fRiw = { dari: '', sampai: '', tipe: '', dompet: b.dataset.riw, kategori: '', q: '', n: 100 }; location.hash = '#riwayat'; });
    $$('[data-adj]', el).forEach(b => b.onclick = () => {
      const w = get('dompet', b.dataset.adj), now = saldo(w.id);
      openModal('Sesuaikan saldo ' + w.nama, `<form id="adjF"><p class="hint">Saldo di aplikasi saat ini <b>${rp(now)}</b>. Isi saldo sebenarnya (mis. dari aplikasi bank atau hitungan uang tunai). Saldo awal akan disesuaikan sehingga saldo di aplikasi sama, tanpa membuat transaksi.</p>
        <label>Saldo sebenarnya (Rp)<input name="nyata" id="adjNyata" data-money inputmode="decimal" required></label>
        <div class="form-actions"><button type="button" class="btn" id="cancelBtn">Batal</button><button class="btn primary">Simpan</button></div></form>`, body => {
        moneyInputs(body); $('#cancelBtn', body).onclick = closeModal;
        $('#adjF', body).onsubmit = async e => {
          e.preventDefault();
          const nyata = parseRp($('#adjNyata', body).value);
          // Muat ulang data terbaru dulu agar perhitungan tidak memakai data lama di tab ini
          if (await run(async () => {
            await reload('dompet', 'transaksi');
            const w2 = get('dompet', w.id), now2 = saldo(w.id);
            const awal = Math.round((w2.saldo_awal + nyata - now2) * 100) / 100;
            await DB.update('dompet', w.id, { saldo_awal: awal }); await reload('dompet');
          }, 'Saldo disesuaikan')) { closeModal(); rerender(); }
        };
      });
    });
  }

  // ---------- Besaran IPL
  function pgIpl(el) {
    const aktif = S.d.rumah.filter(r => r.aktif);
    const now = curYM(), prev = ymAdd(now, -1);
    const potensi = sum(aktif, r => r.ipl);
    const realNow = sum(aktif, r => S.paid.get(r.id + '|' + now) || 0);
    const realPrev = sum(aktif, r => S.paid.get(r.id + '|' + prev) || 0);
    const rutin = aktif.filter(r => [1, 2, 3].every(i => statusBulan(r, ymAdd(now, -i)).s !== 'unpaid')).length;
    el.innerHTML = `
      <div class="cards">
        <div class="card"><div class="label">Jumlah rumah aktif</div><div class="value">${aktif.length}</div></div>
        <div class="card"><div class="label">Rutin bayar (3 bulan terakhir)</div><div class="value">${rutin}</div></div>
        <div class="card"><div class="label">Potensi penerimaan / bulan</div><div class="value">${rp(potensi)}</div></div>
        <div class="card"><div class="label">Realisasi ${fmtBulan(prev)}</div><div class="value">${rp(realPrev)} <span class="small muted">${potensi ? Math.round(realPrev / potensi * 100) : 0}%</span></div></div>
        <div class="card"><div class="label">Realisasi ${fmtBulan(now)}</div><div class="value">${rp(realNow)} <span class="small muted">${potensi ? Math.round(realNow / potensi * 100) : 0}%</span></div></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Rumah</th><th class="num">IPL / bulan</th><th class="num">Tunggakan</th></tr></thead>
        <tbody>${S.d.rumah.map(r => { const tg = tunggakan(r);
          return `<tr><td>${esc(rumahLabel(r))}${r.aktif ? '' : ' <span class="badge">nonaktif</span>'}</td><td class="num">${rp(r.ipl)}</td><td class="num ${tg.bulan.length ? 'neg' : ''}">${tg.bulan.length} bln · ${rp(tg.total)}</td></tr>`; }).join('')}</tbody>
      </table></div>`;
  }

  // ---------- Input transaksi
  function pgInput(el) {
    const tipe = S.inputTipe || 'iuran';
    el.innerHTML = `<div class="tabs">${Object.keys(TIPE_LABEL).map(t => `<button data-t="${t}" class="${t === tipe ? 'active' : ''}">${TIPE_LABEL[t]}</button>`).join('')}</div>
      <div class="panel" id="formBox"></div>
      <div class="panel"><h3>Input terakhir</h3><div id="lastBox"></div></div>`;
    $$('.tabs button', el).forEach(b => b.onclick = () => { S.inputTipe = b.dataset.t; rerender(); });
    const showLast = () => {
      const last = S.d.transaksi.slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 8);
      $('#lastBox', el).innerHTML = last.length ? `<div class="table-wrap"><table class="stack"><tbody>${last.map(t => `<tr><td>${fmtTgl(t.tanggal)}</td><td><span class="badge ${TIPE_BADGE[t.tipe]}">${TIPE_LABEL[t.tipe]}</span></td><td class="wrap">${trxDesc(t)}</td><td class="num">${rp(t.nilai)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Belum ada transaksi</div>';
    };
    trxForm($('#formBox', el), tipe, null, showLast);
    showLast();
  }

  function trxForm(box, tipe, ex, done) {
    const dompetOpts = (sel, filter) => S.d.dompet.filter(w => (w.aktif || w.id === sel) && (!filter || filter(w)))
      .map(w => opt(w.id, w.jenis === 'rekening' ? `Transfer (${w.nama})` : w.nama, w.id === sel)).join('');
    const tgl = ex ? ex.tanggal : (S.lastTgl || todayISO());
    const defDompet = ex ? ex.dompet_id : (S.lastDompet || (S.d.dompet.find(w => w.jenis === 'rekening' && /mandiri/i.test(w.nama)) || S.d.dompet[0] || {}).id);
    let html = `<form id="trxForm"><div class="form-grid">
      <label>Tanggal<input type="date" name="tanggal" required value="${tgl}"></label>`;
    if (tipe === 'iuran') {
      const r = ex ? get('rumah', ex.rumah_id) : null;
      html += `<label>Rumah<input name="rumah" list="dlRumah" required placeholder="Ketik kode / nama" value="${esc(r ? rumahLabel(r) : '')}" autocomplete="off">
          <datalist id="dlRumah">${S.d.rumah.filter(x => x.aktif || x === r).map(x => `<option value="${esc(rumahLabel(x))}">`).join('')}</datalist></label>
        <label>Jenis bayar<select name="dompet_id">${dompetOpts(defDompet)}</select></label>
        <label>Jumlah (Rp)<input name="nilai" data-money inputmode="decimal" required value="${ex ? ex.nilai : ''}"></label>
        </div>
        <div class="hint" id="rumahInfo">Pilih rumah untuk melihat IPL dan bulan yang sudah lunas.</div>
        <div style="display:flex;align-items:center;gap:8px"><button type="button" class="btn small" id="yPrev">&lsaquo;</button><b id="yLbl"></b><button type="button" class="btn small" id="yNext">&rsaquo;</button><span class="muted small" id="monthHint">Pilih bulan yang dibayar (bisa lebih dari satu)</span></div>
        <div class="months" id="monthsBox"></div>
        <label class="check inline"><input type="checkbox" id="sebagian"> Bayar sebagian (jumlah kurang dari tagihan)</label>
        <div class="form-grid">`;
    } else if (tipe === 'pemasukan') {
      html += `<label>Jumlah (Rp)<input name="nilai" data-money inputmode="decimal" required value="${ex ? ex.nilai : ''}"></label>
        <label>Masuk ke<select name="dompet_id">${dompetOpts(defDompet)}</select></label>
        <label>Bulan<input type="month" name="bulan" value="${ex ? ex.bulan || '' : tgl.slice(0, 7)}"></label>`;
    } else if (tipe === 'pengeluaran') {
      html += `<label>Nilai (Rp)<input name="nilai" data-money inputmode="decimal" required value="${ex ? ex.nilai : ''}"></label>
        <label>Kategori<select name="kategori_id" required>${opt('', '— pilih —')}${S.d.kategori.map(k => opt(k.id, k.nama, ex && ex.kategori_id === k.id)).join('')}</select></label>
        <label>Dibayar dari<select name="dompet_id">${dompetOpts(defDompet)}</select></label>
        <label>Bulan pembebanan<input type="month" name="bulan" required value="${ex ? ex.bulan || '' : tgl.slice(0, 7)}"></label>
        <label>Mitra (opsional)<select name="mitra_id">${opt('', '— bukan untuk mitra —')}${S.d.mitra.filter(m => m.aktif || (ex && ex.mitra_id === m.id)).map(m => opt(m.id, `${m.nama} (${m.posisi || ''})`, ex && ex.mitra_id === m.id)).join('')}</select></label>
        <label>Komponen<select name="komponen">${opt('', '—')}${Object.keys(KOMPONEN).map(k => opt(k, KOMPONEN[k], ex && ex.komponen === k)).join('')}</select></label>`;
    } else {
      const grouped = sel => ['rekening', 'tunai'].map(j => `<optgroup label="${j === 'rekening' ? 'Rekening bank' : 'Tunai'}">${S.d.dompet.filter(w => w.jenis === j && (w.aktif || w.id === sel)).map(w => opt(w.id, w.nama, w.id === sel)).join('')}</optgroup>`).join('');
      const rekList = S.d.dompet.filter(w => w.jenis === 'rekening' && w.aktif);
      html += `<label>Nilai mutasi (Rp)<input name="nilai" data-money inputmode="decimal" required value="${ex ? ex.nilai : ''}"></label>
        <label>Dari<select name="dompet_id">${grouped(ex ? ex.dompet_id : (rekList[0] || {}).id)}</select></label>
        <label>Ke<select name="dompet_tujuan_id">${grouped(ex ? ex.dompet_tujuan_id : (rekList[1] || S.d.dompet.find(w => w.jenis === 'tunai') || {}).id)}</select></label>
        ${ex ? '' : '<label>Biaya admin bank (opsional)<input name="biaya" data-money inputmode="decimal" placeholder="0"></label>'}
        <p class="hint" style="grid-column:1/-1">Antar bank (mis. Mandiri → Krom), tarik tunai (rekening → tunai), setor tunai (tunai → rekening), atau antar pemegang tunai. Biaya admin dicatat sebagai pengeluaran dari dompet asal.</p>`;
    }
    html += `<label style="grid-column:1/-1">${tipe === 'pemasukan' ? 'Sumber / keterangan' : 'Keterangan'}<input name="keterangan" ${tipe === 'iuran' || tipe === 'mutasi' ? '' : 'required'} value="${esc(ex ? ex.keterangan : '')}"></label>
      </div><div class="form-actions">${ex ? '<button type="button" class="btn" id="cancelBtn">Batal</button>' : ''}<button class="btn primary" type="submit">${ex ? 'Simpan perubahan' : 'Simpan'}</button></div></form>`;
    box.innerHTML = html;
    const form = $('#trxForm', box);
    moneyInputs(form);
    if ($('#cancelBtn', box)) $('#cancelBtn', box).onclick = closeModal;

    // --- logika khusus iuran
    let sel = new Set(ex ? (S.iuranByTrx.get(ex.id) || []).map(b => b.bulan) : []);
    let y = sel.size ? +[...sel].sort()[0].slice(0, 4) : new Date().getFullYear();
    const curRumah = () => S.d.rumah.find(r => rumahLabel(r) === form.rumah.value.trim()) || S.d.rumah.find(r => r.kode.toLowerCase() === form.rumah.value.trim().split(' - ')[0].toLowerCase());
    const ownPaid = (r, m) => sum((ex && S.iuranByTrx.get(ex.id) || []).filter(b => b.bulan === m && b.rumah_id === r.id), b => b.nominal);
    const sisa = (r, m) => r.ipl > 0 ? Math.max(0, r.ipl - ((S.paid.get(r.id + '|' + m) || 0) - ownPaid(r, m))) : Infinity;
    const tagihan = r => sum([...sel], m => sisa(r, m));
    const cb = $('#sebagian', box);
    function syncNilai() {
      if (tipe !== 'iuran') return;
      const r = curRumah(), auto = !!(r && r.ipl > 0 && !cb.checked);
      form.nilai.readOnly = auto;
      if (auto) form.nilai.value = sel.size ? fmtNum(tagihan(r)) : '';
    }
    function drawMonths() {
      if (tipe !== 'iuran') return;
      const r = curRumah();
      $('#yLbl', box).textContent = y;
      $('#monthsBox', box).innerHTML = monthsOfYear(y).map(m => {
        const s = r ? sisa(r, m) : null;
        const lunas = !!r && s === 0, part = !!r && r.ipl > 0 && s > 0 && s < r.ipl;
        if (lunas) sel.delete(m);
        return `<button type="button" data-m="${m}" class="${sel.has(m) ? 'sel' : ''} ${lunas ? 'lunas' : ''} ${part ? 'part' : ''}" ${lunas ? 'disabled title="Sudah lunas"' : ''}>${BLN[+m.slice(5) - 1]}${lunas ? ' ✓' : ''}${part ? `<small>sisa ${num0(s)}</small>` : ''}</button>`;
      }).join('');
      $$('#monthsBox button:not([disabled])', box).forEach(b => b.onclick = () => {
        const m = b.dataset.m;
        if (cb.checked) sel = new Set(sel.has(m) ? [] : [m]);
        else sel.has(m) ? sel.delete(m) : sel.add(m);
        drawMonths(); syncNilai();
      });
      if (r) { const tg = tunggakan(r); $('#rumahInfo', box).innerHTML = `IPL <b>${rp(r.ipl)}</b>/bulan · Tunggakan: ${tg.bulan.length ? tg.bulan.map(fmtBulan).join(', ') : 'tidak ada'}`; }
    }
    if (tipe === 'iuran') {
      let lastRumah = ex ? ex.rumah_id : null;
      form.rumah.addEventListener('change', () => {
        const r = curRumah();
        if ((r ? r.id : null) === lastRumah) return;
        lastRumah = r ? r.id : null;
        if (r && !ex) { const tg = tunggakan(r); const next = tg.bulan[0] || curYM(); sel = new Set([next]); y = +next.slice(0, 4); }
        drawMonths(); syncNilai();
      });
      cb.onchange = () => {
        if (cb.checked && sel.size > 1) { sel = new Set([[...sel].sort()[0]]); drawMonths(); toast('Bayar sebagian hanya untuk satu bulan'); }
        $('#monthHint', box).textContent = cb.checked ? 'Pilih satu bulan yang dibayar sebagian' : 'Pilih bulan yang dibayar (bisa lebih dari satu)';
        syncNilai(); if (cb.checked) form.nilai.focus();
      };
      $('#yPrev', box).onclick = () => { y--; drawMonths(); };
      $('#yNext', box).onclick = () => { y++; drawMonths(); };
      drawMonths();
      if (ex) { const r = curRumah(); cb.checked = !!(r && r.ipl > 0 && ex.nilai < tagihan(r) && sel.size === 1); if (cb.checked) $('#monthHint', box).textContent = 'Pilih satu bulan yang dibayar sebagian'; }
      syncNilai();
    }
    if (tipe === 'pemasukan' || tipe === 'pengeluaran') form.tanggal.addEventListener('change', () => { if (!ex) form.bulan.value = form.tanggal.value.slice(0, 7); });

    form.onsubmit = async e => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(form));
      const row = { tipe, tanggal: fd.tanggal, nilai: parseRp(fd.nilai), dompet_id: fd.dompet_id, keterangan: (fd.keterangan || '').trim(),
        dompet_tujuan_id: null, kategori_id: null, rumah_id: null, mitra_id: null, komponen: null, bulan: fd.bulan || fd.tanggal.slice(0, 7) };
      if (!row.nilai) return warn('Nilai harus lebih dari 0.');
      let rumah, months, alloc;
      if (tipe === 'iuran') {
        rumah = curRumah();
        if (!rumah) return warn('Rumah tidak ditemukan. Pilih dari daftar.');
        months = [...sel].sort();
        if (!months.length) return warn('Pilih minimal satu bulan.');
        if (cb.checked && months.length > 1) return warn('Bayar sebagian hanya bisa untuk satu bulan.');
        if (rumah.ipl > 0) {
          const total = sum(months, m => sisa(rumah, m));
          if (row.nilai > total) return warn(`Jumlah melebihi tagihan bulan yang dipilih (${rp(total)}).`);
          let left = row.nilai; alloc = [];
          months.forEach(m => { const a = Math.min(left, sisa(rumah, m)); if (a > 0) alloc.push([m, a]); left -= a; });
        } else {
          const per = Math.floor(row.nilai / months.length);
          alloc = months.map((m, i) => [m, i === months.length - 1 ? row.nilai - per * (months.length - 1) : per]);
        }
        row.rumah_id = rumah.id; row.bulan = alloc[0][0];
      }
      if (tipe === 'pengeluaran') { row.kategori_id = fd.kategori_id || null; row.mitra_id = fd.mitra_id || null; row.komponen = fd.mitra_id ? (fd.komponen || 'gaji') : (fd.komponen || null); }
      if (tipe === 'mutasi') { row.dompet_tujuan_id = fd.dompet_tujuan_id; if (row.dompet_tujuan_id === row.dompet_id) return warn('Dompet asal dan tujuan tidak boleh sama.'); }
      const ok = await run(async () => {
        let id;
        if (ex) { id = ex.id; await DB.update('transaksi', id, row); if (tipe === 'iuran') await DB.removeWhere('iuran_bulan', 'transaksi_id', id); }
        else { id = uuid(); await DB.insert('transaksi', Object.assign({ id }, row)); }
        if (tipe === 'mutasi' && !ex && parseRp(fd.biaya) > 0) {
          const kb = S.d.kategori.find(k => /biaya admin/i.test(k.nama)) || S.d.kategori.find(k => /lainnya/i.test(k.nama)) || S.d.kategori[0];
          await DB.insert('transaksi', { id: uuid(), tipe: 'pengeluaran', tanggal: row.tanggal, nilai: parseRp(fd.biaya), dompet_id: row.dompet_id, dompet_tujuan_id: null, kategori_id: kb ? kb.id : null,
            rumah_id: null, mitra_id: null, komponen: null, bulan: row.tanggal.slice(0, 7),
            keterangan: `Biaya admin mutasi ${(get('dompet', row.dompet_id) || {}).nama} → ${(get('dompet', row.dompet_tujuan_id) || {}).nama}` });
        }
        if (tipe === 'iuran') {
          await DB.insert('iuran_bulan', alloc.map(([m, a]) => ({ id: uuid(), transaksi_id: id, rumah_id: rumah.id, bulan: m, nominal: a })));
        }
        await reload('transaksi', 'iuran_bulan');
      }, ex ? 'Perubahan disimpan' : 'Transaksi disimpan');
      if (!ok) return;
      S.lastTgl = row.tanggal; S.lastDompet = row.dompet_id;
      if (ex) { closeModal(); done && done(); }
      else { trxForm(box, tipe, null, done); done && done(); }
    };
  }

  // ---------- Pencairan gaji mitra
  function pgPencairan(el, forcedBulan) {
    const rekList = S.d.dompet.filter(w => w.jenis === 'rekening' && w.aktif);
    const tunaiList = S.d.dompet.filter(w => w.jenis === 'tunai' && w.aktif);
    const st = S.pcr || (S.pcr = { bulan: curYM(), tahap: new Date().getDate() <= 20 ? 'tengah' : 'akhir', tanggal: todayISO(), metode: 'transfer', tunaiId: (tunaiList[0] || {}).id, ov: {} });
    if (forcedBulan) st.bulan = forcedBulan;
    if (!st.rekId || !rekList.some(w => w.id === st.rekId)) st.rekId = (rekList.find(w => /mandiri/i.test(w.nama)) || rekList[0] || {}).id;
    const rek = get('dompet', st.rekId);
    const key = st.bulan + '|' + st.tahap;
    const ov = st.ov[key] || (st.ov[key] = {});
    const kat = S.d.kategori.find(k => /gaji/i.test(k.nama)) || S.d.kategori[0];
    const tengah = st.tahap === 'tengah';
    const rows = S.d.mitra.filter(m => m.aktif).map(m => {
      const o = ov[m.id] || (ov[m.id] = {});
      const tx = S.d.transaksi.filter(t => t.tipe === 'pengeluaran' && t.mitra_id === m.id && t.bulan === st.bulan);
      const kedatangan = m.jenis_gaji === 'kedatangan';
      const tarif = Number(m.gaji_pokok) || 0;
      const cic = S.d.hutang_mitra.filter(h => h.mitra_id === m.id && h.bulan === st.bulan && !h.lunas);
      const cicTotal = sum(cic, h => h.nominal);
      const r = { m, o, kedatangan, cic, potong: 0, note: '', metode: o.metode || st.metode };
      if (kedatangan) {
        // Dibayar per kedatangan, tidak mengikuti tahap tengah/akhir bulan
        r.visits = S.d.kedatangan_mitra.filter(v => v.mitra_id === m.id && v.bulan === st.bulan).sort((a, b) => a.ke - b.ke);
        o.vsel = o.vsel || {};
        r.chosen = r.visits.filter(v => !v.transaksi_id && o.vsel[v.id] !== false);
        r.paidCount = r.visits.filter(v => v.transaksi_id).length;
        r.base = r.chosen.length * tarif;
        if (cicTotal && r.base >= cicTotal) r.potong = cicTotal;
        else if (cicTotal && r.chosen.length) r.note = 'Pembayaran belum cukup untuk cicilan, cicilan bulan ini tidak dipotong.';
        r.auto = Math.max(0, r.base - r.potong);
        r.done = r.visits.length > 0 && r.paidCount === r.visits.length;
        r.doneAmt = sum(tx, t => t.nilai);
        r.amount = o.amount != null && r.chosen.length ? o.amount : r.auto;
        r.include = r.chosen.length > 0 && (o.include != null ? o.include : true);
        return r;
      }
      const paidTengah = sum(tx.filter(t => t.komponen === 'gaji_tengah'), t => t.nilai);
      const paidKasbon = sum(tx.filter(t => t.komponen === 'kasbon'), t => t.nilai);
      Object.assign(r, { base: tarif, paidTengah, paidKasbon });
      if (tengah) r.auto = Math.round(tarif / 2 / 50000) * 50000;
      else {
        const sisaGaji = tarif - paidTengah - paidKasbon;
        if (cicTotal && sisaGaji >= cicTotal) r.potong = cicTotal;
        else if (cicTotal) r.note = 'Gaji tidak cukup, cicilan bulan ini tidak dipotong.';
        r.auto = Math.max(0, sisaGaji - r.potong);
      }
      const doneTx = tengah ? tx.filter(t => t.komponen === 'gaji_tengah') : tx.filter(t => t.komponen === 'gaji' || !t.komponen);
      r.done = doneTx.length > 0; r.doneAmt = sum(doneTx, t => t.nilai);
      r.amount = o.amount != null ? o.amount : r.auto;
      r.include = !r.done && (o.include != null ? o.include : (r.amount > 0 || r.potong > 0));
      return r;
    });
    const go = rows.filter(r => r.include);
    const payInputs = r => `<div class="pc-inputs"><label>Jumlah dibayar<input data-amt="${r.m.id}" data-money inputmode="decimal" value="${r.amount}"></label>
          <label>Metode<select data-met="${r.m.id}">${opt('transfer', 'Transfer', r.metode === 'transfer')}${opt('tunai', 'Tunai', r.metode === 'tunai')}</select></label></div>`;
    const cicRow = r => (r.potong ? `<div class="mrow"><span>− Cicilan hutang (ke-${r.cic.map(h => h.cicilan_ke).join(', ')})</span><span>${rp(r.potong)}</span></div>` : '')
      + (r.note ? `<div class="small neg">${r.note}</div>` : '');
    const cardKedatangan = r => {
      const tglBayar = v => { const t = get('transaksi', v.transaksi_id); return t ? fmtTgl(t.tanggal) : ''; };
      return `<div class="pc-card ${r.done ? 'done' : ''}">
        <div class="pc-head"><label class="check"><input type="checkbox" data-inc="${r.m.id}" ${r.include ? 'checked' : ''} ${r.chosen.length ? '' : 'disabled'}> <b>${esc(r.m.nama)}</b></label>
          <span class="muted small">${esc(r.m.posisi || '')} · ${gajiLabel(r.m)}</span></div>
        <div class="visit-count"><span>Kedatangan ${fmtBulan(st.bulan)}</span>
          <div class="stepper"><button type="button" class="btn small" data-vminus="${r.m.id}" ${r.visits.length && !r.visits[r.visits.length - 1].transaksi_id ? '' : 'disabled'} aria-label="Kurangi kedatangan">−</button>
          <b>${r.visits.length}×</b><button type="button" class="btn small" data-vplus="${r.m.id}" aria-label="Tambah kedatangan">+</button></div></div>
        ${r.visits.length ? `<div class="visits">${r.visits.map(v => v.transaksi_id
          ? `<div class="visit paid"><span>Kedatangan ke-${v.ke}</span><span class="badge ok">Dibayar ${tglBayar(v)}</span></div>`
          : `<label class="visit"><span>Kedatangan ke-${v.ke}</span><span class="check-r"><input type="checkbox" data-visit="${r.m.id}|${v.id}" ${r.o.vsel[v.id] !== false ? 'checked' : ''}> Bayar</span></label>`).join('')}</div>`
          : '<div class="muted small">Belum ada kedatangan bulan ini. Tekan + untuk menambah.</div>'}
        ${r.chosen.length ? `<div class="pc-calc">
          <div class="mrow"><span>${r.chosen.length} kedatangan × ${rp(r.m.gaji_pokok)}</span><span>${rp(r.base)}</span></div>
          ${cicRow(r)}
          <div class="mrow strong"><span>Diterima</span><span>${rp(r.auto)}</span></div></div>${payInputs(r)}`
          : (r.done ? `<span class="badge ok">Semua kedatangan sudah dibayar (${rp(r.doneAmt)})</span>` : '')}
      </div>`;
    };
    const cardBulanan = r => `<div class="pc-card ${r.done ? 'done' : ''}">
        <div class="pc-head"><label class="check"><input type="checkbox" data-inc="${r.m.id}" ${r.include ? 'checked' : ''} ${r.done ? 'disabled' : ''}> <b>${esc(r.m.nama)}</b></label>
          <span class="muted small">${esc(r.m.posisi || '')} · ${gajiLabel(r.m)}</span></div>
        ${r.done ? `<span class="badge ok">Sudah dicairkan ${rp(r.doneAmt)}</span>` : `
        ${!tengah ? `<div class="pc-calc">
          <div class="mrow"><span>Gaji</span><span>${rp(r.base)}</span></div>
          ${r.paidTengah ? `<div class="mrow"><span>− Dibayar tengah bulan</span><span>${rp(r.paidTengah)}</span></div>` : ''}
          ${r.paidKasbon ? `<div class="mrow"><span>− Kasbon</span><span>${rp(r.paidKasbon)}</span></div>` : ''}
          ${cicRow(r)}
          <div class="mrow strong"><span>Diterima</span><span>${rp(r.auto)}</span></div></div>` : ''}
        ${payInputs(r)}`}
      </div>`;
    const bulananRows = rows.filter(r => !r.kedatangan), kdRows = rows.filter(r => r.kedatangan);
    el.innerHTML = `
      <div class="toolbar">
        ${forcedBulan ? '' : `<label>Bulan gaji<input type="month" id="pBulan" value="${st.bulan}"></label>`}
        <label>Tahap (gaji bulanan)<select id="pTahap">${opt('tengah', 'Tengah bulan', tengah)}${opt('akhir', 'Akhir bulan / sekali bayar', !tengah)}</select></label>
        <label>Tanggal bayar<input type="date" id="pTgl" value="${st.tanggal}"></label>
        <label>Metode (semua)<select id="pMetode">${opt('transfer', 'Transfer', st.metode === 'transfer')}${opt('tunai', 'Tunai', st.metode === 'tunai')}</select></label>
        ${rekList.length > 1 ? `<label>Transfer dari<select id="pRek">${rekList.map(w => opt(w.id, w.nama, w.id === st.rekId)).join('')}</select></label>` : ''}
        ${tunaiList.length > 1 && (st.metode === 'tunai' || rows.some(r => r.metode === 'tunai')) ? `<label>Tunai dari<select id="pTunai">${tunaiList.map(w => opt(w.id, w.nama, w.id === st.tunaiId)).join('')}</select></label>` : ''}
      </div>
      ${bulananRows.length ? `<h3 class="pc-title">Gaji bulanan</h3>
      <p class="hint">${tengah ? 'Tengah bulan: bayar sebagian gaji. Jumlah awal 50% gaji, bisa diubah.' : 'Akhir bulan: gaji dikurangi pembayaran tengah bulan, kasbon, dan cicilan hutang bulan ini. Pilih tahap ini juga untuk mitra yang dibayar sekali sebulan.'}</p>
      <div class="pc-list">${bulananRows.map(cardBulanan).join('')}</div>` : ''}
      ${kdRows.length ? `<h3 class="pc-title">Gaji per kedatangan</h3>
      <p class="hint">Catat berapa kali mitra datang bulan ini, lalu centang kedatangan yang dibayar sekarang. Kedatangan yang sudah dibayar terkunci.</p>
      <div class="pc-list">${kdRows.map(cardKedatangan).join('')}</div>` : ''}
      ${rows.length ? '' : '<div class="empty">Belum ada mitra aktif. Tambahkan di Master Data → Mitra.</div>'}
      <div class="pc-bar"><div><div class="muted small">${fmtBulan(st.bulan)} · ${go.length} mitra</div><b class="pc-total">${rp(sum(go, r => r.amount))}</b></div>
        <button class="btn primary" id="doCair" ${go.length ? '' : 'disabled'}>Cairkan gaji</button></div>`;
    moneyInputs(el);
    if ($('#pBulan', el)) $('#pBulan', el).onchange = e => { if (e.target.value) { st.bulan = e.target.value; rerender(); } };
    $('#pTahap', el).onchange = e => { st.tahap = e.target.value; rerender(); };
    $('#pTgl', el).onchange = e => { st.tanggal = e.target.value || todayISO(); };
    $('#pMetode', el).onchange = e => { st.metode = e.target.value; Object.values(ov).forEach(o => delete o.metode); rerender(); };
    if ($('#pTunai', el)) $('#pTunai', el).onchange = e => { st.tunaiId = e.target.value; };
    if ($('#pRek', el)) $('#pRek', el).onchange = e => { st.rekId = e.target.value; };
    $$('[data-inc]', el).forEach(c => c.onchange = () => { ov[c.dataset.inc].include = c.checked; rerender(); });
    $$('[data-amt]', el).forEach(i => i.addEventListener('change', () => { ov[i.dataset.amt].amount = parseRp(i.value); rerender(); }));
    $$('[data-met]', el).forEach(s2 => s2.onchange = () => { ov[s2.dataset.met].metode = s2.value; rerender(); });
    $$('[data-visit]', el).forEach(c => c.onchange = () => { const [mid, vid] = c.dataset.visit.split('|'); ov[mid].vsel[vid] = c.checked; delete ov[mid].amount; rerender(); });
    $$('[data-vplus]', el).forEach(b => b.onclick = async () => {
      if (b.disabled) return; b.disabled = true;
      const mid = b.dataset.vplus, vs = S.d.kedatangan_mitra.filter(v => v.mitra_id === mid && v.bulan === st.bulan);
      if (await run(async () => { await DB.insert('kedatangan_mitra', { id: uuid(), mitra_id: mid, bulan: st.bulan, ke: Math.max(0, ...vs.map(v => v.ke)) + 1, transaksi_id: null }); await reload('kedatangan_mitra'); })) { delete ov[mid].amount; rerender(); }
    });
    $$('[data-vminus]', el).forEach(b => b.onclick = async () => {
      if (b.disabled) return; b.disabled = true;
      const mid = b.dataset.vminus, last = S.d.kedatangan_mitra.filter(v => v.mitra_id === mid && v.bulan === st.bulan).sort((a, c) => c.ke - a.ke)[0];
      if (!last || last.transaksi_id) return;
      if (await run(async () => { await DB.remove('kedatangan_mitra', last.id); await reload('kedatangan_mitra'); })) { delete ov[mid].amount; rerender(); }
    });
    $('#doCair', el).onclick = async () => {
      if (!go.length) return;
      const tunaiId = st.tunaiId || (tunaiList[0] || {}).id;
      for (const r of go) {
        if (r.metode === 'tunai' && !tunaiId) return warn('Belum ada dompet tunai. Tambahkan di Master Data → Dompet.');
        if (r.metode === 'transfer' && !rek) return warn('Belum ada dompet rekening. Tambahkan di Master Data → Dompet.');
      }
      if (!await ask(`Cairkan gaji ${fmtBulan(st.bulan)} untuk ${go.length} mitra, total ${rp(sum(go, r => r.amount))}?`)) return;
      const txs = [], hut = [], vis = [];
      go.forEach(r => {
        const id = uuid(), pot = r.kedatangan || !tengah ? r.potong : 0;
        const ket = r.kedatangan ? `Gaji kedatangan ke-${r.chosen.map(v => v.ke).join(', ')} ${fmtBulan(st.bulan)} - ${r.m.nama}`
          : `${tengah ? 'Gaji tengah bulan' : 'Gaji'} ${fmtBulan(st.bulan)} - ${r.m.nama}`;
        txs.push({ id, tipe: 'pengeluaran', tanggal: st.tanggal, nilai: r.amount, dompet_id: r.metode === 'tunai' ? tunaiId : rek.id, dompet_tujuan_id: null,
          kategori_id: kat ? kat.id : null, rumah_id: null, mitra_id: r.m.id, komponen: !r.kedatangan && tengah ? 'gaji_tengah' : 'gaji', bulan: st.bulan,
          keterangan: ket + (pot ? ` (potong cicilan ${rp(pot)})` : '') });
        if (pot) r.cic.forEach(h => hut.push([h.id, id]));
        if (r.kedatangan) r.chosen.forEach(v => vis.push([v.id, id]));
      });
      const ok = await run(async () => {
        await DB.insert('transaksi', txs);
        for (const [hid, tid] of hut) await DB.update('hutang_mitra', hid, { lunas: true, transaksi_id: tid });
        for (const [vid, tid] of vis) await DB.update('kedatangan_mitra', vid, { transaksi_id: tid });
        await reload('transaksi', 'hutang_mitra', 'kedatangan_mitra');
      }, 'Gaji dicairkan');
      if (ok) { delete st.ov[key]; rerender(); }
    };
  }

  // ---------- Riwayat
  function pgRiwayat(el) {
    const f = S.fRiw || (S.fRiw = { dari: `${new Date().getFullYear()}-01-01`, sampai: '', tipe: '', dompet: '', kategori: '', q: '', n: 100 });
    const list = S.d.transaksi.filter(t => (!f.dari || t.tanggal >= f.dari) && (!f.sampai || t.tanggal <= f.sampai) && (!f.tipe || t.tipe === f.tipe)
      && (!f.dompet || t.dompet_id === f.dompet || t.dompet_tujuan_id === f.dompet) && (!f.kategori || t.kategori_id === f.kategori)
      && (!f.q || (t.keterangan + ' ' + rumahLabel(get('rumah', t.rumah_id)) + ' ' + ((get('mitra', t.mitra_id) || {}).nama || '')).toLowerCase().includes(f.q.toLowerCase())))
      .slice().reverse();
    const masuk = sum(list.filter(t => t.tipe === 'iuran' || t.tipe === 'pemasukan'), t => t.nilai);
    const keluar = sum(list.filter(t => t.tipe === 'pengeluaran'), t => t.nilai);
    el.innerHTML = `
      <div class="toolbar">
        <label>Dari<input type="date" id="fDari" value="${f.dari}"></label>
        <label>Sampai<input type="date" id="fSampai" value="${f.sampai}"></label>
        <label>Tipe<select id="fTipe">${opt('', 'Semua')}${Object.keys(TIPE_LABEL).map(t => opt(t, TIPE_LABEL[t], t === f.tipe)).join('')}</select></label>
        <label>Dompet<select id="fDompet">${opt('', 'Semua')}${S.d.dompet.map(w => opt(w.id, w.nama, w.id === f.dompet)).join('')}</select></label>
        <label>Kategori<select id="fKat">${opt('', 'Semua')}${S.d.kategori.map(k => opt(k.id, k.nama, k.id === f.kategori)).join('')}</select></label>
        <label>Cari<input id="fQ" value="${esc(f.q)}" placeholder="Keterangan / rumah / mitra"></label>
      </div>
      <div class="cards">
        <div class="card"><div class="label">Jumlah transaksi</div><div class="value">${list.length}</div></div>
        <div class="card"><div class="label">Total masuk</div><div class="value pos">${rp(masuk)}</div></div>
        <div class="card"><div class="label">Total keluar</div><div class="value neg">${rp(keluar)}</div></div>
      </div>
      <div class="table-wrap"><table class="stack">
        <thead><tr><th>Tanggal</th><th>Tipe</th><th>Uraian</th><th>Dompet</th><th class="num">Nilai</th><th></th></tr></thead>
        <tbody>${list.slice(0, f.n).map(t => `<tr><td>${fmtTgl(t.tanggal)}</td><td><span class="badge ${TIPE_BADGE[t.tipe]}">${TIPE_LABEL[t.tipe]}</span></td><td class="wrap">${trxDesc(t)}</td>
          <td class="meta">${esc((get('dompet', t.dompet_id) || {}).nama)}</td><td class="num">${rp(t.nilai)}</td>
          <td class="act"><div class="row-actions"><button class="btn small" data-edit="${t.id}">Edit</button><button class="btn small danger" data-del="${t.id}">Hapus</button></div></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Tidak ada transaksi</td></tr>'}</tbody>
      </table></div>
      ${list.length > f.n ? `<div class="form-actions" style="justify-content:center"><button class="btn" id="more">Tampilkan lebih banyak (${list.length - f.n} lagi)</button></div>` : ''}`;
    const bind = (id, k, num) => $(id, el).onchange = e => { f[k] = num ? +e.target.value : e.target.value; f.n = 100; rerender(); };
    bind('#fDari', 'dari'); bind('#fSampai', 'sampai'); bind('#fTipe', 'tipe'); bind('#fDompet', 'dompet'); bind('#fKat', 'kategori'); bind('#fQ', 'q');
    if ($('#more', el)) $('#more', el).onclick = () => { f.n += 200; rerender(); };
    $$('[data-edit]', el).forEach(b => b.onclick = () => {
      const t = get('transaksi', b.dataset.edit);
      openModal('Edit ' + TIPE_LABEL[t.tipe], '<div id="editBox"></div>', body => trxForm($('#editBox', body), t.tipe, t, rerender));
    });
    $$('[data-del]', el).forEach(b => b.onclick = async () => {
      const t = get('transaksi', b.dataset.del);
      if (!await ask(`Hapus transaksi ${TIPE_LABEL[t.tipe]} ${rp(t.nilai)} tanggal ${fmtTgl(t.tanggal)}?`)) return;
      if (await run(async () => {
        for (const h of S.d.hutang_mitra.filter(h => h.transaksi_id === t.id)) await DB.update('hutang_mitra', h.id, { lunas: false, transaksi_id: null });
        for (const v of S.d.kedatangan_mitra.filter(v => v.transaksi_id === t.id)) await DB.update('kedatangan_mitra', v.id, { transaksi_id: null });
        await DB.remove('transaksi', t.id); await reload('transaksi', 'iuran_bulan', 'hutang_mitra', 'kedatangan_mitra');
      }, 'Transaksi dihapus')) rerender();
    });
  }

  // ---------- Master data
  const MASTER = {
    rumah: {
      label: 'Rumah / Warga', table: 'rumah',
      cols: [['kode', 'Kode'], ['nama', 'Nama'], ['blok', 'Blok'], ['ipl', 'IPL', rp], ['aktif', 'Aktif', v => v ? 'Ya' : 'Tidak'], ['_bank', 'Rekening', (v, r) => { const x = get('rumah_rekening', r.id); return x ? esc([x.bank, x.nama_rekening].filter(Boolean).join(' · ')) : ''; }]],
      fields: [['kode', 'Kode rumah (mis. KB1/26)', 'text', true], ['nama', 'Nama penghuni'], ['blok', 'Blok (mis. KB1)'], ['ipl', 'IPL per bulan', 'money'], ['aktif', 'Aktif', 'bool'],
        ['bank', 'Bank pengirim', 'text', false, 'rek'], ['nama_rekening', 'Nama di rekening', 'text', false, 'rek'], ['no_hp', 'No. HP / WA', 'text', false, 'rek']],
    },
    kategori: { label: 'Kategori Pengeluaran', table: 'kategori', cols: [['nama', 'Nama'], ['urutan', 'Urutan']], fields: [['nama', 'Nama kategori', 'text', true], ['urutan', 'Urutan', 'number']] },
    dompet: {
      label: 'Dompet / Kas', table: 'dompet', cols: [['nama', 'Nama'], ['jenis', 'Jenis'], ['saldo_awal', 'Saldo awal', rp], ['aktif', 'Aktif', v => v ? 'Ya' : 'Tidak'], ['_s', 'Saldo saat ini', (v, r) => rp(saldo(r.id))]],
      fields: [['nama', 'Nama (mis. Tunai - Pak Andi)', 'text', true], ['jenis', 'Jenis', ['rekening', 'tunai']], ['saldo_awal', 'Saldo awal (sebelum transaksi pertama)', 'money'], ['aktif', 'Aktif', 'bool']],
    },
    mitra: {
      label: 'Mitra', table: 'mitra', cols: [['nama', 'Nama'], ['posisi', 'Posisi'], ['gaji_pokok', 'Gaji', (v, r) => gajiLabel(r)], ['aktif', 'Aktif', v => v ? 'Ya' : 'Resign'], ['tgl_resign', 'Tgl resign', fmtTgl]],
      fields: [['nama', 'Nama', 'text', true], ['posisi', 'Posisi (mis. Satpam)'], ['jenis_gaji', 'Jenis gaji', [['bulanan', 'Bulanan (tetap)'], ['kedatangan', 'Per kedatangan (dibayar sesuai jumlah datang)']]],
        ['gaji_pokok', 'Gaji per bulan / per kedatangan', 'money'], ['aktif', 'Aktif', 'bool'], ['tgl_resign', 'Tanggal resign', 'date']],
    },
  };

  function pgMaster(el) {
    const tab = S.masterTab || 'rumah';
    el.innerHTML = `<div class="tabs">${Object.keys(MASTER).map(k => `<button data-t="${k}" class="${k === tab ? 'active' : ''}">${MASTER[k].label}</button>`).join('')}<button data-t="pengaturan" class="${tab === 'pengaturan' ? 'active' : ''}">Pengaturan</button></div><div id="mBox"></div>`;
    $$('.tabs button', el).forEach(b => b.onclick = () => { S.masterTab = b.dataset.t; rerender(); });
    const box = $('#mBox', el);
    if (tab === 'pengaturan') {
      box.innerHTML = `<form class="panel" id="setForm"><div class="form-grid">
        <label>Nama aplikasi / RT<input name="nama_rt" value="${esc(setting('nama_rt') || '')}"></label>
        <label>Mulai penagihan IPL<input type="month" name="mulai_tagih" value="${esc(mulaiTagih())}"></label></div>
        <p class="hint">Bulan sebelum "mulai penagihan" tidak dihitung sebagai tunggakan.</p>
        <div class="form-actions"><button class="btn primary">Simpan</button></div></form>`;
      $('#setForm', box).onsubmit = async e => {
        e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target));
        if (await run(async () => { await DB.upsert('pengaturan', Object.keys(fd).map(k => ({ key: k, value: fd[k] }))); await reload('pengaturan'); }, 'Pengaturan disimpan')) { applyBrand(); rerender(); }
      };
      return;
    }
    const M = MASTER[tab];
    const rows = S.d[M.table];
    box.innerHTML = `<div class="toolbar"><span class="muted">${rows.length} data</span><span class="spacer"></span><button class="btn primary" id="addBtn">+ Tambah</button></div>
      <div class="table-wrap"><table><thead><tr>${M.cols.map(c => `<th>${c[1]}</th>`).join('')}<th></th></tr></thead>
      <tbody>${rows.map(r => `<tr>${M.cols.map(c => `<td>${c[2] ? c[2](r[c[0]], r) : esc(r[c[0]])}</td>`).join('')}
        <td><div class="row-actions"><button class="btn small" data-edit="${r.id}">Edit</button><button class="btn small danger" data-del="${r.id}">Hapus</button></div></td></tr>`).join('') || `<tr><td colspan="${M.cols.length + 1}" class="empty">Belum ada data</td></tr>`}</tbody></table></div>`;
    $('#addBtn', box).onclick = () => masterForm(M, null);
    $$('[data-edit]', box).forEach(b => b.onclick = () => masterForm(M, get(M.table, b.dataset.edit)));
    $$('[data-del]', box).forEach(b => b.onclick = async () => {
      if (!await ask('Hapus data ini? Jika sudah dipakai di transaksi, sebaiknya nonaktifkan saja.')) return;
      if (await run(async () => { await DB.remove(M.table, b.dataset.del); await reload(M.table, 'rumah_rekening'); }, 'Data dihapus')) rerender();
    });
  }

  function masterForm(M, r) {
    const rek = r ? (get('rumah_rekening', r.id) || {}) : {};
    const val = f => f[4] === 'rek' ? rek[f[0]] : (r ? r[f[0]] : (f[2] === 'bool' ? true : ''));
    const html = `<form id="mForm"><div class="form-grid">${M.fields.map(f => {
      const v = val(f), t = f[2] || 'text';
      if (Array.isArray(t)) return `<label>${f[1]}<select name="${f[0]}">${t.map(o => Array.isArray(o) ? opt(o[0], o[1], o[0] === v) : opt(o, o, o === v)).join('')}</select></label>`;
      if (t === 'bool') return `<label>${f[1]}<select name="${f[0]}">${opt('1', 'Ya', v !== false)}${opt('0', 'Tidak', v === false)}</select></label>`;
      if (t === 'money') return `<label>${f[1]}<input name="${f[0]}" data-money inputmode="decimal" value="${v === '' || v == null ? '' : v}"></label>`;
      return `<label>${f[1]}<input type="${t}" name="${f[0]}" ${f[3] ? 'required' : ''} value="${esc(v ?? '')}"></label>`;
    }).join('')}</div><div class="form-actions"><button type="button" class="btn" id="cancelBtn">Batal</button><button class="btn primary">Simpan</button></div></form>`;
    openModal((r ? 'Edit ' : 'Tambah ') + M.label, html, body => {
      moneyInputs(body);
      $('#cancelBtn', body).onclick = closeModal;
      $('#mForm', body).onsubmit = async e => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target));
        const row = {}, rekRow = {};
        M.fields.forEach(f => {
          let v = fd[f[0]]; const t = f[2] || 'text';
          if (t === 'money') v = parseRp(v); else if (t === 'number') v = v === '' ? 0 : +v; else if (t === 'bool') v = v === '1'; else if (t === 'date') v = v || null; else v = (v || '').trim();
          (f[4] === 'rek' ? rekRow : row)[f[0]] = v;
        });
        const ok = await run(async () => {
          let id = r && r.id;
          if (r) await DB.update(M.table, id, row); else { id = uuid(); await DB.insert(M.table, Object.assign({ id }, row)); }
          if (M.table === 'rumah') await DB.upsert('rumah_rekening', Object.assign({ rumah_id: id }, rekRow));
          await reload(M.table, 'rumah_rekening');
        }, 'Data disimpan');
        if (ok) { closeModal(); rerender(); }
      };
    });
  }

  // ---------- Hutang mitra
  function pgHutang(el) {
    const groups = {};
    S.d.hutang_mitra.slice().sort((a, b) => a.bulan.localeCompare(b.bulan) || (a.cicilan_ke || 0) - (b.cicilan_ke || 0))
      .forEach(h => { const k = (h.mitra_id || '-') + '|' + (h.keterangan || ''); (groups[k] = groups[k] || []).push(h); });
    el.innerHTML = `<p class="hint">Cicilan otomatis ditandai lunas saat gaji akhir bulan dicairkan lewat menu Pencairan Gaji, dan nominalnya dipotong dari gaji bulan itu.</p>
      <div class="toolbar"><span class="spacer"></span><button class="btn" id="addOne">+ Tambah cicilan</button><button class="btn primary" id="addPlan">+ Buat jadwal cicilan</button></div>
      ${Object.keys(groups).map(k => { const list = groups[k]; const m = get('mitra', list[0].mitra_id); let ak = 0;
        const total = sum(list, h => h.nominal), lunas = sum(list.filter(h => h.lunas), h => h.nominal);
        return `<div class="panel"><h3>${esc(m ? m.nama : 'Tanpa mitra')} — ${esc(list[0].keterangan || '')}</h3>
          <div class="cards"><div class="card"><div class="label">Total</div><div class="value">${rp(total)}</div></div><div class="card"><div class="label">Sudah lunas</div><div class="value pos">${rp(lunas)}</div></div><div class="card"><div class="label">Sisa</div><div class="value neg">${rp(total - lunas)}</div></div></div>
          <div class="table-wrap"><table><thead><tr><th>Bulan</th><th class="num">Cicilan ke</th><th class="num">Nominal</th><th class="num">Akumulasi</th><th>Lunas</th><th></th></tr></thead><tbody>
          ${list.map(h => { ak += Number(h.nominal); return `<tr><td>${fmtBulan(h.bulan)}</td><td class="num">${h.cicilan_ke ?? ''}</td><td class="num">${rp(h.nominal)}</td><td class="num">${rp(ak)}</td>
            <td><input type="checkbox" data-lunas="${h.id}" ${h.lunas ? 'checked' : ''} style="width:auto"> ${h.transaksi_id ? '<span class="badge ok">potong gaji</span>' : ''}</td><td><button class="btn small danger" data-del="${h.id}">Hapus</button></td></tr>`; }).join('')}
          </tbody></table></div></div>`; }).join('') || '<div class="empty panel">Belum ada data hutang mitra</div>'}`;
    const mitraOpts = S.d.mitra.map(m => opt(m.id, m.nama)).join('');
    $('#addOne', el).onclick = () => openModal('Tambah cicilan', `<form id="hf"><div class="form-grid">
        <label>Mitra<select name="mitra_id">${mitraOpts}</select></label><label>Keterangan<input name="keterangan" value="Cicilan pinjaman"></label>
        <label>Bulan<input type="month" name="bulan" required value="${curYM()}"></label><label>Cicilan ke<input type="number" name="cicilan_ke" value="1"></label>
        <label>Nominal<input name="nominal" data-money inputmode="decimal" required></label></div><div class="form-actions"><button class="btn primary">Simpan</button></div></form>`, body => {
      moneyInputs(body);
      $('#hf', body).onsubmit = async e => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target));
        if (await run(async () => { await DB.insert('hutang_mitra', { id: uuid(), mitra_id: fd.mitra_id || null, keterangan: fd.keterangan, bulan: fd.bulan, cicilan_ke: +fd.cicilan_ke || null, nominal: parseRp(fd.nominal), lunas: false }); await reload('hutang_mitra'); }, 'Disimpan')) { closeModal(); rerender(); } };
    });
    $('#addPlan', el).onclick = () => openModal('Buat jadwal cicilan', `<form id="hp"><div class="form-grid">
        <label>Mitra<select name="mitra_id">${mitraOpts}</select></label><label>Keterangan<input name="keterangan" value="Cicilan pinjaman"></label>
        <label>Nominal per cicilan<input name="nominal" data-money inputmode="decimal" required></label><label>Jumlah cicilan<input type="number" name="n" min="1" max="60" value="6"></label>
        <label>Mulai bulan<input type="month" name="mulai" required value="${curYM()}"></label></div><div class="form-actions"><button class="btn primary">Buat</button></div></form>`, body => {
      moneyInputs(body);
      $('#hp', body).onsubmit = async e => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target));
        const rows = Array.from({ length: +fd.n }, (_, i) => ({ id: uuid(), mitra_id: fd.mitra_id || null, keterangan: fd.keterangan, bulan: ymAdd(fd.mulai, i), cicilan_ke: i + 1, nominal: parseRp(fd.nominal), lunas: false }));
        if (await run(async () => { await DB.insert('hutang_mitra', rows); await reload('hutang_mitra'); }, 'Jadwal dibuat')) { closeModal(); rerender(); } };
    });
    $$('[data-lunas]', el).forEach(c => c.onchange = async () => { if (await run(async () => { await DB.update('hutang_mitra', c.dataset.lunas, c.checked ? { lunas: true } : { lunas: false, transaksi_id: null }); await reload('hutang_mitra'); })) rerender(); });
    $$('[data-del]', el).forEach(b => b.onclick = async () => { if (await ask('Hapus cicilan ini?') && await run(async () => { await DB.remove('hutang_mitra', b.dataset.del); await reload('hutang_mitra'); })) rerender(); });
  }

  // ---------- Catatan
  function pgCatatan(el) {
    const f = S.fCat || (S.fCat = 'Open');
    const list = S.d.catatan.filter(c => !f || c.status === f).sort((a, b) => b.tanggal.localeCompare(a.tanggal));
    el.innerHTML = `<form class="panel rw" id="cf"><div class="form-grid"><label>Tanggal<input type="date" name="tanggal" value="${todayISO()}" required></label>
        <label style="grid-column:span 3">Catatan<input name="isi" required placeholder="Mis. ada transfer tanpa konfirmasi"></label></div>
        <div class="form-actions"><button class="btn primary">Tambah catatan</button></div></form>
      <div class="tabs">${[['Open', 'Open'], ['Clear', 'Clear'], ['', 'Semua']].map(([v, l]) => `<button data-f="${v}" class="${v === f ? 'active' : ''}">${l}</button>`).join('')}</div>
      <div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Catatan</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(c => `<tr><td>${fmtTgl(c.tanggal)}</td><td class="wrap">${esc(c.isi)}</td><td><span class="badge ${c.status === 'Open' ? 'warn' : 'ok'}">${c.status}</span></td>
        <td><div class="row-actions"><button class="btn small" data-tog="${c.id}">${c.status === 'Open' ? 'Tandai Clear' : 'Buka lagi'}</button><button class="btn small danger" data-del="${c.id}">Hapus</button></div></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Tidak ada catatan</td></tr>'}
      </tbody></table></div>`;
    $('#cf', el).onsubmit = async e => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target));
      if (await run(async () => { await DB.insert('catatan', { id: uuid(), tanggal: fd.tanggal, isi: fd.isi.trim(), status: 'Open' }); await reload('catatan'); }, 'Catatan ditambahkan')) rerender(); };
    $$('[data-f]', el).forEach(b => b.onclick = () => { S.fCat = b.dataset.f; rerender(); });
    $$('[data-tog]', el).forEach(b => b.onclick = async () => { const c = get('catatan', b.dataset.tog);
      if (await run(async () => { await DB.update('catatan', c.id, { status: c.status === 'Open' ? 'Clear' : 'Open' }); await reload('catatan'); })) rerender(); });
    $$('[data-del]', el).forEach(b => b.onclick = async () => { if (await ask('Hapus catatan?') && await run(async () => { await DB.remove('catatan', b.dataset.del); await reload('catatan'); })) rerender(); });
  }

  // ---------- Akun
  async function pgAkun(el) {
    el.innerHTML = '<div class="empty">Memuat...</div>';
    let list;
    try { list = await DB.list('profiles'); } catch (e) { el.innerHTML = `<div class="panel error">${esc(e.message)}</div>`; return; }
    el.innerHTML = `<div class="panel"><h3>Cara menambah akun warga</h3>
        <ol class="small" style="margin:0;padding-left:18px;line-height:1.7">
          <li>Buka Supabase Dashboard → <b>Authentication → Users → Add user → Create new user</b>.</li>
          <li>Isi email & password warga, centang <b>Auto Confirm User</b>, lalu simpan.</li>
          <li>Akun otomatis muncul di bawah sebagai <b>warga</b> (hanya bisa melihat laporan).</li>
          <li>Bisa juga memakai satu akun bersama untuk semua warga, mis. <i>warga@namart.id</i>.</li>
        </ol></div>
      <div class="table-wrap"><table><thead><tr><th>Email</th><th>Nama</th><th>Peran</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(p => `<tr><td>${esc(p.email)}</td><td>${esc(p.nama || '')}</td><td><span class="badge ${p.role === 'admin' ? 'info' : ''}">${p.role}</span></td>
        <td><span class="badge ${p.aktif ? 'ok' : 'bad'}">${p.aktif ? 'Aktif' : 'Nonaktif'}</span></td>
        <td>${p.id === S.me.id ? '<span class="muted small">Anda</span>' : `<div class="row-actions"><button class="btn small" data-nama="${p.id}">Ubah nama</button><button class="btn small ${p.aktif ? 'danger' : ''}" data-akt="${p.id}">${p.aktif ? 'Nonaktifkan' : 'Aktifkan'}</button></div>`}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="hint" style="margin-top:10px">Hanya ada satu admin (Anda). Peran admin diatur lewat SQL di Supabase, tidak dari aplikasi.</p>`;
    $$('[data-akt]', el).forEach(b => b.onclick = async () => { const p = list.find(x => x.id === b.dataset.akt);
      if (await run(() => DB.update('profiles', p.id, { aktif: !p.aktif }), 'Status akun diubah')) pgAkun(el); });
    $$('[data-nama]', el).forEach(b => b.onclick = () => { const p = list.find(x => x.id === b.dataset.nama);
      openModal('Ubah nama', `<form id="nf"><label>Nama<input name="nama" id="namaInput" value="${esc(p.nama || '')}"></label><div class="form-actions"><button class="btn primary">Simpan</button></div></form>`, body => {
        $('#nf', body).onsubmit = async e => { e.preventDefault(); const n = $('#namaInput', body).value.trim();
          if (await run(() => DB.update('profiles', p.id, { nama: n }), 'Nama diubah')) { closeModal(); pgAkun(el); } };
      }); });
  }

  // ---------- Audit
  async function pgAudit(el) {
    el.innerHTML = '<div class="empty">Memuat...</div>';
    let list;
    try { list = await DB.list('audit_log', { order: 'waktu', desc: true, limit: 300 }); } catch (e) { el.innerHTML = `<div class="panel error">${esc(e.message)}</div>`; return; }
    const ringkas = d => d ? `${TIPE_LABEL[d.tipe] || d.tipe} · ${fmtTgl(d.tanggal)} · ${rp(d.nilai)} · ${esc(d.keterangan || '')}` : '';
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Waktu</th><th>Aksi</th><th>Sebelum</th><th>Sesudah</th></tr></thead><tbody>
      ${list.map(a => `<tr><td>${new Date(a.waktu).toLocaleString('id-ID')}</td><td><span class="badge ${a.aksi === 'DELETE' ? 'bad' : a.aksi === 'INSERT' ? 'ok' : 'warn'}">${a.aksi}</span></td>
        <td class="wrap small">${ringkas(a.data_lama)}</td><td class="wrap small">${ringkas(a.data_baru)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Belum ada log</td></tr>'}
      </tbody></table></div>`;
  }

  // ---------- Impor / ekspor
  function parseCSV(text) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim()));
  }
  const BULAN_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  function parseBulanText(s) {
    return String(s || '').split(/[,;]/).map(x => x.trim().toLowerCase()).filter(Boolean).map(x => {
      const m = x.match(/([a-z]+)\s+(\d{4})/); if (!m) return null;
      let i = BULAN.findIndex(b => b.toLowerCase().startsWith(m[1].slice(0, 3))); if (i < 0) i = BULAN_EN.findIndex(b => b.startsWith(m[1].slice(0, 3)));
      return i < 0 ? null : ymOf(+m[2], i + 1);
    }).filter(Boolean);
  }
  function parseTglText(s) {
    const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    const m2 = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/); return m2 ? m2[0] : null;
  }
  function parseNumText(s) {
    let x = String(s || '').replace(/rp|\s/gi, '');
    if (/^\d+(\.\d+)?$/.test(x)) return Math.round(parseFloat(x));
    x = x.replace(/\./g, '').replace(',', '.'); const n = parseFloat(x); return isNaN(n) ? 0 : Math.round(n);
  }
  const normKat = s => String(s || '').toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

  function planImport(rows) {
    const head = rows[0].map(h => h.trim().toLowerCase());
    if (!head[0].includes('timestamp') || !head[1].includes('tipe')) throw new Error('Format kolom tidak dikenali. Kolom pertama harus "Timestamp", kedua "Tipe Transaksi" (format Google Form lama).');
    const plan = { dompet: [], kategori: [], rumah: [], transaksi: [], iuran_bulan: [], skip: [] };
    const rek = S.d.dompet.find(w => w.jenis === 'rekening');
    const dompetMap = new Map(S.d.dompet.map(w => [w.nama.toLowerCase().replace(/^tunai\s*-?\s*/, 'tunai ').replace(/\s+/g, ' '), w.id]));
    const katMap = new Map(S.d.kategori.map(k => [normKat(k.nama), k.id]));
    const rumahMap = new Map(S.d.rumah.map(r => [r.kode.toLowerCase(), r]));
    const dompetOf = txt => {
      const t = String(txt || '').trim();
      if (!t || /^transfer/i.test(t)) { if (!rek) throw new Error('Buat dompet jenis "rekening" dulu di Master Data.'); return rek.id; }
      const key = t.toLowerCase().replace(/^tunai\s*-?\s*/, 'tunai ').replace(/\s+/g, ' ');
      if (!dompetMap.has(key)) { const nama = 'Tunai - ' + t.replace(/^tunai\s*-?\s*/i, '').replace(/\b\w/g, c => c.toUpperCase()); const w = { id: uuid(), nama, jenis: 'tunai', saldo_awal: 0, aktif: true }; plan.dompet.push(w); dompetMap.set(key, w.id); }
      return dompetMap.get(key);
    };
    const katOf = txt => {
      const k = normKat(txt || 'Lainnya');
      if (!katMap.has(k)) { const row = { id: uuid(), nama: String(txt || 'Lainnya').replace(/[–—]/g, '-').trim(), urutan: 50 }; plan.kategori.push(row); katMap.set(k, row.id); }
      return katMap.get(k);
    };
    rows.slice(1).forEach((r, i) => {
      const line = i + 2, tipe = (r[1] || '').trim().toLowerCase();
      try {
        if (tipe.startsWith('pemasukan')) {
          const tanggal = parseTglText(r[2]) || parseTglText(r[0]); const nilai = parseNumText(r[5]);
          if (!tanggal || !nilai) throw new Error('tanggal/jumlah kosong');
          const rumahTxt = (r[4] || '').trim(); const months = parseBulanText(r[6]);
          const dompet_id = dompetOf(r[3]);
          if (!rumahTxt) { plan.transaksi.push({ id: uuid(), tipe: 'pemasukan', tanggal, nilai, dompet_id, bulan: months[0] || tanggal.slice(0, 7), keterangan: 'Impor: pemasukan lain' }); return; }
          const [kodeRaw, ...rest] = rumahTxt.split(' - '); const kode = kodeRaw.trim().toUpperCase();
          let rm = rumahMap.get(kode.toLowerCase());
          if (!rm) { rm = { id: uuid(), kode, nama: rest.join(' - ').trim(), grup: '', blok: kode.split('/')[0], ipl: months.length ? Math.round(nilai / months.length) : nilai, aktif: true }; plan.rumah.push(rm); rumahMap.set(kode.toLowerCase(), rm); }
          const ms = months.length ? months : [tanggal.slice(0, 7)];
          const id = uuid(), per = Math.floor(nilai / ms.length);
          plan.transaksi.push({ id, tipe: 'iuran', tanggal, nilai, dompet_id, rumah_id: rm.id, bulan: ms[0], keterangan: '' });
          ms.forEach((m, j) => plan.iuran_bulan.push({ id: uuid(), transaksi_id: id, rumah_id: rm.id, bulan: m, nominal: j === ms.length - 1 ? nilai - per * (ms.length - 1) : per }));
        } else if (tipe.startsWith('pengeluaran')) {
          const tanggal = parseTglText(r[8]) || parseTglText(r[0]); const nilai = parseNumText(r[10]);
          if (!tanggal || !nilai) throw new Error('tanggal/nilai kosong');
          plan.transaksi.push({ id: uuid(), tipe: 'pengeluaran', tanggal, nilai, dompet_id: dompetOf(r[14]), kategori_id: katOf(r[11]), bulan: parseBulanText(r[13])[0] || tanggal.slice(0, 7), keterangan: (r[9] || '').trim() });
        } else throw new Error('tipe tidak dikenali');
      } catch (e) { plan.skip.push(`Baris ${line}: ${e.message}`); }
    });
    return plan;
  }

  // ---------- Migrasi langsung dari Google Sheet lama (sekali jalan)
  // Ambil tab sheet sebagai CSV (tanpa konversi tipe). Jika gagal, pakai JSONP gviz.
  async function gviz(sheetId, sheet, headers) {
    try {
      const r = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}`, { credentials: 'omit' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const t = await r.text();
      if (/^\s*</.test(t)) throw new Error('bukan CSV');
      const rows = parseCSV(t);
      return headers ? { cols: rows[0] || [], rows: rows.slice(1) } : { cols: [], rows };
    } catch (e) { return gvizJsonp(sheetId, sheet, headers); }
  }
  function gvizJsonp(sheetId, sheet, headers) {
    return new Promise((resolve, reject) => {
      const cb = '__gv' + Math.random().toString(36).slice(2);
      const s = document.createElement('script');
      const done = () => { delete window[cb]; s.remove(); };
      window[cb] = d => {
        done();
        if (!d || d.status !== 'ok') return reject(new Error(`Tab "${sheet}" tidak bisa dibaca`));
        const cell = c => c == null ? '' : (typeof c.v === 'number' || typeof c.v === 'boolean' ? c.v : (c.f != null ? c.f : (c.v == null ? '' : String(c.v))));
        resolve({ cols: d.table.cols.map(c => c.label || ''), rows: d.table.rows.map(r => (r.c || []).map(cell)) });
      };
      s.onerror = () => { done(); reject(new Error('Sheet tidak bisa diakses. Pastikan Anda login Google di browser ini dan punya akses ke sheet.')); };
      s.src = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json;responseHandler:${cb}&headers=${headers}&sheet=${encodeURIComponent(sheet)}`;
      document.head.appendChild(s);
      setTimeout(() => { if (window[cb]) { done(); reject(new Error(`Waktu habis saat membaca tab "${sheet}"`)); } }, 30000);
    });
  }
  const numSheet = v => typeof v === 'number' ? v : (parseFloat(String(v || '').replace(/rp|\s|,/gi, '')) || 0);
  function ymSheet(v) {
    const s = String(v || '').trim();
    const b = parseBulanText(s); if (b.length) return b[0];
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${pad(m[2])}`;
    m = s.match(/^(\d{1,2})-(\d{4})$/); if (m) return `${m[2]}-${pad(m[1])}`;
    return null;
  }
  function tglSheet(v) {
    const s = String(v || '').trim();
    const t = parseTglText(s); if (t) return t;
    const m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    if (m) { let i = BULAN.findIndex(b => b.toLowerCase().startsWith(m[2].slice(0, 3).toLowerCase())); if (i < 0) i = BULAN_EN.findIndex(b => b.startsWith(m[2].slice(0, 3).toLowerCase())); if (i >= 0) return `${m[3]}-${pad(i + 1)}-${pad(m[1])}`; }
    return null;
  }
  const holderKey = s => String(s || '').toLowerCase().replace(/^tunai\s*-?\s*/, '').replace(/^(pak|bu|ibu)\s+/, '').replace(/\s+saat ini$/, '').trim();
  const titleCase = s => s.replace(/\b\w/g, c => c.toUpperCase());

  async function planMigrasi(sheetId, log) {
    log('Membaca tab Data...');
    const data = await gviz(sheetId, 'Data', 1);
    log('Membaca Besaran IPL, Rekap Bayar Warga, Gaji Mitra, Hutang Mitra, Note, Ringkasan, Rekap Tunai...');
    const [ipl, bayar, gaji, hutang, note, ring, tunai] = await Promise.all([
      gviz(sheetId, 'Besaran IPL', 0), gviz(sheetId, 'Rekap Bayar Warga', 1), gviz(sheetId, 'Gaji Mitra', 1),
      gviz(sheetId, 'Hutang Mitra', 0).catch(() => ({ cols: [], rows: [] })), gviz(sheetId, 'Note', 0).catch(() => ({ cols: [], rows: [] })),
      gviz(sheetId, 'Ringkasan', 1), gviz(sheetId, 'Rekap Tunai', 1)]);
    const P = { kategori: [], dompet: [], dompetUpd: [], rumah: [], rumah_rekening: [], mitra: [], transaksi: [], iuran_bulan: [], hutang_mitra: [], catatan: [], pengaturan: [], info: {}, skip: [] };

    // Rumah: Besaran IPL + grup & rekening dari Rekap Bayar Warga
    const rumahMap = new Map(S.d.rumah.map(r => [r.kode.toUpperCase(), r]));
    const addRumah = (txt, iplVal) => {
      const [k, ...rest] = String(txt).split(' - '); const kode = k.trim().toUpperCase();
      if (!/^KB/.test(kode)) return null;
      let r = rumahMap.get(kode);
      if (!r) { r = { id: uuid(), kode, nama: rest.join(' - ').trim(), grup: '', blok: kode.split('/')[0], ipl: iplVal || 0, aktif: true }; P.rumah.push(r); rumahMap.set(kode, r); }
      return r;
    };
    ipl.rows.forEach(r => { if (/^KB/i.test(String(r[0]))) addRumah(r[0], numSheet(r[1])); });
    const bankCol = bayar.cols.findIndex(c => /rekening/i.test(c));
    const monthCols = bayar.cols.map((c, i) => [i, parseBulanText(c)[0]]).filter(x => x[1]);
    bayar.rows.forEach(r => {
      const rm = addRumah(r[1], 0); if (!rm) return;
      if (!rm.grup && r[0]) rm.grup = String(r[0]);
      if (bankCol >= 0 && (r[bankCol] || r[bankCol + 1])) P.rumah_rekening.push({ rumah_id: rm.id, bank: String(r[bankCol] || ''), nama_rekening: String(r[bankCol + 1] || ''), no_hp: '' });
    });
    P.rumah.forEach(r => { if (r.grup) return; const row = bayar.rows.find(x => String(x[1]).toUpperCase().startsWith(r.kode + ' ')); if (row) r.grup = String(row[0] || ''); });

    // Kategori & dompet
    const katMap = new Map(S.d.kategori.map(k => [normKat(k.nama), k.id]));
    const katOf = txt => { const n = String(txt || 'Lainnya').replace(/[–—]/g, '-').trim(); const k = normKat(n);
      if (!katMap.has(k)) { const row = { id: uuid(), nama: n, urutan: 20 + P.kategori.length }; P.kategori.push(row); katMap.set(k, row.id); } return katMap.get(k); };
    // Semua transaksi "Transfer" di sheet masuk ke rekening Mandiri; rekening Krom dibuat jika belum ada
    let rek = S.d.dompet.find(w => w.jenis === 'rekening' && /mandiri/i.test(w.nama)) || S.d.dompet.find(w => w.jenis === 'rekening');
    if (!rek) { rek = { id: uuid(), nama: 'Kas Mandiri Sherwood', jenis: 'rekening', saldo_awal: 0, aktif: true }; P.dompet.push(rek); }
    else if (!/mandiri/i.test(rek.nama)) P.dompetUpd.push([rek.id, { nama: 'Kas Mandiri Sherwood' }]);
    if (!S.d.dompet.some(w => w.jenis === 'rekening' && /krom/i.test(w.nama))) P.dompet.push({ id: uuid(), nama: 'Kas Krom Sherwood', jenis: 'rekening', saldo_awal: 0, aktif: true });
    const dompetMap = new Map(S.d.dompet.filter(w => w.jenis === 'tunai').map(w => [holderKey(w.nama), w]));
    const dompetOf = txt => {
      const t = String(txt || '').trim();
      if (!t || /^transfer/i.test(t)) return rek.id;
      const k = holderKey(t);
      if (!dompetMap.has(k)) { const w = { id: uuid(), nama: 'Tunai - Pak ' + titleCase(k), jenis: 'tunai', saldo_awal: 0, aktif: true }; P.dompet.push(w); dompetMap.set(k, w); }
      return dompetMap.get(k).id;
    };

    // Mitra dari judul kolom Gaji Mitra
    const mitraList = [];
    gaji.cols.forEach(c => {
      const m = String(c).match(/Mitra\s+(.+?)\s+-\s+(.+?)\s*\(([^)]*)\)/i); if (!m) return;
      const nama = m[2].trim(); if (mitraList.some(x => x.nama === nama)) return;
      const resign = /resign/i.test(m[3]);
      const row = { id: uuid(), nama, posisi: m[1].trim(), jenis_gaji: 'bulanan', gaji_pokok: resign ? 0 : numSheet(m[3]), aktif: !resign, tgl_resign: null };
      mitraList.push(row);
    });
    const exMitra = S.d.mitra.slice();
    mitraList.forEach(m => { if (!exMitra.some(x => x.nama.toLowerCase() === m.nama.toLowerCase())) P.mitra.push(m); });
    const allMitra = exMitra.concat(P.mitra).map(m => ({ m, re: new RegExp('\\b' + m.nama.replace(/^(pak|bu|ibu)\s+/i, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i') }));

    // Transaksi dari tab Data
    let gajiTanpaMitra = 0;
    data.rows.forEach((r, i) => {
      const line = i + 2, tipe = String(r[1] || '').toLowerCase();
      try {
        if (tipe.startsWith('pemasukan')) {
          const tanggal = tglSheet(r[2]) || tglSheet(r[0]); const nilai = numSheet(r[5]);
          if (!tanggal || !nilai) throw new Error('tanggal/jumlah kosong');
          const dompet_id = dompetOf(r[3]); const txt = String(r[4] || '').trim(); const bulan = ymSheet(r[6]) || tanggal.slice(0, 7);
          const rm = /^KB\d/i.test(txt) ? addRumah(txt, nilai) : null;
          if (!rm) { P.transaksi.push({ id: uuid(), tipe: 'pemasukan', tanggal, nilai, dompet_id, bulan, keterangan: txt || 'Pemasukan lain' }); return; }
          const id = uuid();
          P.transaksi.push({ id, tipe: 'iuran', tanggal, nilai, dompet_id, rumah_id: rm.id, bulan, keterangan: '' });
          P.iuran_bulan.push({ id: uuid(), transaksi_id: id, rumah_id: rm.id, bulan, nominal: nilai });
        } else if (tipe.startsWith('pengeluaran')) {
          const tanggal = tglSheet(r[8]) || tglSheet(r[0]); const nilai = numSheet(r[10]);
          if (!tanggal || !nilai) throw new Error('tanggal/nilai kosong');
          const ket = String(r[9] || '').trim(), katTxt = String(r[11] || 'Lainnya');
          const row = { id: uuid(), tipe: 'pengeluaran', tanggal, nilai, dompet_id: dompetOf(r[14]), kategori_id: katOf(katTxt), bulan: ymSheet(r[13]) || tanggal.slice(0, 7), keterangan: ket };
          if (/gaji|lembur/i.test(katTxt)) {
            const hit = allMitra.find(x => x.re.test(ket));
            if (hit) { row.mitra_id = hit.m.id; row.komponen = /lembur/i.test(katTxt) ? 'lembur' : /kasbon/i.test(ket) ? 'kasbon' : /thr/i.test(ket) ? 'thr' : 'gaji'; }
            else gajiTanpaMitra++;
          }
          P.transaksi.push(row);
        } else if (r.some(x => x !== '')) throw new Error('tipe tidak dikenali');
      } catch (e) { P.skip.push(`Baris ${line}: ${e.message}`); }
    });

    // Status bayar historis dari Rekap Bayar Warga (tanpa uang masuk)
    const paidImported = new Set(P.iuran_bulan.map(b => b.rumah_id + '|' + b.bulan).concat(S.d.iuran_bulan.map(b => b.rumah_id + '|' + b.bulan)));
    const firstTx = P.transaksi.map(t => t.tanggal).sort()[0] || todayISO();
    const histDate = (() => { const d = new Date(firstTx + 'T00:00:00'); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();
    let histCount = 0;
    bayar.rows.forEach(r => {
      const rm = rumahMap.get(String(r[1]).split(' - ')[0].trim().toUpperCase()); if (!rm) return;
      const months = monthCols.filter(([ci, ym]) => ym <= curYM() && numSheet(r[ci]) === 1 && !paidImported.has(rm.id + '|' + ym)).map(x => x[1]);
      if (!months.length) return;
      const id = uuid();
      P.transaksi.push({ id, tipe: 'iuran', tanggal: histDate, nilai: 0, dompet_id: rek.id, rumah_id: rm.id, bulan: months[0], keterangan: 'Migrasi: status lunas dari Rekap Bayar Warga (tanpa uang masuk)' });
      months.forEach(ym => P.iuran_bulan.push({ id: uuid(), transaksi_id: id, rumah_id: rm.id, bulan: ym, nominal: rm.ipl || 0 }));
      histCount += months.length;
    });

    // Hutang mitra & catatan
    hutang.rows.forEach(r => { const bulan = ymSheet(r[1]); const nominal = numSheet(r[0]); if (!bulan || !nominal) return;
      P.hutang_mitra.push({ id: uuid(), mitra_id: null, keterangan: 'Migrasi dari sheet Hutang Mitra', bulan, cicilan_ke: numSheet(r[2]) || null, nominal, lunas: r[4] === true || String(r[4]).toUpperCase() === 'TRUE', transaksi_id: null }); });
    note.rows.forEach(r => { const tanggal = tglSheet(r[0]); const isi = String(r[1] || '').trim(); if (!tanggal || !isi) return;
      P.catatan.push({ id: uuid(), tanggal, isi, status: /clear/i.test(String(r[2])) ? 'Clear' : 'Open' }); });

    // Saldo awal agar saldo sekarang sama dengan sheet
    const targets = new Map();
    const ri = ring.cols.findIndex(c => /kas rekening/i.test(c));
    targets.set(rek.id, ri >= 0 && ring.rows[0] ? numSheet(ring.rows[0][ri]) : null);
    tunai.rows.forEach(r => { const m = String(r[0] || '').match(/uang di (.+?) saat ini/i); if (m) { const w = dompetOf('Tunai ' + m[1]); targets.set(w, numSheet(r[1])); } });
    const allDompet = S.d.dompet.concat(P.dompet);
    const allTx = S.d.transaksi.concat(P.transaksi);
    allDompet.forEach(w => {
      const tgt = targets.get(w.id); if (tgt == null) return;
      let net = 0;
      allTx.forEach(t => {
        if ((t.tipe === 'iuran' || t.tipe === 'pemasukan') && t.dompet_id === w.id) net += t.nilai;
        else if (t.tipe === 'pengeluaran' && t.dompet_id === w.id) net -= t.nilai;
        else if (t.tipe === 'mutasi') { if (t.dompet_id === w.id) net -= t.nilai; if (t.dompet_tujuan_id === w.id) net += t.nilai; }
      });
      const saldo_awal = Math.round((tgt - net) * 100) / 100;
      if (P.dompet.includes(w)) w.saldo_awal = saldo_awal; else P.dompetUpd.push([w.id, { saldo_awal }]);
      P.info['Saldo ' + w.nama] = tgt;
    });

    P.pengaturan = [{ key: 'mulai_tagih', value: monthCols.length ? monthCols[0][1] : mulaiTagih() }];
    if (!setting('nama_rt') || /^Rekap Keuangan RT/.test(setting('nama_rt'))) P.pengaturan.push({ key: 'nama_rt', value: 'Keuangan KB Sherwood' });
    Object.assign(P.info, { histCount, gajiTanpaMitra });
    return P;
  }

  async function runMigrasi(P, log) {
    const fill = x => Object.assign({ dompet_tujuan_id: null, kategori_id: null, rumah_id: null, mitra_id: null, komponen: null }, x);
    if (P.kategori.length) { log('Kategori...'); await DB.insert('kategori', P.kategori); }
    if (P.dompet.length) { log('Dompet...'); await DB.insert('dompet', P.dompet); }
    for (const [id, patch] of P.dompetUpd) await DB.update('dompet', id, patch);
    if (P.rumah.length) { log(`Rumah (${P.rumah.length})...`); await DB.insert('rumah', P.rumah); }
    if (P.rumah_rekening.length) await DB.upsert('rumah_rekening', P.rumah_rekening);
    if (P.mitra.length) { log('Mitra...'); await DB.insert('mitra', P.mitra); }
    log(`Transaksi (${P.transaksi.length})... ini bisa makan waktu sebentar`);
    await DB.insert('transaksi', P.transaksi.map(fill));
    log(`Rincian bulan iuran (${P.iuran_bulan.length})...`);
    await DB.insert('iuran_bulan', P.iuran_bulan);
    if (P.hutang_mitra.length) await DB.insert('hutang_mitra', P.hutang_mitra);
    if (P.catatan.length) await DB.insert('catatan', P.catatan);
    await DB.upsert('pengaturan', P.pengaturan);
    log('Memuat ulang data...');
    await loadAll();
  }

  function pgImpor(el) {
    el.innerHTML = `
      <div class="panel"><h3>Ekspor laporan</h3><p class="hint">Excel berisi transaksi, ringkasan bulanan, rekap bayar warga, dan rekap pengeluaran. PDF berisi laporan siap cetak: ringkasan, rekap pengeluaran per bulan, gaji mitra, dan rekap bayar warga.</p>
        <div class="toolbar">${yearSelect()}<button class="btn primary" id="expBtn">Unduh Excel</button><button class="btn primary" id="pdfBtn">Unduh PDF</button></div>${framed ? '<p class="hint">Unduhan file tidak bisa berjalan di halaman preview ini. Akan berfungsi setelah aplikasi dipasang di GitHub Pages.</p>' : ''}</div>
      <div class="panel rw"><h3>Migrasi dari Google Sheet lama</h3>
        <p class="hint">Mengambil langsung dari Google Sheet (tab Data, Besaran IPL, Rekap Bayar Warga, Gaji Mitra, Hutang Mitra, Note, Ringkasan, Rekap Tunai). Browser ini harus login ke akun Google yang punya akses ke sheet. Jalankan sekali saja.</p>
        <div class="toolbar"><label style="flex:1;min-width:240px">Link Google Sheet<input id="migUrl" placeholder="https://docs.google.com/spreadsheets/d/..."></label><button class="btn primary" id="migCek">Periksa data</button></div>
        <div id="migBox"></div></div>
      <div class="panel rw"><h3>Impor data lama (CSV dari Google Sheet)</h3>
        <p class="hint">Di Google Sheets buka tab "Data" → File → Download → CSV. Format kolom mengikuti Google Form lama (Timestamp, Tipe Transaksi, Tanggal Bayar, Jenis Bayar, Nama & Nomer Rumah, Jumlah Transfer, Bulan Bayar, …). Rumah, kategori, dan dompet tunai yang belum ada akan dibuat otomatis. Impor cukup sekali agar data tidak dobel.</p>
        <input type="file" id="csvFile" accept=".csv,text/csv"><div id="impPrev" style="margin-top:12px"></div></div>
      ${DB.demo ? '<div class="panel"><h3>Mode demo</h3><p class="hint">Kembalikan data contoh ke kondisi awal.</p><button class="btn danger" id="resetDemo">Reset data demo</button></div>' : ''}`;
    bindYear(el, rerender);
    $('#expBtn', el).onclick = exportExcel;
    $('#pdfBtn', el).onclick = exportPdf;
    if ($('#resetDemo', el)) $('#resetDemo', el).onclick = async () => { if (await ask('Reset semua data demo?')) { DB.resetDemo(); await loadAll(); toast('Data demo direset'); rerender(); } };
    $('#migCek', el).onclick = async () => {
      const box = $('#migBox', el), m = $('#migUrl', el).value.match(/\/d\/([\w-]{20,})/);
      if (!m) return warn('Tempel link Google Sheet yang valid.');
      const log = t => { box.innerHTML = `<p class="hint">${esc(t)}</p>`; };
      let P;
      try { P = await planMigrasi(m[1], log); } catch (err) { console.error(err); box.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
      const n = t => P.transaksi.filter(x => x.tipe === t && (t !== 'iuran' || x.nilai > 0)).length;
      box.innerHTML = `<div class="cards">
          <div class="card"><div class="label">Iuran</div><div class="value">${n('iuran')}</div></div>
          <div class="card"><div class="label">Pemasukan lain</div><div class="value">${n('pemasukan')}</div></div>
          <div class="card"><div class="label">Pengeluaran</div><div class="value">${n('pengeluaran')}</div></div>
          <div class="card"><div class="label">Rumah / mitra baru</div><div class="value">${P.rumah.length} / ${P.mitra.length}</div></div>
          <div class="card"><div class="label">Bulan lunas historis</div><div class="value">${P.info.histCount}</div></div>
          <div class="card"><div class="label">Baris dilewati</div><div class="value ${P.skip.length ? 'neg' : ''}">${P.skip.length}</div></div></div>
        <div class="table-wrap"><table><tbody>${Object.keys(P.info).filter(k => k.startsWith('Saldo')).map(k => `<tr><td>${esc(k)} (disamakan dengan sheet)</td><td class="num">${rp(P.info[k])}</td></tr>`).join('')}
          <tr><td>Pengeluaran gaji tanpa nama mitra yang cocok</td><td class="num">${P.info.gajiTanpaMitra}</td></tr>
          <tr><td>Kategori / dompet tunai baru</td><td class="num">${P.kategori.length} / ${P.dompet.length}</td></tr>
          <tr><td>Cicilan hutang / catatan</td><td class="num">${P.hutang_mitra.length} / ${P.catatan.length}</td></tr></tbody></table></div>
        ${P.skip.length ? `<details style="margin-top:8px"><summary class="small">Lihat baris yang dilewati</summary><pre class="small">${esc(P.skip.slice(0, 200).join('\n'))}</pre></details>` : ''}
        ${S.d.transaksi.length ? `<p class="error">Database sudah berisi ${S.d.transaksi.length} transaksi. Migrasi akan menambah data sehingga bisa dobel.</p>` : ''}
        <div class="form-actions"><button class="btn primary" id="migGo">Mulai migrasi</button></div>`;
      $('#migGo', box).onclick = async () => {
        if (!await ask(`Migrasikan ${P.transaksi.length} transaksi dan data pendukungnya ke database?`)) return;
        $('#migGo', box).disabled = true;
        if (await run(() => runMigrasi(P, t => { const b = $('#migGo', box); if (b) b.textContent = t; }), 'Migrasi selesai')) rerender();
      };
    };
    $('#csvFile', el).onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      const prev = $('#impPrev', el);
      let plan;
      try { plan = planImport(parseCSV(await file.text())); } catch (err) { prev.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
      const n = t => plan.transaksi.filter(x => x.tipe === t).length;
      prev.innerHTML = `<div class="cards">
          <div class="card"><div class="label">Iuran</div><div class="value">${n('iuran')}</div></div>
          <div class="card"><div class="label">Pemasukan lain</div><div class="value">${n('pemasukan')}</div></div>
          <div class="card"><div class="label">Pengeluaran</div><div class="value">${n('pengeluaran')}</div></div>
          <div class="card"><div class="label">Rumah baru</div><div class="value">${plan.rumah.length}</div></div>
          <div class="card"><div class="label">Kategori / dompet baru</div><div class="value">${plan.kategori.length} / ${plan.dompet.length}</div></div>
          <div class="card"><div class="label">Baris dilewati</div><div class="value ${plan.skip.length ? 'neg' : ''}">${plan.skip.length}</div></div></div>
        ${plan.skip.length ? `<details><summary class="small">Lihat baris yang dilewati</summary><pre class="small">${esc(plan.skip.slice(0, 200).join('\n'))}</pre></details>` : ''}
        ${plan.rumah.length ? '<p class="hint">IPL rumah baru diisi dari pembayaran pertama. Periksa di Master Data setelah impor.</p>' : ''}
        <div class="form-actions"><button class="btn primary" id="doImp">Impor ${plan.transaksi.length} transaksi</button></div>`;
      $('#doImp', prev).onclick = async () => {
        $('#doImp', prev).disabled = true; $('#doImp', prev).textContent = 'Mengimpor...';
        const fill = x => Object.assign({ dompet_tujuan_id: null, kategori_id: null, rumah_id: null, mitra_id: null, komponen: null }, x);
        const ok = await run(async () => {
          if (plan.dompet.length) await DB.insert('dompet', plan.dompet);
          if (plan.kategori.length) await DB.insert('kategori', plan.kategori);
          if (plan.rumah.length) await DB.insert('rumah', plan.rumah);
          await DB.insert('transaksi', plan.transaksi.map(fill));
          if (plan.iuran_bulan.length) await DB.insert('iuran_bulan', plan.iuran_bulan);
          await loadAll();
        }, 'Impor selesai');
        if (ok) rerender();
      };
    };
  }

  function exportPdf() {
    if (!window.jspdf || !window.jspdf.jsPDF) return warn('Library PDF belum termuat.');
    const y = S.year, ms = monthsOfYear(y);
    const bm = t => t.bulan || t.tanggal.slice(0, 7);
    const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const green = [31, 111, 92], soft = [227, 241, 236], nama = setting('nama_rt') || 'Rekap Keuangan RT';
    let yPos = 14;
    doc.setFontSize(15); doc.text(`${nama} - Laporan Keuangan ${y}`, 14, yPos);
    doc.setFontSize(9); doc.setTextColor(110); doc.text(`Dibuat ${fmtTgl(todayISO())}`, 14, yPos + 6); doc.setTextColor(0);
    yPos += 14;
    const section = (title, head, body, opts = {}) => {
      if (yPos > 170) { doc.addPage(); yPos = 14; }
      doc.setFontSize(12); doc.text(title, 14, yPos);
      doc.autoTable(Object.assign({ startY: yPos + 3, head: [head], body, theme: 'grid', margin: { left: 14, right: 14 },
        styles: { fontSize: 8, cellPadding: 1.6 }, headStyles: { fillColor: green }, showFoot: 'lastPage', footStyles: { fillColor: soft, textColor: 20, fontStyle: 'bold' } }, opts));
      yPos = doc.lastAutoTable.finalY + 10;
    };
    const R = n => fmtNum(n);
    const right = n => ({ content: n ? R(n) : '-', styles: { halign: 'right' } });
    const sep = (txt, span) => [{ content: txt, colSpan: span, styles: { fillColor: soft, textColor: green, fontStyle: 'bold' } }];

    // 1. Ringkasan
    const ring = ringkasanTahun(y);
    section(`Ringkasan ${y}${kasAwalTahun(y) != null ? ` (kas awal Rp${R(kasAwalTahun(y))})` : ''}`, ['Bulan', 'Pemasukan', 'Pengeluaran', 'Selisih', 'Saldo akhir'],
      ring.map(r => [fmtBulan(r.ym), right(r.masuk), right(r.keluar), right(r.selisih), right(r.saldo)]),
      { foot: [['Total', right(sum(ring, r => r.masuk)), right(sum(ring, r => r.keluar)), right(sum(ring, r => r.selisih)), '']] });

    // 2. Rekap pengeluaran per bulan
    const px = S.d.transaksi.filter(t => t.tipe === 'pengeluaran' && ms.includes(bm(t)));
    const kats = S.d.kategori.slice(); if (px.some(t => !get('kategori', t.kategori_id))) kats.push({ id: null, nama: 'Tanpa kategori' });
    const body2 = [];
    ms.filter(m => px.some(t => bm(t) === m)).reverse().forEach(m => {
      body2.push(sep(fmtBulan(m), 2));
      kats.forEach(k => { const v = sum(px.filter(t => bm(t) === m && (get('kategori', t.kategori_id) ? t.kategori_id : null) === k.id), t => t.nilai); if (v) body2.push([k.nama, right(v)]); });
      body2.push([{ content: 'Total ' + fmtBulan(m), styles: { fontStyle: 'bold' } }, { content: R(sum(px.filter(t => bm(t) === m), t => t.nilai)), styles: { halign: 'right', fontStyle: 'bold' } }]);
    });
    section(`Rekap Pengeluaran ${y}`, ['Kategori', 'Nilai (Rp)'], body2, { foot: [['Total ' + y, right(sum(px, t => t.nilai))]], tableWidth: 150 });

    // 3. Gaji mitra
    const body3 = [];
    S.d.mitra.filter(m => m.aktif).sort((a, b) => a.nama.localeCompare(b.nama, 'id')).forEach(mt => {
      body3.push(sep(`${mt.nama} - ${mt.posisi || ''} (${gajiLabel(mt)})`, 6));
      const list = ms.filter(m => m <= curYM()).map(m => ({ m, c: gajiCalc(mt, m) }));
      list.forEach(x => body3.push([BULAN[+x.m.slice(5) - 1], right(x.c.gaji), right(x.c.terbayar), right(x.c.belum), right(x.c.lain), right(x.c.total)]));
      body3.push([{ content: 'Total', styles: { fontStyle: 'bold' } }, ...['gaji', 'terbayar', 'belum', 'lain', 'total'].map(f => ({ content: R(sum(list, x => x.c[f])), styles: { halign: 'right', fontStyle: 'bold' } }))]);
    });
    section(`Gaji Mitra ${y}`, ['Bulan', 'Gaji', 'Sudah terbayar', 'Belum terbayar', 'Lembur & lainnya', 'Total'], body3);

    // 4. Rekap bayar warga
    const sym = { paid: 'L', partial: 'S', unpaid: 'B', future: '' };
    const body4 = S.d.rumah.filter(r => r.aktif || ms.some(m => S.paid.get(r.id + '|' + m))).map(r => {
      const tg = tunggakan(r);
      return [rumahLabel(r), right(r.ipl), ...ms.map(m => { const s = statusBulan(r, m).s; return { content: sym[s], styles: { halign: 'center', textColor: s === 'paid' ? [46, 139, 87] : s === 'unpaid' ? [192, 57, 43] : [183, 121, 31] } }; }), right(tg.total)];
    });
    if (yPos > 60) { doc.addPage(); yPos = 14; }
    section(`Rekap Bayar Warga ${y}  (L = lunas, S = sebagian, B = belum)`, ['Rumah', 'IPL', ...BLN, 'Tunggakan'], body4, { styles: { fontSize: 7.5, cellPadding: 1.2 } });

    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120); doc.text(`${nama} - ${y} - halaman ${i}/${pages}`, 14, 203); }
    doc.save(`Laporan-Keuangan-${y}.pdf`);
  }

  function exportExcel() {
    if (!window.XLSX) return warn('Library Excel belum termuat.');
    const y = S.year, ms = monthsOfYear(y), wb = XLSX.utils.book_new();
    const tx = S.d.transaksi.filter(t => t.tanggal.startsWith(String(y)));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Tanggal', 'Tipe', 'Rumah', 'Bulan', 'Kategori', 'Mitra', 'Keterangan', 'Dompet', 'Dompet tujuan', 'Nilai'],
      ...tx.map(t => [t.tanggal, TIPE_LABEL[t.tipe], t.rumah_id ? rumahLabel(get('rumah', t.rumah_id)) : '', t.tipe === 'iuran' ? (S.iuranByTrx.get(t.id) || []).map(b => fmtBulan(b.bulan)).join(', ') : fmtBulan(t.bulan),
        (get('kategori', t.kategori_id) || {}).nama || '', (get('mitra', t.mitra_id) || {}).nama || '', t.keterangan || '', (get('dompet', t.dompet_id) || {}).nama || '', (get('dompet', t.dompet_tujuan_id) || {}).nama || '', t.nilai])]), 'Transaksi');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Bulan', 'Pemasukan', 'Pengeluaran', 'Selisih', 'Saldo akhir'],
      ...ringkasanTahun(y).map(r => [fmtBulan(r.ym), r.masuk, r.keluar, r.selisih, r.saldo])]), 'Ringkasan');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Rumah', 'IPL', ...ms.map(fmtBulan), 'Tunggakan (bln)', 'Total tunggakan'],
      ...S.d.rumah.map(r => { const tg = tunggakan(r); return [rumahLabel(r), r.ipl, ...ms.map(m => S.paid.get(r.id + '|' + m) || 0), tg.bulan.length, tg.total]; })]), 'Rekap Bayar');
    const pk = S.d.transaksi.filter(t => t.tipe === 'pengeluaran' && ms.includes(t.bulan || t.tanggal.slice(0, 7)));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Kategori', ...ms.map(fmtBulan), 'Total'],
      ...S.d.kategori.map(k => { const v = ms.map(m => sum(pk.filter(t => t.kategori_id === k.id && (t.bulan || t.tanggal.slice(0, 7)) === m), t => t.nilai)); return [k.nama, ...v, sum(v)]; })]), 'Pengeluaran');
    XLSX.writeFile(wb, `Rekap-Keuangan-${y}.xlsx`);
  }

  // ------------------------------------------------------------------ boot
  function applyBrand() {
    const n = (S.d.pengaturan && setting('nama_rt')) || 'Rekap Keuangan RT';
    $('#brandName').textContent = n + (MODE === 'admin' ? ' · Admin' : ''); document.title = MODE === 'admin' ? 'Admin · ' + n : n;
  }
  async function enterApp(me) {
    // Jangan logout: sesi warga di tab lain tetap aktif. Cukup minta login dengan akun admin.
    if (MODE === 'admin' && me.role !== 'admin' && me.role !== 'viewer') return showLogin('Anda sedang masuk sebagai warga. Masuk dengan akun admin untuk membuka halaman ini.');
    S.me = me;
    document.body.classList.toggle('ro', MODE === 'admin' && me.role === 'viewer');
    if (MODE === 'admin' && me.role === 'viewer' && !DB._roWrapped) {
      ['insert', 'upsert', 'update', 'remove', 'removeWhere'].forEach(fn => { if (DB[fn]) DB[fn] = async () => { throw new Error('Akun ini hanya bisa melihat data (view only).'); }; });
      DB._roWrapped = true;
    }
    $('#login').classList.add('hidden');
    $('#view').innerHTML = '<div class="empty">Memuat data...</div>';
    $('#app').classList.remove('hidden');
    try { await loadAll(); } catch (e) { $('#view').innerHTML = `<div class="panel error">Gagal memuat data: ${esc(e.message)}</div>`; return; }
    applyBrand();
    $('#userInfo').innerHTML = `${esc(me.nama)}<br><span class="badge ${isAdmin() ? 'info' : ''}">${canWrite() ? 'Admin' : isAdmin() ? 'Admin · lihat saja' : 'Warga · lihat saja'}</span>`;
    buildNav(); route();
  }
  function showLogin(err) {
    $('#app').classList.add('hidden'); $('#login').classList.remove('hidden');
    $('#loginDemo').classList.toggle('hidden', !DB.demo); $('#loginReal').classList.toggle('hidden', DB.demo);
    $('#loginError').textContent = err || '';
  }

  document.addEventListener('DOMContentLoaded', async () => {
    $('#demoBadge').classList.toggle('hidden', !DB.demo);
    $('#modalClose').onclick = closeModal;
    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    $('#menuBtn').onclick = () => { $('#sidebar').classList.add('open'); $('#backdrop').classList.add('show'); };
    $('#backdrop').onclick = () => { $('#sidebar').classList.remove('open'); $('#backdrop').classList.remove('show'); };
    $('#logoutBtn').onclick = async () => { await DB.signOut(); S.me = null; location.hash = ''; showLogin(); };
    window.addEventListener('hashchange', () => { if (S.me) route(); });
    $('#loginForm').onsubmit = async e => {
      e.preventDefault(); if (DB.demo) return;
      const fd = new FormData(e.target);
      try { enterApp(await DB.signIn(fd.get('email'), fd.get('password'))); } catch (err) { $('#loginError').textContent = err.message; }
    };
    $('#demoLogin').onclick = async () => enterApp(await DB.signInDemo(MODE));
    if (MODE === 'admin') { $('#loginTitle').textContent = 'Admin Rekap Keuangan RT'; $('#loginSub').textContent = 'Masuk dengan akun admin.'; }
    try { const me = await DB.session(); if (me) enterApp(me); else showLogin(); } catch (e) { showLogin(e.message); }
  });
})();
