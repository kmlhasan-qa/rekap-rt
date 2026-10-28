-- =====================================================================
-- Rekap Keuangan RT – skema database Supabase
-- Jalankan sekali di Supabase Dashboard → SQL Editor → New query → Run
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Profil pengguna (terhubung ke auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text,
  nama        text,
  role        text not null default 'warga' check (role in ('admin','warga')),
  aktif       boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Setiap user baru otomatis dibuatkan profil dengan role 'warga'
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and aktif);
$$;

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and aktif);
$$;

-- ---------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------
create table if not exists public.pengaturan (
  key   text primary key,
  value text
);

create table if not exists public.rumah (
  id          uuid primary key default gen_random_uuid(),
  kode        text not null unique,          -- contoh: KB1/26
  nama        text,
  grup        text,                          -- contoh: KB Lama / KB Baru
  blok        text,                          -- contoh: KB1
  ipl         numeric(14,2) not null default 0,
  aktif       boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Data rekening & HP warga dipisah agar hanya admin yang bisa melihat
create table if not exists public.rumah_rekening (
  rumah_id       uuid primary key references public.rumah on delete cascade,
  bank           text,
  nama_rekening  text,
  no_hp          text
);

create table if not exists public.kategori (
  id      uuid primary key default gen_random_uuid(),
  nama    text not null unique,
  urutan  int not null default 0
);

create table if not exists public.dompet (
  id          uuid primary key default gen_random_uuid(),
  nama        text not null unique,
  jenis       text not null check (jenis in ('rekening','tunai')),
  saldo_awal  numeric(14,2) not null default 0,   -- saldo sebelum transaksi pertama dicatat
  aktif       boolean not null default true
);

create table if not exists public.mitra (
  id          uuid primary key default gen_random_uuid(),
  nama        text not null,
  posisi      text,
  jenis_gaji  text not null default 'bulanan' check (jenis_gaji in ('bulanan','kedatangan')), -- kedatangan: dibayar hanya jika datang
  gaji_pokok  numeric(14,2) not null default 0,   -- per bulan, atau per kedatangan
  aktif       boolean not null default true,
  tgl_resign  date
);

-- ---------------------------------------------------------------------
-- Transaksi
-- ---------------------------------------------------------------------
create table if not exists public.transaksi (
  id                uuid primary key default gen_random_uuid(),
  tipe              text not null check (tipe in ('iuran','pemasukan','pengeluaran','mutasi')),
  tanggal           date not null,
  nilai             numeric(14,2) not null check (nilai >= 0),
  dompet_id         uuid not null references public.dompet,
  dompet_tujuan_id  uuid references public.dompet,           -- hanya untuk mutasi
  kategori_id       uuid references public.kategori,         -- hanya untuk pengeluaran
  rumah_id          uuid references public.rumah,            -- hanya untuk iuran
  mitra_id          uuid references public.mitra,            -- pengeluaran gaji/kasbon mitra
  komponen          text check (komponen in ('gaji_tengah','gaji','kasbon','lembur','thr','lainnya')),
  bulan             char(7) check (bulan ~ '^\d{4}-\d{2}$'), -- bulan pembebanan (YYYY-MM)
  keterangan        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists transaksi_tanggal_idx on public.transaksi (tanggal);
create index if not exists transaksi_tipe_idx on public.transaksi (tipe);

create table if not exists public.iuran_bulan (
  id            uuid primary key default gen_random_uuid(),
  transaksi_id  uuid not null references public.transaksi on delete cascade,
  rumah_id      uuid not null references public.rumah,
  bulan         char(7) not null check (bulan ~ '^\d{4}-\d{2}$'),
  nominal       numeric(14,2) not null default 0
);
create index if not exists iuran_bulan_rumah_idx on public.iuran_bulan (rumah_id, bulan);

create table if not exists public.hutang_mitra (
  id          uuid primary key default gen_random_uuid(),
  mitra_id    uuid references public.mitra,
  keterangan  text,
  bulan       char(7) not null check (bulan ~ '^\d{4}-\d{2}$'),
  cicilan_ke  int,
  nominal     numeric(14,2) not null default 0,
  lunas       boolean not null default false,
  transaksi_id uuid references public.transaksi on delete set null,  -- gaji yang memotong cicilan ini
  sumber_id    uuid references public.transaksi on delete set null   -- pengeluaran kasbon asal (belum terealisasi)
);

-- Kedatangan mitra yang digaji per kedatangan
create table if not exists public.kedatangan_mitra (
  id            uuid primary key default gen_random_uuid(),
  mitra_id      uuid not null references public.mitra on delete cascade,
  bulan         char(7) not null check (bulan ~ '^\d{4}-\d{2}$'),
  ke            int not null,
  transaksi_id  uuid references public.transaksi on delete set null   -- terisi = sudah dibayar
);
create index if not exists kedatangan_mitra_idx on public.kedatangan_mitra (mitra_id, bulan);

create table if not exists public.catatan (
  id       uuid primary key default gen_random_uuid(),
  tanggal  date not null default current_date,
  isi      text not null,
  status   text not null default 'Open' check (status in ('Open','Clear'))
);

create table if not exists public.audit_log (
  id         bigserial primary key,
  waktu      timestamptz not null default now(),
  user_id    uuid,
  aksi       text,
  tabel      text,
  data_lama  jsonb,
  data_baru  jsonb
);

-- Audit otomatis untuk transaksi
create or replace function public.audit_transaksi()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (user_id, aksi, tabel, data_lama, data_baru)
  values (auth.uid(), tg_op, tg_table_name,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_audit_transaksi on public.transaksi;
create trigger trg_audit_transaksi
  before insert or update or delete on public.transaksi
  for each row execute function public.audit_transaksi();

-- ---------------------------------------------------------------------
-- Row Level Security
--   * Admin  : boleh baca & tulis semua
--   * Warga  : hanya BACA data laporan; tidak bisa tulis apa pun
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.pengaturan      enable row level security;
alter table public.rumah           enable row level security;
alter table public.rumah_rekening  enable row level security;
alter table public.kategori        enable row level security;
alter table public.dompet          enable row level security;
alter table public.mitra           enable row level security;
alter table public.transaksi       enable row level security;
alter table public.iuran_bulan     enable row level security;
alter table public.hutang_mitra    enable row level security;
alter table public.kedatangan_mitra enable row level security;
alter table public.catatan         enable row level security;
alter table public.audit_log       enable row level security;

-- profiles: user melihat profilnya sendiri; admin melihat & mengubah semua
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update
  using (public.is_admin()) with check (public.is_admin());

-- Tabel laporan: warga & admin boleh baca, hanya admin boleh tulis
do $$
declare t text;
begin
  foreach t in array array['pengaturan','rumah','kategori','dompet','mitra','transaksi','iuran_bulan'] loop
    execute format('drop policy if exists %I on public.%I', t||'_read', t);
    execute format('create policy %I on public.%I for select using (public.is_member())', t||'_read', t);
    execute format('drop policy if exists %I on public.%I', t||'_admin', t);
    execute format('create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())', t||'_admin', t);
  end loop;
end $$;

-- Tabel khusus admin (baca & tulis)
do $$
declare t text;
begin
  foreach t in array array['rumah_rekening','hutang_mitra','kedatangan_mitra','catatan'] loop
    execute format('drop policy if exists %I on public.%I', t||'_admin', t);
    execute format('create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())', t||'_admin', t);
  end loop;
end $$;

drop policy if exists audit_admin_read on public.audit_log;
create policy audit_admin_read on public.audit_log for select using (public.is_admin());

-- ---------------------------------------------------------------------
-- Pembaruan untuk database yang dibuat dengan versi skema sebelumnya
-- (aman dijalankan ulang)
-- ---------------------------------------------------------------------
alter table public.mitra add column if not exists jenis_gaji text not null default 'bulanan';
alter table public.hutang_mitra add column if not exists transaksi_id uuid references public.transaksi on delete set null;
alter table public.hutang_mitra add column if not exists sumber_id uuid references public.transaksi on delete set null;
alter table public.transaksi drop constraint if exists transaksi_komponen_check;
alter table public.transaksi add constraint transaksi_komponen_check
  check (komponen in ('gaji_tengah','gaji','kasbon','lembur','thr','lainnya'));

-- ---------------------------------------------------------------------
-- Data awal
-- ---------------------------------------------------------------------
insert into public.pengaturan (key, value) values
  ('nama_rt', 'Rekap Keuangan RT'),
  ('mulai_tagih', to_char(date_trunc('year', current_date), 'YYYY-MM'))
on conflict (key) do nothing;

insert into public.kategori (nama, urutan) values
  ('Operasional - Gaji, THR, Kasbon Mitra', 1),
  ('Operasional - Lembur Mitra', 2),
  ('Operasional - Listrik, Air, Pulsa, Internet, Galon, dll', 3),
  ('Operasional - Biaya Admin, Pajak, dll', 4),
  ('Maintenance Aset, Pemeliharaan Taman, Cluster, dll', 5),
  ('Lainnya', 9)
on conflict (nama) do nothing;

insert into public.dompet (nama, jenis, saldo_awal) values
  ('Kas Mandiri Sherwood', 'rekening', 0),
  ('Kas Krom Sherwood', 'rekening', 0)
on conflict (nama) do nothing;

-- =====================================================================
-- SETELAH membuat akun Anda di Authentication → Users, jadikan admin:
--   update public.profiles set role = 'admin', nama = 'Manal'
--   where email = 'EMAIL_ANDA@contoh.com';
-- =====================================================================
