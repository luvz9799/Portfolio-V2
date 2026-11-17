-- Learner dashboard: a learner's own test history. Run once in Supabase → SQL Editor.
-- Returns scores only; the per-question detail (with correct answers) stays admin-only.

create function my_attempts()
returns table (id uuid, course_id uuid, module_id uuid, chapter text, score int, total int,
               pct numeric, passed boolean, submitted_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, m.course_id, a.module_id, m.title, a.score, a.total, a.pct, a.passed, a.submitted_at
  from attempts a
  join modules m on m.id = a.module_id
  where a.user_id = auth.uid() and a.submitted_at is not null
  order by a.submitted_at desc
$$;
