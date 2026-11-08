// Loads index.html / admin.html in jsdom, in DEMO mode (empty config), with CDN libraries stripped.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = process.env.APP_ROOT || path.resolve(__dirname, '..', '..');
const FORM_FIELDS = ['biaya', 'bulan', 'catat', 'cicilan_ke', 'dompet_id', 'dompet_tujuan_id', 'gaji_mulai', 'isi', 'kategori_id', 'kb_cicil', 'kb_mulai', 'kb_n',
  'keterangan', 'komponen', 'mitra_id', 'mulai', 'mulai_tagih', 'n', 'nama', 'nama_rt', 'nilai', 'nominal', 'nyata', 'rumah', 'tanggal', 'total',
  'aktif', 'bank', 'blok', 'gaji_pokok', 'ipl', 'jenis', 'jenis_gaji', 'kode', 'nama_rekening', 'no_hp', 'posisi', 'saldo_awal', 'tgl_resign', 'urutan'];

async function boot(page = 'admin.html', { seed } = {}) {
  let html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const inline = f => `<script>${fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/<\/script>/g, '<\\/script>')}</script>`;
  html = html
    .replace(/<script src="https:[^"]+"><\/script>\s*/g, '')
    .replace(/<script src="config\.js[^"]*"><\/script>/, '<script>window.APP_CONFIG = { SUPABASE_URL: "", SUPABASE_ANON_KEY: "" };</script>')
    .replace(/<script src="db\.js[^"]*"><\/script>/, () => inline('db.js'))
    .replace(/<script src="app\.js[^"]*"><\/script>/, () => inline('app.js'));
  const dom = new JSDOM(html, {
    url: 'http://localhost/' + page,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.scrollTo = () => {};
      w.print = () => {};
      if (!w.crypto.randomUUID) w.crypto.randomUUID = require('crypto').randomUUID;
      // jsdom has no named-property access on forms (form.nilai); app.js relies on it.
      FORM_FIELDS.forEach(n => {
        if (n in w.HTMLFormElement.prototype) return;
        Object.defineProperty(w.HTMLFormElement.prototype, n, { configurable: true, get() { return this.elements.namedItem(n) || undefined; } });
      });
      if (seed) seed(w);
    },
  });
  const w = dom.window;
  await tick(50);
  return { dom, w, $: s => w.document.querySelector(s), $$: s => [...w.document.querySelectorAll(s)] };
}
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

async function login(app) {
  app.$('#demoLogin').click();
  await waitFor(() => !app.$('#app').classList.contains('hidden') && app.$('#nav a'));
}
async function go(app, key) {
  app.w.location.hash = '#' + key;
  await tick(30);
  await waitFor(() => app.$('#pageTitle').textContent && !app.$('#view').textContent.includes('Memuat'));
  await tick(30);
}
async function waitFor(fn, ms = 3000) {
  const t0 = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('waitFor timeout'); await tick(15); }
}
async function confirmAsk(app) { await waitFor(() => app.$('#askYes')); app.$('#askYes').click(); await tick(60); }

// Pulls a top-level `const name = ...;` or `function name(...) {...}` from app.js so pure helpers can be unit-tested.
function extract(names) {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const out = [];
  for (const n of names) {
    let m = src.match(new RegExp(`\\n  const ${n} = [\\s\\S]*?;\\n(?=  (const|function|//|async|let))`));
    if (!m) m = src.match(new RegExp(`\\n  function ${n}\\([\\s\\S]*?\\n  }\\n`));
    if (!m) throw new Error('not found in app.js: ' + n);
    out.push(m[0]);
  }
  // eslint-disable-next-line no-new-func
  return new Function(out.join('\n') + `\nreturn { ${names.join(', ')} };`)();
}

const submit = async (app, form, ms = 150) => { form.dispatchEvent(new app.w.Event('submit', { cancelable: true })); await tick(ms); };
const fire = async (app, el, type = 'change', ms = 40) => { el.dispatchEvent(new app.w.Event(type, { bubbles: true })); await tick(ms); };
// Demo-mode session for a role the demo login button can't produce (viewer, or warga on admin.html)
const asRole = (role, nama = role) => w => w.sessionStorage.setItem('rekap-rt-demo-v5-me', JSON.stringify({ id: 'u-' + role, email: role + '@demo', nama, role }));

// "Rp1.250.000,50" -> 1250000.5
const rpNum = s => { const t = String(s).replace(/[^\d,-]/g, '').replace(',', '.'); return t ? +t : 0; };
const pad = n => String(n).padStart(2, '0');
const curYM = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const curY = () => new Date().getFullYear();
let houseN = 0;
// Adds an active house with no payments (so every month since "mulai penagihan" is unpaid) and reloads app data
async function newHouse(app, ipl = 150000) {
  const id = 'r-test-' + (++houseN), kode = `KB9/${houseN}`;
  await app.w.DB.insert('rumah', { id, kode, nama: 'Rumah Uji ' + houseN, grup: '', blok: 'KB9', ipl, aktif: true });
  return { id, kode, label: `${kode} - Rumah Uji ${houseN}` };
}
// Navigates away and back so hashchange reloads all data
async function reopen(app, key) { await go(app, key === 'dashboard' ? 'bayar' : 'dashboard'); await go(app, key); }
async function iuranForm(app, house) {
  await reopen(app, 'input');
  const tab = app.$$('.tabs button').find(b => b.dataset.t === 'iuran'); tab.click(); await tick(40);
  const f = app.$('#trxForm');
  if (house) { f.rumah.value = house.label; await fire(app, f.rumah); }
  return f;
}
const monthBtn = (app, ym) => app.$(`#monthsBox button[data-m="${ym}"]`);
const bayarCell = async (app, kode, monthIndex) => {
  await reopen(app, 'bayar');
  const row = app.$$('table.matrix tbody tr').find(tr => tr.querySelector('.rumah-col b') && tr.querySelector('.rumah-col b').textContent === kode);
  return row ? row.querySelectorAll('td.cell')[monthIndex] : null;
};
const toastText = app => app.$('#toast').textContent;

module.exports = { boot, login, go, tick, waitFor, confirmAsk, extract, submit, fire, asRole, ROOT,
  rpNum, curYM, curY, newHouse, reopen, iuranForm, monthBtn, bayarCell, toastText };
