-- Google Sheet sync. Run once in Supabase → SQL Editor (after schema.sql).
-- The Apps Script in google-sheet-sync.gs calls sheet_export() with a secret token,
-- so the sheet never needs the Supabase secret key.

create table sheet_tokens (
  token text primary key default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);
alter table sheet_tokens enable row level security;   -- no policies: unreadable via the API

create function sheet_export(p_token text) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from sheet_tokens where token = p_token) then
    raise exception 'Invalid token';
  end if;
  return json_build_object(
    'learners', (select coalesce(json_agg(r order by r.registered desc), '[]') from (
      select p.full_name as name, p.phone, p.email, p.user_type as type, p.status,
             (select string_agg(c.title, ', ') from enrollments e join courses c on c.id = e.course_id where e.user_id = p.id) as training,
             (select count(distinct a.module_id) from attempts a where a.user_id = p.id and a.passed) as chapters_passed,
             (select count(*) from enrollments e join modules m on m.course_id = e.course_id and m.published where e.user_id = p.id) as chapters_total,
             (select count(*) from attempts a where a.user_id = p.id and a.submitted_at is not null) as tests_taken,
             (select max(a.submitted_at) from attempts a where a.user_id = p.id) as last_test,
             p.notes, p.created_at as registered
      from profiles p) r),
    'attempts', (select coalesce(json_agg(r order by r.submitted desc), '[]') from (
      select p.full_name as name, p.phone, c.title as training, m.seq as chapter_no, m.title as chapter,
             a.score, a.total, a.pct as percent, case when a.passed then 'PASS' else 'FAIL' end as result,
             a.submitted_at as submitted
      from attempts a
      join profiles p on p.id = a.user_id
      join modules m on m.id = a.module_id
      join courses c on c.id = m.course_id
      where a.submitted_at is not null) r));
end $$;

-- Create your token (copy the value it returns into google-sheet-sync.gs):
-- insert into sheet_tokens default values returning token;
-- To revoke access later:  delete from sheet_tokens;
