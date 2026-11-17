-- Google Sheet: adds an "answers" list (one row per question of every submitted test)
-- and a level column to learners and attempts. Run once in Supabase → SQL Editor, after levels.sql.

create or replace function sheet_export(p_token text) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from sheet_tokens where token = p_token) then
    raise exception 'Invalid token';
  end if;
  return json_build_object(
    'learners', (select coalesce(json_agg(r order by r.registered desc), '[]') from (
      select p.full_name as name, p.phone, p.email, p.user_type as type, p.status,
             (select string_agg(c.title, ', ') from enrollments e join courses c on c.id = e.course_id where e.user_id = p.id) as training,
             (select string_agg(distinct e.level, ', ') from enrollments e where e.user_id = p.id) as level,
             (select count(*) from enrollments e join modules m on m.course_id = e.course_id and m.published
              where e.user_id = p.id and module_done(m.id, p.id)) as chapters_passed,
             (select count(*) from enrollments e join modules m on m.course_id = e.course_id and m.published where e.user_id = p.id) as chapters_total,
             (select count(*) from attempts a where a.user_id = p.id and a.submitted_at is not null) as tests_taken,
             (select max(a.submitted_at) from attempts a where a.user_id = p.id) as last_test,
             p.notes, p.created_at as registered
      from profiles p) r),
    'attempts', (select coalesce(json_agg(r order by r.submitted desc), '[]') from (
      select p.full_name as name, p.phone, c.title as training, e.level, m.seq as chapter_no, m.title as chapter,
             a.score, a.total, a.pct as percent, case when a.passed then 'PASS' else 'FAIL' end as result,
             a.submitted_at as submitted
      from attempts a
      join profiles p on p.id = a.user_id
      join modules m on m.id = a.module_id
      join courses c on c.id = m.course_id
      left join enrollments e on e.user_id = a.user_id and e.course_id = m.course_id
      where a.submitted_at is not null) r),
    -- one row per question, from the snapshot each attempt keeps (so later edits to a question don't rewrite history)
    'answers', (select coalesce(json_agg(r order by r.submitted desc, r.question_no), '[]') from (
      select p.full_name as name, p.phone, c.title as training, e.level, m.seq as chapter_no, m.title as chapter,
             d.n as question_no, d.v ->> 'question' as question,
             case coalesce(d.v ->> 'kind', 'single')
               when 'text' then d.v ->> 'chosen'
               when 'multi' then (select string_agg(d.v -> 'options' ->> x::int, ', ')
                                  from jsonb_array_elements_text(case when jsonb_typeof(d.v -> 'chosen') = 'array'
                                                                      then d.v -> 'chosen' else '[]'::jsonb end) x)
               else d.v -> 'options' ->> (d.v ->> 'chosen')::int
             end as their_answer,
             case coalesce(d.v ->> 'kind', 'single')
               when 'text' then (select string_agg(x, ' / ') from jsonb_array_elements_text(d.v -> 'accepted') x)
               when 'multi' then (select string_agg(d.v -> 'options' ->> x::int, ', ') from jsonb_array_elements_text(d.v -> 'accepted') x)
               else d.v -> 'options' ->> (d.v ->> 'correct')::int
             end as correct_answer,
             -- snapshots from before question types have no "ok": compare the picked option instead
             case when coalesce((d.v ->> 'ok')::boolean, d.v ->> 'chosen' = d.v ->> 'correct') then 'Correct' else 'Wrong' end as result,
             a.submitted_at as submitted
      from attempts a
      cross join lateral jsonb_array_elements(a.detail) with ordinality d(v, n)
      join profiles p on p.id = a.user_id
      join modules m on m.id = a.module_id
      join courses c on c.id = m.course_id
      left join enrollments e on e.user_id = a.user_id and e.course_id = m.course_id
      where a.submitted_at is not null) r),
    'tasks', (select coalesce(json_agg(r order by r.submitted desc), '[]') from (
      select p.full_name as name, p.phone, c.title as training, m.seq as chapter_no, m.title as chapter,
             s.answer, s.submitted_at as submitted
      from task_submissions s
      join profiles p on p.id = s.user_id
      join modules m on m.id = s.module_id
      join courses c on c.id = m.course_id) r));
end $$;
