-- Fixed test data for the throwaway database (loaded after schema.sql)
insert into auth.users values
 ('00000000-0000-0000-0000-00000000000a','admin@example.com'),
 ('00000000-0000-0000-0000-00000000000b','viewer@example.com'),
 ('00000000-0000-0000-0000-00000000000c','warga@example.com'),
 ('00000000-0000-0000-0000-00000000000d','inactive@example.com'),
 ('00000000-0000-0000-0000-00000000000e','newuser@example.com');
update public.profiles set role = 'admin' where email = 'admin@example.com';
update public.profiles set role = 'viewer' where email = 'viewer@example.com';
update public.profiles set aktif = false where email = 'inactive@example.com';

insert into public.rumah (id, kode, nama, ipl) values ('10000000-0000-0000-0000-000000000001', 'KB1/2', 'Warga Test', 150000);
insert into public.rumah_rekening values ('10000000-0000-0000-0000-000000000001', 'BCA', 'Warga Test', '0811');
insert into public.mitra (id, nama, gaji_pokok) values ('20000000-0000-0000-0000-000000000001', 'Mitra Test', 1500000);
insert into public.hutang_mitra (mitra_id, bulan, nominal) values ('20000000-0000-0000-0000-000000000001', '2026-11', 300000);
insert into public.kedatangan_mitra (mitra_id, bulan, ke) values ('20000000-0000-0000-0000-000000000001', '2026-11', 1);
insert into public.catatan (isi) values ('catatan internal');
insert into public.transaksi (id, tipe, tanggal, nilai, dompet_id, rumah_id, bulan)
  select '30000000-0000-0000-0000-000000000001', 'iuran', '2026-11-01', 150000, id, '10000000-0000-0000-0000-000000000001', '2026-11'
  from public.dompet where nama = 'Kas Mandiri Sherwood';
insert into public.iuran_bulan (transaksi_id, rumah_id, bulan, nominal)
  values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '2026-11', 150000);
