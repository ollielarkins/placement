-- 0032: Complete University Guide 2027 positions on every course (06/11/2026).
--
-- Published with the Complete University Guide's permission (confirmed by
-- Ollie, 06/11/2026). Shown as the position and table name with a credit and
-- a link to the table; never their scores. Source: the CUG 2027 tables
-- (overall, and Electrical and Electronic Engineering, Aeronautical and
-- Aerospace Engineering, Mechanical Engineering, Computer Science), saved
-- 06/11/2026; data/cug-2027.csv lists every row with CUG's name for the
-- university and the UKPRN we matched it to. Five overall-table entries with
-- no course in our data are not loaded.
--
-- * league_table_positions: one row per university per table (cah_code
--   null = the overall table). Public read; changed only by migrations.
-- * cug_positions(): a course's CUG subject position (the first of its
--   subjects with a table) and its university's overall position.
-- * search_uni_courses returns both and gains sort = 'cug';
--   uni_course_detail and liked_items return them.

create table public.league_table_positions (
  publisher text not null default 'cug' check (publisher = 'cug'),
  edition smallint not null check (edition between 2020 and 2100),
  cah_code text references public.cah_subjects (code),
  university_id uuid not null references public.universities (id) on delete cascade,
  position smallint not null check (position > 0),
  tied boolean not null default false,
  table_size smallint not null check (table_size > 0),
  check (position <= table_size)
);
create unique index league_table_positions_key
  on public.league_table_positions (publisher, edition, coalesce(cah_code, ''), university_id);
create index league_table_positions_uni_idx on public.league_table_positions (university_id, cah_code);

alter table public.league_table_positions enable row level security;
create policy "league_table_positions: public read" on public.league_table_positions
  for select to anon, authenticated using (true);
grant select on public.league_table_positions to anon, authenticated;

comment on table public.league_table_positions is
  'Complete University Guide positions, published with permission. Credit "Complete University Guide <edition>" and link to the table wherever shown.';

insert into public.league_table_positions (edition, cah_code, university_id, position, tied, table_size)
select 2027, v.cah_code, u.id, v.position, v.tied, v.table_size
from (values
  ('CAH11-01-01', '10003270', 1, false, 118),
  ('CAH11-01-01', '10007788', 2, false, 118),
  ('CAH11-01-01', '10007774', 3, false, 118),
  ('CAH11-01-01', '10007803', 4, false, 118),
  ('CAH11-01-01', '10007163', 5, false, 118),
  ('CAH11-01-01', '10006840', 6, false, 118),
  ('CAH11-01-01', '10007784', 7, false, 118),
  ('CAH11-01-01', '10007143', 8, false, 118),
  ('CAH11-01-01', '10007798', 9, false, 118),
  ('CAH11-01-01', '10007850', 10, false, 118),
  ('CAH11-01-01', '10007786', 11, false, 118),
  ('CAH11-01-01', '10007158', 12, false, 118),
  ('CAH11-01-01', '10007790', 13, false, 118),
  ('CAH11-01-01', '10003645', 14, false, 118),
  ('CAH11-01-01', '10007157', 15, false, 118),
  ('CAH11-01-01', '10007794', 16, false, 118),
  ('CAH11-01-01', '10007792', 17, false, 118),
  ('CAH11-01-01', '10007154', 18, false, 118),
  ('CAH11-01-01', '10004113', 19, false, 118),
  ('CAH11-01-01', '10007775', 20, false, 118),
  ('CAH11-01-01', '10005343', 21, false, 118),
  ('CAH11-01-01', '10007167', 22, false, 118),
  ('CAH11-01-01', '10007795', 23, false, 118),
  ('CAH11-01-01', '10007768', 24, false, 118),
  ('CAH11-01-01', '10007814', 25, false, 118),
  ('CAH11-01-01', '10007160', 26, false, 118),
  ('CAH11-01-01', '10007799', 27, false, 118),
  ('CAH11-01-01', '10006842', 28, false, 118),
  ('CAH11-01-01', '10005553', 29, false, 118),
  ('CAH11-01-01', '10007796', 30, false, 118),
  ('CAH11-01-01', '10007855', 31, false, 118),
  ('CAH11-01-01', '10007783', 32, false, 118),
  ('CAH11-01-01', '10007805', 33, false, 118),
  ('CAH11-01-01', '10007852', 34, false, 118),
  ('CAH11-01-01', '10007806', 35, false, 118),
  ('CAH11-01-01', '10007789', 36, false, 118),
  ('CAH11-01-01', '10007764', 37, false, 118),
  ('CAH11-01-01', '10007150', 38, false, 118),
  ('CAH11-01-01', '10007802', 39, false, 118),
  ('CAH11-01-01', '10007759', 40, false, 118),
  ('CAH11-01-01', '10007857', 41, false, 118),
  ('CAH11-01-01', '10007807', 42, false, 118),
  ('CAH11-01-01', '10007804', 43, false, 118),
  ('CAH11-01-01', '10001478', 44, false, 118),
  ('CAH11-01-01', '10007856', 45, false, 118),
  ('CAH11-01-01', '10007147', 46, false, 118),
  ('CAH11-01-01', '10001282', 47, false, 118),
  ('CAH11-01-01', '10007151', 48, false, 118),
  ('CAH11-01-01', '10007149', 49, false, 118),
  ('CAH11-01-01', '10007148', 50, false, 118),
  ('CAH11-01-01', '10007791', 51, false, 118),
  ('CAH11-01-01', '10007155', 52, false, 118),
  ('CAH11-01-01', '10007823', 53, false, 118),
  ('CAH11-01-01', '10007767', 54, false, 118),
  ('CAH11-01-01', '10008640', 55, false, 118),
  ('CAH11-01-01', '10000961', 56, false, 118),
  ('CAH11-01-01', '10007849', 57, false, 118),
  ('CAH11-01-01', '10004180', 58, false, 118),
  ('CAH11-01-01', '10004797', 59, false, 118),
  ('CAH11-01-01', '10007787', 60, false, 118),
  ('CAH11-01-01', '10007762', 61, false, 118),
  ('CAH11-01-01', '10007139', 62, false, 118),
  ('CAH11-01-01', '10006299', 63, false, 118),
  ('CAH11-01-01', '10007164', 64, false, 118),
  ('CAH11-01-01', '10004930', 65, false, 118),
  ('CAH11-01-01', '10000571', 66, false, 118),
  ('CAH11-01-01', '10007772', 67, false, 118),
  ('CAH11-01-01', '10003614', 68, false, 118),
  ('CAH11-01-01', '10007137', 69, false, 118),
  ('CAH11-01-01', '10007162', 70, false, 118),
  ('CAH11-01-01', '10000824', 71, false, 118),
  ('CAH11-01-01', '10007801', 72, false, 118),
  ('CAH11-01-01', '10007161', 73, false, 118),
  ('CAH11-01-01', '10005790', 74, false, 118),
  ('CAH11-01-01', '10005500', 75, false, 118),
  ('CAH11-01-01', '10007851', 76, false, 118),
  ('CAH11-01-01', '10007785', 77, false, 118),
  ('CAH11-01-01', '10003678', 78, false, 118),
  ('CAH11-01-01', '10004078', 79, false, 118),
  ('CAH11-01-01', '10007159', 80, false, 118),
  ('CAH11-01-01', '10007848', 81, false, 118),
  ('CAH11-01-01', '10001883', 82, false, 118),
  ('CAH11-01-01', '10000886', 83, false, 118),
  ('CAH11-01-01', '10003957', 84, false, 118),
  ('CAH11-01-01', '10007140', 85, false, 118),
  ('CAH11-01-01', '10003861', 86, false, 118),
  ('CAH11-01-01', '10007156', 87, false, 118),
  ('CAH11-01-01', '10001726', 88, false, 118),
  ('CAH11-01-01', '10007166', 89, false, 118),
  ('CAH11-01-01', '10007144', 90, false, 118),
  ('CAH11-01-01', '10006427', 91, false, 118),
  ('CAH11-01-01', '10007793', 92, false, 118),
  ('CAH11-01-01', '10003863', 93, false, 118),
  ('CAH11-01-01', '10002718', 94, false, 118),
  ('CAH11-01-01', '10003956', 95, false, 118),
  ('CAH11-01-01', '10006566', 96, false, 118),
  ('CAH11-01-01', '10007141', 97, false, 118),
  ('CAH11-01-01', '10007138', 98, false, 118),
  ('CAH11-01-01', '10007713', 99, false, 118),
  ('CAH11-01-01', '10007145', 100, false, 118),
  ('CAH11-01-01', '10007854', 101, false, 118),
  ('CAH11-01-01', '10007165', 102, false, 118),
  ('CAH11-01-01', '10007832', 103, false, 118),
  ('CAH11-01-01', '10001143', 104, false, 118),
  ('CAH11-01-01', '10000291', 105, false, 118),
  ('CAH11-01-01', '10007146', 106, false, 118),
  ('CAH11-01-01', '10004775', 107, false, 118),
  ('CAH11-01-01', '10006022', 108, false, 118),
  ('CAH11-01-01', '10006841', 109, false, 118),
  ('CAH11-01-01', '10004048', 110, false, 118),
  ('CAH11-01-01', '10014001', 111, false, 118),
  ('CAH11-01-01', '10007152', 112, false, 118),
  ('CAH11-01-01', '10004351', 113, false, 118),
  ('CAH11-01-01', '10007800', 114, false, 118),
  ('CAH11-01-01', '10007858', 115, false, 118),
  ('CAH11-01-01', '10000975', 116, false, 118),
  ('CAH11-01-01', '10007776', 117, false, 118),
  ('CAH11-01-01', '10007833', 118, false, 118),
  ('CAH10-01-08', '10007788', 1, false, 71),
  ('CAH10-01-08', '10003270', 2, false, 71),
  ('CAH10-01-08', '10007774', 3, false, 71),
  ('CAH10-01-08', '10007158', 4, false, 71),
  ('CAH10-01-08', '10007798', 5, false, 71),
  ('CAH10-01-08', '10007784', 6, false, 71),
  ('CAH10-01-08', '10007157', 7, false, 71),
  ('CAH10-01-08', '10007794', 8, false, 71),
  ('CAH10-01-08', '10007792', 9, false, 71),
  ('CAH10-01-08', '10007786', 10, false, 71),
  ('CAH10-01-08', '10007795', 11, false, 71),
  ('CAH10-01-08', '10005343', 12, false, 71),
  ('CAH10-01-08', '10007850', 13, false, 71),
  ('CAH10-01-08', '10007790', 14, false, 71),
  ('CAH10-01-08', '10007768', 15, false, 71),
  ('CAH10-01-08', '10007154', 16, false, 71),
  ('CAH10-01-08', '10004113', 17, false, 71),
  ('CAH10-01-08', '10007805', 18, false, 71),
  ('CAH10-01-08', '10003645', 19, false, 71),
  ('CAH10-01-08', '10007799', 20, false, 71),
  ('CAH10-01-08', '10007147', 21, false, 71),
  ('CAH10-01-08', '10007857', 22, false, 71),
  ('CAH10-01-08', '10005553', 23, false, 71),
  ('CAH10-01-08', '10007814', 24, false, 71),
  ('CAH10-01-08', '10007160', 25, false, 71),
  ('CAH10-01-08', '10006840', 26, false, 71),
  ('CAH10-01-08', '10007775', 27, false, 71),
  ('CAH10-01-08', '10007167', 28, false, 71),
  ('CAH10-01-08', '10007764', 29, false, 71),
  ('CAH10-01-08', '10006842', 30, false, 71),
  ('CAH10-01-08', '10007759', 31, false, 71),
  ('CAH10-01-08', '10007146', 32, false, 71),
  ('CAH10-01-08', '10007807', 33, false, 71),
  ('CAH10-01-08', '10001282', 34, false, 71),
  ('CAH10-01-08', '10007155', 35, false, 71),
  ('CAH10-01-08', '10007855', 36, false, 71),
  ('CAH10-01-08', '10007156', 37, false, 71),
  ('CAH10-01-08', '10005500', 38, false, 71),
  ('CAH10-01-08', '10001478', 39, false, 71),
  ('CAH10-01-08', '10007161', 40, false, 71),
  ('CAH10-01-08', '10007783', 41, false, 71),
  ('CAH10-01-08', '10000886', 42, false, 71),
  ('CAH10-01-08', '10004180', 43, false, 71),
  ('CAH10-01-08', '10007164', 44, false, 71),
  ('CAH10-01-08', '10007762', 45, false, 71),
  ('CAH10-01-08', '10000961', 46, false, 71),
  ('CAH10-01-08', '10007150', 47, false, 71),
  ('CAH10-01-08', '10007791', 48, false, 71),
  ('CAH10-01-08', '10007151', 49, false, 71),
  ('CAH10-01-08', '10004078', 50, false, 71),
  ('CAH10-01-08', '10005790', 51, false, 71),
  ('CAH10-01-08', '10007148', 52, false, 71),
  ('CAH10-01-08', '10003957', 53, false, 71),
  ('CAH10-01-08', '10007851', 54, false, 71),
  ('CAH10-01-08', '10007793', 55, false, 71),
  ('CAH10-01-08', '10007141', 56, false, 71),
  ('CAH10-01-08', '10007140', 57, false, 71),
  ('CAH10-01-08', '10001883', 58, false, 71),
  ('CAH10-01-08', '10004797', 59, false, 71),
  ('CAH10-01-08', '10001726', 60, false, 71),
  ('CAH10-01-08', '10007772', 61, false, 71),
  ('CAH10-01-08', '10003861', 62, false, 71),
  ('CAH10-01-08', '10007165', 63, false, 71),
  ('CAH10-01-08', '10004351', 64, false, 71),
  ('CAH10-01-08', '10007137', 65, false, 71),
  ('CAH10-01-08', '10006841', 66, false, 71),
  ('CAH10-01-08', '10007159', 67, false, 71),
  ('CAH10-01-08', '10006566', 68, false, 71),
  ('CAH10-01-08', '10004048', 69, false, 71),
  ('CAH10-01-08', '10006022', 70, false, 71),
  ('CAH10-01-08', '10007854', 71, false, 71),
  ('CAH10-01-04', '10003270', 1, false, 33),
  ('CAH10-01-04', '10007158', 2, false, 33),
  ('CAH10-01-04', '10007786', 3, false, 33),
  ('CAH10-01-04', '10007157', 4, false, 33),
  ('CAH10-01-04', '10007850', 5, false, 33),
  ('CAH10-01-04', '10007154', 6, false, 33),
  ('CAH10-01-04', '10007798', 7, false, 33),
  ('CAH10-01-04', '10005343', 8, false, 33),
  ('CAH10-01-04', '10007794', 9, false, 33),
  ('CAH10-01-04', '10007160', 10, false, 33),
  ('CAH10-01-04', '10007795', 11, false, 33),
  ('CAH10-01-04', '10006840', 12, false, 33),
  ('CAH10-01-04', '10004113', 13, false, 33),
  ('CAH10-01-04', '10006842', 14, false, 33),
  ('CAH10-01-04', '10007775', 15, false, 33),
  ('CAH10-01-04', '10007855', 16, false, 33),
  ('CAH10-01-04', '10007796', 17, false, 33),
  ('CAH10-01-04', '10000961', 18, false, 33),
  ('CAH10-01-04', '10005790', 19, false, 33),
  ('CAH10-01-04', '10007164', 20, false, 33),
  ('CAH10-01-04', '10007156', 21, false, 33),
  ('CAH10-01-04', '10001726', 22, false, 33),
  ('CAH10-01-04', '10006299', 23, false, 33),
  ('CAH10-01-04', '10007141', 24, false, 33),
  ('CAH10-01-04', '10007793', 25, false, 33),
  ('CAH10-01-04', '10003678', 26, false, 33),
  ('CAH10-01-04', '10007147', 27, false, 33),
  ('CAH10-01-04', '10001478', 28, false, 33),
  ('CAH10-01-04', '10007166', 29, false, 33),
  ('CAH10-01-04', '10007161', 30, false, 33),
  ('CAH10-01-04', '10000886', 31, false, 33),
  ('CAH10-01-04', '10007800', 32, false, 33),
  ('CAH10-01-04', '10001883', 33, false, 33),
  ('CAH10-01-02', '10003270', 1, false, 74),
  ('CAH10-01-02', '10007788', 2, false, 74),
  ('CAH10-01-02', '10007774', 3, false, 74),
  ('CAH10-01-02', '10007157', 4, false, 74),
  ('CAH10-01-02', '10007850', 5, false, 74),
  ('CAH10-01-02', '10007786', 6, false, 74),
  ('CAH10-01-02', '10007784', 7, false, 74),
  ('CAH10-01-02', '10007795', 8, false, 74),
  ('CAH10-01-02', '10007798', 9, false, 74),
  ('CAH10-01-02', '10004113', 10, false, 74),
  ('CAH10-01-02', '10007790', 11, false, 74),
  ('CAH10-01-02', '10006840', 12, false, 74),
  ('CAH10-01-02', '10005343', 13, false, 74),
  ('CAH10-01-02', '10007158', 14, false, 74),
  ('CAH10-01-02', '10007154', 15, false, 74),
  ('CAH10-01-02', '10007794', 16, false, 74),
  ('CAH10-01-02', '10007805', 17, false, 74),
  ('CAH10-01-02', '10007796', 18, false, 74),
  ('CAH10-01-02', '10007764', 19, false, 74),
  ('CAH10-01-02', '10007160', 20, false, 74),
  ('CAH10-01-02', '10007792', 21, false, 74),
  ('CAH10-01-02', '10006842', 22, false, 74),
  ('CAH10-01-02', '10007768', 23, false, 74),
  ('CAH10-01-02', '10007814', 24, false, 74),
  ('CAH10-01-02', '10007783', 25, false, 74),
  ('CAH10-01-02', '10007775', 26, false, 74),
  ('CAH10-01-02', '10007799', 27, false, 74),
  ('CAH10-01-02', '10007852', 28, false, 74),
  ('CAH10-01-02', '10007855', 29, false, 74),
  ('CAH10-01-02', '10007807', 30, false, 74),
  ('CAH10-01-02', '10006299', 31, false, 74),
  ('CAH10-01-02', '10007759', 32, false, 74),
  ('CAH10-01-02', '10007806', 33, false, 74),
  ('CAH10-01-02', '10007164', 34, false, 74),
  ('CAH10-01-02', '10001282', 35, false, 74),
  ('CAH10-01-02', '10007801', 36, false, 74),
  ('CAH10-01-02', '10004797', 37, false, 74),
  ('CAH10-01-02', '10000886', 38, false, 74),
  ('CAH10-01-02', '10005500', 39, false, 74),
  ('CAH10-01-02', '10007147', 40, false, 74),
  ('CAH10-01-02', '10004078', 41, false, 74),
  ('CAH10-01-02', '10007785', 42, false, 74),
  ('CAH10-01-02', '10007151', 43, false, 74),
  ('CAH10-01-02', '10005790', 44, false, 74),
  ('CAH10-01-02', '10004930', 45, false, 74),
  ('CAH10-01-02', '10000961', 46, false, 74),
  ('CAH10-01-02', '10007159', 47, false, 74),
  ('CAH10-01-02', '10007155', 48, false, 74),
  ('CAH10-01-02', '10004180', 49, false, 74),
  ('CAH10-01-02', '10003957', 50, false, 74),
  ('CAH10-01-02', '10007149', 51, false, 74),
  ('CAH10-01-02', '10000824', 52, false, 74),
  ('CAH10-01-02', '10007762', 53, false, 74),
  ('CAH10-01-02', '10007148', 54, false, 74),
  ('CAH10-01-02', '10001726', 55, false, 74),
  ('CAH10-01-02', '10001478', 56, false, 74),
  ('CAH10-01-02', '10007137', 57, false, 74),
  ('CAH10-01-02', '10007800', 58, false, 74),
  ('CAH10-01-02', '10007772', 59, false, 74),
  ('CAH10-01-02', '10007144', 60, false, 74),
  ('CAH10-01-02', '10007166', 61, false, 74),
  ('CAH10-01-02', '10007851', 62, false, 74),
  ('CAH10-01-02', '10007156', 63, false, 74),
  ('CAH10-01-02', '10007150', 64, false, 74),
  ('CAH10-01-02', '10007161', 65, false, 74),
  ('CAH10-01-02', '10007146', 66, false, 74),
  ('CAH10-01-02', '10007141', 67, false, 74),
  ('CAH10-01-02', '10001883', 68, false, 74),
  ('CAH10-01-02', '10000291', 69, false, 74),
  ('CAH10-01-02', '10007140', 70, false, 74),
  ('CAH10-01-02', '10003678', 71, false, 74),
  ('CAH10-01-02', '10006022', 72, false, 74),
  ('CAH10-01-02', '10001143', 73, false, 74),
  ('CAH10-01-02', '10006841', 74, false, 74),
  (null, '10007788', 1, false, 130),
  (null, '10007774', 2, false, 130),
  (null, '10004063', 3, false, 130),
  (null, '10007803', 4, false, 130),
  (null, '10003270', 5, false, 130),
  (null, '10007143', 6, false, 130),
  (null, '10007163', 7, false, 130),
  (null, '10004113', 8, false, 130),
  (null, '10007850', 9, false, 130),
  (null, '10007768', 10, false, 130),
  (null, '10007792', 11, false, 130),
  (null, '10006840', 12, false, 130),
  (null, '10007157', 13, true, 130),
  (null, '10007784', 13, true, 130),
  (null, '10007158', 15, false, 130),
  (null, '10003645', 16, false, 130),
  (null, '10007786', 17, false, 130),
  (null, '10007795', 18, false, 130),
  (null, '10007790', 19, false, 130),
  (null, '10007167', 20, false, 130),
  (null, '10007160', 21, false, 130),
  (null, '10006842', 22, false, 130),
  (null, '10005343', 23, false, 130),
  (null, '10007798', 24, false, 130),
  (null, '10007852', 25, false, 130),
  (null, '10007154', 26, false, 130),
  (null, '10007814', 27, true, 130),
  (null, '10007162', 27, true, 130),
  (null, '10007794', 29, false, 130),
  (null, '10007791', 30, false, 130),
  (null, '10007764', 31, false, 130),
  (null, '10007783', 32, false, 130),
  (null, '10007796', 33, false, 130),
  (null, '10007789', 34, false, 130),
  (null, '10007799', 35, false, 130),
  (null, '10007806', 36, false, 130),
  (null, '10001282', 37, false, 130),
  (null, '10040812', 38, false, 130),
  (null, '10007805', 39, false, 130),
  (null, '10007775', 40, false, 130),
  (null, '10007855', 41, false, 130),
  (null, '10005553', 42, false, 130),
  (null, '10007802', 43, false, 130),
  (null, '10014001', 44, false, 130),
  (null, '10004930', 45, false, 130),
  (null, '10004797', 46, false, 130),
  (null, '10007807', 47, false, 130),
  (null, '10000961', 48, false, 130),
  (null, '10007857', 49, false, 130),
  (null, '10007151', 50, true, 130),
  (null, '10007155', 50, true, 130),
  (null, '10007759', 52, false, 130),
  (null, '10004180', 53, false, 130),
  (null, '10007767', 54, false, 130),
  (null, '10007804', 55, false, 130),
  (null, '10007856', 56, false, 130),
  (null, '10001726', 57, false, 130),
  (null, '10007823', 58, false, 130),
  (null, '10001478', 59, false, 130),
  (null, '10004775', 60, false, 130),
  (null, '10002718', 61, false, 130),
  (null, '10007150', 62, false, 130),
  (null, '10007137', 63, false, 130),
  (null, '10007149', 64, false, 130),
  (null, '10008640', 65, false, 130),
  (null, '10007156', 66, false, 130),
  (null, '10007801', 67, false, 130),
  (null, '10007148', 68, true, 130),
  (null, '10007159', 68, true, 130),
  (null, '10007147', 70, false, 130),
  (null, '10007851', 71, false, 130),
  (null, '10007854', 72, true, 130),
  (null, '10000385', 72, true, 130),
  (null, '10007164', 74, false, 130),
  (null, '10005500', 75, false, 130),
  (null, '10003957', 76, false, 130),
  (null, '10000824', 77, false, 130),
  (null, '10007848', 78, false, 130),
  (null, '10007843', 79, false, 130),
  (null, '10007139', 80, false, 130),
  (null, '10005790', 81, true, 130),
  (null, '10007772', 81, true, 130),
  (null, '10003956', 83, false, 130),
  (null, '10006566', 84, false, 130),
  (null, '10006427', 85, false, 130),
  (null, '10003861', 86, false, 130),
  (null, '10007161', 87, false, 130),
  (null, '10003678', 88, false, 130),
  (null, '10007762', 89, false, 130),
  (null, '10007141', 90, false, 130),
  (null, '10007793', 91, false, 130),
  (null, '10000571', 92, true, 130),
  (null, '10001143', 92, true, 130),
  (null, '10007140', 95, false, 130),
  (null, '10007144', 96, false, 130),
  (null, '10003614', 97, false, 130),
  (null, '10007145', 98, true, 130),
  (null, '10007785', 98, true, 130),
  (null, '10007858', 98, true, 130),
  (null, '10007166', 101, false, 130),
  (null, '10007146', 102, true, 130),
  (null, '10000886', 104, false, 130),
  (null, '10007849', 105, false, 130),
  (null, '10007152', 106, false, 130),
  (null, '10003854', 107, false, 130),
  (null, '10007713', 108, false, 130),
  (null, '10001883', 110, false, 130),
  (null, '10006299', 111, false, 130),
  (null, '10004078', 112, false, 130),
  (null, '10000291', 113, false, 130),
  (null, '10007165', 115, true, 130),
  (null, '10006022', 115, true, 130),
  (null, '10007842', 117, false, 130),
  (null, '10006841', 118, false, 130),
  (null, '10005127', 119, false, 130),
  (null, '10000975', 120, false, 130),
  (null, '10007138', 121, false, 130),
  (null, '10004351', 122, false, 130),
  (null, '10007776', 123, false, 130),
  (null, '10007787', 124, false, 130),
  (null, '10003863', 125, true, 130),
  (null, '10007832', 127, false, 130),
  (null, '10007800', 128, false, 130),
  (null, '10004048', 129, false, 130),
  (null, '10007833', 130, false, 130)
) as v (cah_code, ukprn, position, tied, table_size)
join public.universities u on u.ukprn = v.ukprn;

create or replace function public.cug_positions(p_university uuid, p_subjects text[])
returns table (
  edition smallint, subject_label text, subject_url text, subject_position smallint, subject_tied boolean,
  subject_of smallint, overall_position smallint, overall_tied boolean, overall_of smallint, overall_url text
)
language sql
stable
security invoker
set search_path = public
as $$
  with s as (
    select l.edition, x.label, x.league_table_url, l.position, l.tied, l.table_size
    from unnest(p_subjects) with ordinality as sc (code, ord)
    join league_table_positions l on l.cah_code = sc.code and l.university_id = p_university
    join cah_subjects x on x.code = l.cah_code
    order by l.edition desc, sc.ord
    limit 1
  ), o as (
    select l.edition, l.position, l.tied, l.table_size from league_table_positions l
    where l.cah_code is null and l.university_id = p_university
    order by l.edition desc limit 1
  )
  select coalesce(s.edition, o.edition), s.label, s.league_table_url, s.position, s.tied, s.table_size,
         o.position, o.tied, o.table_size,
         'https://www.thecompleteuniversityguide.co.uk/league-tables/rankings'
  from (select 1) one left join s on true left join o on true
  where s.position is not null or o.position is not null;
$$;
grant execute on function public.cug_positions(uuid, text[]) to anon, authenticated;

drop function public.search_uni_courses(jsonb);
drop function public.uni_course_detail(uuid);

create or replace function public.search_uni_courses(p jsonb)
returns table (
  id uuid, title text, qualification text, subject_group public.course_subject_group,
  university_id uuid, university text, on_dfe_tlevel_list boolean, nation public.uk_nation,
  location_name text, distance_km double precision,
  tlevel_status public.tlevel_status, tlevel_requirement text, course_url text,
  foundation_year boolean, sandwich_year boolean, tlevel_scope public.tlevel_scope, russell_group boolean,
  tef_overall text, overall_rank smallint, overall_rank_of smallint, overall_rank_tied boolean,
  subject_label text, subject_rank smallint, subject_rank_of smallint, subject_rank_tied boolean,
  cug_subject_label text, cug_subject_position smallint, cug_subject_tied boolean, cug_subject_of smallint,
  cug_overall_position smallint, cug_overall_tied boolean, cug_overall_of smallint,
  total bigint
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with args as (
    select nullif(trim(p ->> 'q'), '') as q,
           coalesce((select array_agg(x::public.tlevel_status) from jsonb_array_elements_text(p -> 'status') x
                     where x in ('accepted', 'accepted_with_maths', 'case_by_case', 'not_accepted', 'unknown')), '{}') as statuses,
           case when p ->> 'group' in ('engineering', 'computing', 'physics', 'maths', 'built_environment', 'other')
                then (p ->> 'group')::public.course_subject_group end as grp,
           case when p ->> 'nation' in ('england', 'scotland', 'wales', 'northern_ireland')
                then (p ->> 'nation')::public.uk_nation end as nation,
           coalesce((p ->> 'dfe_list')::boolean, false) as dfe_only,
           coalesce((p ->> 'russell')::boolean, false) as russell_only,
           case when p ->> 'foundation' in ('yes', 'no') then p ->> 'foundation' end as fy,
           coalesce(p ->> 'sort', '') = 'rank' as by_rank,
           coalesce(p ->> 'sort', '') = 'cug' as by_cug,
           case when p ? 'lat' and p ? 'lng'
                then st_setsrid(st_makepoint((p ->> 'lng')::float8, (p ->> 'lat')::float8), 4326)::geography end as origin,
           least(greatest(coalesce((p ->> 'km')::float8, 0), 0), 1000) as km,
           least(greatest(coalesce((p ->> 'limit')::int, 20), 1), 50) as lim,
           least(greatest(coalesce((p ->> 'page')::int, 1), 1), 100) as page
  ), hits as (
    select c.*, u.name as uni_name, u.on_dfe_tlevel_list, u.nation as uni_nation, u.russell_group,
           u.tef_overall, u.overall_rank, u.overall_rank_of, u.overall_rank_tied, s.label as subject_label,
           gs.label as cug_subject_label, gs.position as cug_subject_position, gs.tied as cug_subject_tied,
           gs.table_size as cug_subject_of, go.position as cug_overall_position, go.tied as cug_overall_tied,
           go.table_size as cug_overall_of,
           case when a.origin is not null and c.location is not null
                then st_distance(c.location, a.origin) / 1000.0 end as dist
    from public.uni_courses c
    join public.universities u on u.id = c.university_id
    left join public.cah_subjects s on s.code = c.rank_subject
    -- Complete University Guide: the first of the course's subjects with a table, and the overall table.
    left join lateral (
      select x.label, l.position, l.tied, l.table_size
      from unnest(c.subject_codes) with ordinality as sc (code, ord)
      join public.league_table_positions l on l.cah_code = sc.code and l.university_id = c.university_id
      join public.cah_subjects x on x.code = l.cah_code
      order by l.edition desc, sc.ord
      limit 1
    ) gs on true
    left join lateral (
      select l.position, l.tied, l.table_size from public.league_table_positions l
      where l.cah_code is null and l.university_id = c.university_id
      order by l.edition desc limit 1
    ) go on true
    cross join args a
    where (a.q is null or c.search @@ websearch_to_tsquery('english', a.q) or u.name ilike '%' || a.q || '%')
      and (cardinality(a.statuses) = 0 or c.tlevel_status = any (a.statuses))
      and (a.grp is null or c.subject_group = a.grp)
      and (a.nation is null or u.nation = a.nation)
      and (not a.dfe_only or u.on_dfe_tlevel_list)
      and (not a.russell_only or u.russell_group)
      and (a.fy is null
           or (a.fy = 'yes' and (c.foundation_year or c.title ~* 'foundation\s+year|with\s+(an?\s+)?(integrated\s+)?foundation'))
           or (a.fy = 'no' and coalesce(c.foundation_year, false) = false and c.title !~* 'foundation'))
      and (a.origin is null or a.km = 0 or (c.location is not null and st_dwithin(c.location, a.origin, a.km * 1000)))
  )
  select h.id, h.title, h.qualification, h.subject_group, h.university_id, h.uni_name, h.on_dfe_tlevel_list,
         h.uni_nation, h.location_name, h.dist, h.tlevel_status, h.tlevel_requirement, h.course_url,
         h.foundation_year, h.sandwich_year, h.tlevel_scope, h.russell_group,
         h.tef_overall, h.overall_rank, h.overall_rank_of, h.overall_rank_tied,
         h.subject_label, h.subject_rank, h.subject_rank_of, h.subject_rank_tied,
         h.cug_subject_label, h.cug_subject_position, h.cug_subject_tied, h.cug_subject_of,
         h.cug_overall_position, h.cug_overall_tied, h.cug_overall_of, count(*) over ()
  from hits h, args a
  order by
    -- Best ranked: position within the subject as a share of the field, then overall.
    case when a.by_rank then h.subject_rank::float8 / nullif(h.subject_rank_of, 0) end nulls last,
    case when a.by_cug then h.cug_subject_position end nulls last,
    case when a.by_cug then h.cug_overall_position end nulls last,
    case when a.by_rank then h.overall_rank::float8 / nullif(h.overall_rank_of, 0) end nulls last,
    case h.tlevel_status when 'accepted' then 0 when 'accepted_with_maths' then 1 when 'case_by_case' then 2
                         when 'unknown' then 3 else 4 end,
    h.dist nulls last, h.uni_name collate "C", h.title collate "C"
  limit (select lim from args) offset (select (page - 1) * lim from args);
$$;


create or replace function public.uni_course_detail(p_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'id', c.id, 'title', c.title, 'qualification', c.qualification, 'subject_group', c.subject_group,
    'ucas_codes', c.ucas_codes, 'course_url', c.course_url,
    'foundation_year', c.foundation_year, 'sandwich_year', c.sandwich_year,
    'location_name', c.location_name,
    'lat', st_y(c.location::geometry), 'lng', st_x(c.location::geometry),
    'entry_alevel_pct', c.entry_alevel_pct, 'entry_other_pct', c.entry_other_pct,
    'tlevel_status', c.tlevel_status, 'tlevel_requirement', c.tlevel_requirement,
    'tlevel_quote', c.tlevel_quote, 'tlevel_quote_url', c.tlevel_quote_url,
    'tlevel_assessed_by', c.tlevel_assessed_by, 'tlevel_assessed_at', c.tlevel_assessed_at, 'tlevel_scope', c.tlevel_scope,
    'alevel_requirement', c.alevel_requirement,
    'subject_label', s.label, 'subject_league_table_url', s.league_table_url,
    'cug', (select to_jsonb(g) from public.cug_positions(c.university_id, c.subject_codes) g),
    'subject_rank', c.subject_rank, 'subject_rank_of', c.subject_rank_of,
    'subject_rank_tied', c.subject_rank_tied,
    'satisfaction_pct', c.satisfaction_pct, 'continuation_pct', c.continuation_pct,
    'work_study_pct', c.work_study_pct, 'median_salary', c.median_salary,
    'source_url', c.source_url, 'fetched_at', c.fetched_at,
    'university', jsonb_build_object(
      'id', u.id, 'name', u.name, 'nation', u.nation, 'website', u.website, 'russell_group', u.russell_group,
      'on_dfe_tlevel_list', u.on_dfe_tlevel_list, 'dfe_list_url', u.dfe_list_url,
      'dfe_list_checked_on', u.dfe_list_checked_on,
      'tlevel_policy_status', u.tlevel_policy_status, 'tlevel_policy_quote', u.tlevel_policy_quote,
      'tlevel_policy_url', u.tlevel_policy_url, 'tlevel_policy_checked_at', u.tlevel_policy_checked_at,
      'tef_overall', u.tef_overall, 'tef_experience', u.tef_experience, 'tef_outcomes', u.tef_outcomes,
      'tef_url', u.tef_url, 'overall_rank', u.overall_rank, 'overall_rank_of', u.overall_rank_of,
      'overall_rank_tied', u.overall_rank_tied, 'rankings_on', u.rankings_on)
  )
  from public.uni_courses c
  join public.universities u on u.id = c.university_id
  left join public.cah_subjects s on s.code = c.rank_subject
  where c.id = p_id;
$$;


grant execute on function public.search_uni_courses(jsonb), public.uni_course_detail(uuid) to anon, authenticated;

create or replace function public.liked_items()
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'size_band', c.size_band, 'data_source', c.data_source,
        'county', (select s.county from company_sites s where s.company_id = c.id and s.county is not null order by s.kind desc limit 1),
        'liked_at', r.created_at,
        'shortlisted', exists (select 1 from tracker_items t where t.company_id = c.id and t.user_id = r.user_id)
      ) order by r.created_at desc)
      from reactions r join companies c on c.id = r.item_id and c.status = 'active'
      where r.user_id = (select auth.uid()) and r.item_type = 'company' and r.reaction = 'like'
    ), '[]'::jsonb),
    'courses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', k.id, 'title', k.title, 'qualification', k.qualification, 'university', u.name,
        'tlevel_status', k.tlevel_status, 'tlevel_requirement', k.tlevel_requirement, 'course_url', k.course_url,
        'subject_label', (select x.label from cah_subjects x where x.code = k.rank_subject),
        'subject_rank', k.subject_rank, 'subject_rank_of', k.subject_rank_of, 'subject_rank_tied', k.subject_rank_tied,
        'overall_rank', u.overall_rank, 'overall_rank_of', u.overall_rank_of, 'overall_rank_tied', u.overall_rank_tied,
        'tef_overall', u.tef_overall,
        'cug', (select to_jsonb(g) from public.cug_positions(k.university_id, k.subject_codes) g),
        'liked_at', r.created_at,
        'shortlisted', exists (select 1 from course_shortlist s where s.course_id = k.id and s.user_id = r.user_id)
      ) order by r.created_at desc)
      from reactions r join uni_courses k on k.id = r.item_id join universities u on u.id = k.university_id
      where r.user_id = (select auth.uid()) and r.item_type = 'course' and r.reaction = 'like'
    ), '[]'::jsonb),
    'vacancies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'title', v.title, 'employer', coalesce(v.employer_name, c.name), 'company_id', v.company_id,
        'closing_date', v.closing_date, 'url', v.url, 'wage_text', v.wage_text, 'course_level', v.course_level,
        'liked_at', r.created_at,
        'shortlisted', exists (select 1 from tracker_items t where t.company_id = v.company_id and t.user_id = r.user_id)
      ) order by r.created_at desc)
      from reactions r join vacancies v on v.id = r.item_id join companies c on c.id = v.company_id and c.status = 'active'
      where r.user_id = (select auth.uid()) and r.item_type = 'vacancy' and r.reaction = 'like'
    ), '[]'::jsonb)
  );
$$;

