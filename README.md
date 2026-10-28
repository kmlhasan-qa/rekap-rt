# Rekap Keuangan RT

Aplikasi web untuk pencatatan iuran IPL warga dan pengeluaran RT/cluster.
Frontend statis (HTML/CSS/JS) untuk GitHub Pages, backend Supabase.

- **Admin (hanya Anda)**: input, edit, hapus transaksi, pencairan gaji mitra, master data, hutang mitra, catatan, akun, audit, impor/ekspor (Excel & PDF).
- **Warga**: hanya melihat laporan (Ringkasan, Rekap Bayar Warga, Rekap Pengeluaran, Gaji Mitra).
  Penulisan data diblokir di database lewat Row Level Security, bukan hanya disembunyikan di tampilan.

## Dua alamat
- **Warga**: `https://<akun>.github.io/<repo>/` (index.html), hanya laporan.
- **Admin**: `https://<akun>.github.io/<repo>/admin.html`, hanya bisa dibuka dengan akun admin.
  Bagikan ke warga hanya alamat pertama. Akun admin yang membuka alamat warga tetap melihat tampilan warga.

## Coba dulu (mode demo)
Biarkan `js/config.js` kosong lalu buka `index.html` lewat server lokal
(mis. `python3 -m http.server`). Buka `index.html` untuk tampilan warga atau `admin.html` untuk admin, lalu tekan "Masuk".
Data contoh tersimpan di browser saja dan bisa di-reset dari menu Impor / Ekspor.

## Setup produksi
1. **Buat project Supabase** baru di https://supabase.com (terpisah dari project lain).
2. **Jalankan SQL**: Supabase → SQL Editor → tempel isi `supabase/schema.sql` → Run.
3. **Matikan pendaftaran mandiri**: Authentication → Sign In / Providers → Email →
   matikan *Allow new users to sign up*.
4. **Buat akun admin**: Authentication → Users → Add user (centang *Auto Confirm User*),
   lalu jalankan di SQL Editor:
   ```sql
   update public.profiles set role = 'admin', nama = 'Nama Anda' where email = 'email@anda.com';
   ```
5. **Isi `js/config.js`** dengan Project URL dan anon public key (Project Settings → API).
6. **Deploy ke GitHub Pages**: buat repo baru, upload semua file, lalu
   Settings → Pages → Deploy from branch `main` / root.
7. Tambahkan URL GitHub Pages di Supabase → Authentication → URL Configuration → Site URL.
8. **Akun warga**: buat di Authentication → Users (bisa satu akun bersama). Otomatis berperan *warga*.

## Data awal
- Atur **Master Data → Dompet**: rekening + dompet tunai per pemegang, beserta saldo awalnya.
- Atur **Master Data → Pengaturan → Mulai penagihan IPL**.
- Impor data lama: di Google Sheet tab "Data" → File → Download → CSV, lalu menu **Impor / Ekspor**.

## Struktur
```
index.html          halaman warga (laporan)
admin.html          halaman admin
css/style.css       tampilan
js/config.js        kunci Supabase (kosong = mode demo)
js/db.js            akses data (Supabase / demo)
js/app.js           halaman & logika laporan
supabase/schema.sql tabel, RLS, trigger audit, data awal
```

## Pencairan gaji mitra
- Bayar 1x (pilih tahap *Akhir bulan*) atau 2x (*Tengah bulan* lalu *Akhir bulan*), via transfer atau tunai.
- Akhir bulan otomatis = gaji − pembayaran tengah bulan − kasbon − cicilan hutang bulan itu.
  Cicilan yang terpotong otomatis ditandai lunas (kembali belum lunas jika transaksi gajinya dihapus).
- Mitra *per kedatangan*: centang "Datang bulan ini"; jika tidak dicentang, gaji tidak dibayarkan.

## Memperbarui database lama
Jika `schema.sql` versi sebelumnya sudah pernah dijalankan, jalankan ulang file `schema.sql` terbaru.
Bagian "Pembaruan untuk database yang dibuat dengan versi skema sebelumnya" akan menambah kolom yang baru.

## Catatan teknis
- Laporan dihitung di browser dari tabel transaksi, jadi selalu konsisten dengan data input.
- Satu pembayaran iuran bisa untuk beberapa bulan; nominal mengisi sisa tagihan tiap bulan secara berurutan. Bulan yang sudah lunas tidak bisa dipilih, dan opsi *Bayar sebagian* mencatat pembayaran kurang dari tagihan.
- Pengeluaran yang diisi kolom *Mitra* otomatis muncul di laporan Gaji Mitra (gaji/kasbon/lembur/THR).
- Setiap tambah/ubah/hapus transaksi tercatat di Audit Log oleh trigger database.
