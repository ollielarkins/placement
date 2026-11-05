-- 0018 Shortlist and application tracker (Phase 2, step 3)
--
-- tracker_items (0001) already holds the shortlist: one row per company the
-- student saves, with its stage, follow-up date and notes; stage_changed_at
-- and contacted_at are kept by tracker_stage_change().
--
-- Changes:
-- * Writing needs a ready account (age confirmed, 0017). Reading and deleting
--   stay owner-only, so a student can always see and remove their data.
-- * At most 300 companies per student (abuse guard; a real shortlist is
--   rarely over 50).
-- * Only active companies can be added (hidden or dissolved ones can't).

drop policy "tracker: owner" on public.tracker_items;

create policy "tracker: owner read" on public.tracker_items
  for select to authenticated using (user_id = (select auth.uid()));
create policy "tracker: owner delete" on public.tracker_items
  for delete to authenticated using (user_id = (select auth.uid()));
create policy "tracker: owner add" on public.tracker_items
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.account_ready()));
create policy "tracker: owner update" on public.tracker_items
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.account_ready()));

create or replace function public.tracker_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select count(*) from public.tracker_items where user_id = new.user_id) >= 300 then
    raise exception 'shortlist is full (300 companies)' using errcode = '54000';
  end if;
  if not exists (select 1 from public.companies c where c.id = new.company_id and c.status = 'active') then
    raise exception 'company not available' using errcode = '23503';
  end if;
  return new;
end;
$$;

revoke execute on function public.tracker_insert_guard() from public, anon, authenticated;

create trigger tracker_items_insert_guard before insert on public.tracker_items
  for each row execute function public.tracker_insert_guard();
