-- Question types (single / multi / written) + practical tasks.
-- Run once in Supabase → SQL Editor, after schema.sql, sheet-sync.sql and learner-dashboard.sql.

-- ---------- question types ----------
-- single: options + correct (0-based)   multi: options + accepted [0,2]   text: accepted ["answer", "alternative"]
alter table questions add column kind text not null default 'single' check (kind in ('single', 'multi', 'text'));
alter table questions add column accepted jsonb;
alter table questions alter column correct drop not null;
alter table questions drop constraint questions_options_check;
alter table questions drop constraint questions_check;
-- coalesce: a CHECK that evaluates to NULL passes, so a missing answer key must count as false
alter table questions add constraint questions_shape check (coalesce(
  case kind
    when 'single' then jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6
                       and correct is not null and correct >= 0 and correct < jsonb_array_length(options)
    when 'multi' then jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6
                      and jsonb_typeof(accepted) = 'array' and jsonb_array_length(accepted) between 1 and jsonb_array_length(options)
    else jsonb_typeof(accepted) = 'array' and jsonb_array_length(accepted) >= 1
  end, false));

-- ---------- practical tasks (one per chapter, auto-approved on submit) ----------
create table tasks (
  module_id uuid primary key references modules on delete cascade,
  instructions text not null,
  submit_type text not null default 'text' check (submit_type in ('text', 'link')),
  model_answer text,                                   -- shown to the learner after they submit
  updated_at timestamptz not null default now()
);

-- module_id has no cascade on purpose (like attempts): submissions are training history
create table task_submissions (
  module_id uuid not null references modules,
  user_id uuid not null references profiles on delete cascade,
  answer text not null check (length(answer) between 1 and 5000),
  submitted_at timestamptz not null default now(),
  primary key (module_id, user_id)
);

alter table tasks enable row level security;
alter table task_submissions enable row level security;
create policy admin_all on tasks for all using (is_admin()) with check (is_admin());
create policy admin_all on task_submissions for all using (is_admin()) with check (is_admin());

-- A chapter is complete when its test is passed (if it has questions) and its task is submitted (if it has one).
create function module_done(p_module uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (not exists (select 1 from questions where module_id = p_module)
          or exists (select 1 from attempts where module_id = p_module and user_id = p_user and passed))
     and (not exists (select 1 from tasks where module_id = p_module)
          or exists (select 1 from task_submissions where module_id = p_module and user_id = p_user))
     and (exists (select 1 from questions where module_id = p_module)
          or exists (select 1 from tasks where module_id = p_module))
$$;

create or replace function module_unlocked(p_module uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from modules m
    join courses c on c.id = m.course_id and c.published
    join enrollments e on e.course_id = m.course_id and e.user_id = auth.uid()
    join profiles p on p.id = auth.uid() and p.status <> 'inactive'
    where m.id = p_module and m.published
      and not exists (
        select 1 from modules prev
        where prev.course_id = m.course_id and prev.published
          and (prev.seq, prev.id) < (m.seq, m.id)
          and not module_done(prev.id, auth.uid())
      )
  )
$$;

drop function my_modules(uuid);
create function my_modules(p_course uuid)
returns table (id uuid, seq int, title text, description text, videos text, pass_pct int,
               state text, best_pct numeric, attempt_count bigint,
               has_test boolean, has_task boolean, task_done boolean)
language sql stable security definer set search_path = public as $$
  select m.id, m.seq, m.title, m.description,
         case when u.ok then m.videos end,
         m.pass_pct,
         case when module_done(m.id, auth.uid()) then 'passed' when u.ok then 'available' else 'locked' end,
         s.best, s.n,
         exists (select 1 from questions q where q.module_id = m.id),
         exists (select 1 from tasks t where t.module_id = m.id),
         exists (select 1 from task_submissions ts where ts.module_id = m.id and ts.user_id = auth.uid())
  from modules m
  join enrollments e on e.course_id = m.course_id and e.user_id = auth.uid()
  cross join lateral (select module_unlocked(m.id) as ok) u
  cross join lateral (
    select max(a.pct) as best, count(*) filter (where a.submitted_at is not null) as n
    from attempts a where a.module_id = m.id and a.user_id = auth.uid()
  ) s
  where m.course_id = p_course and m.published
  order by m.seq, m.id
$$;

create or replace function start_attempt(p_module uuid) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_ids uuid[];
  v_prev uuid[];
  v_n int;
begin
  if not module_unlocked(p_module) then raise exception 'Module locked'; end if;

  select id, question_ids into v_id, v_ids from attempts
  where user_id = auth.uid() and module_id = p_module and submitted_at is null
  order by started_at desc limit 1;

  if v_id is null then
    select question_ids into v_prev from attempts
    where user_id = auth.uid() and module_id = p_module and submitted_at is not null
    order by submitted_at desc limit 1;
    select questions_per_test into v_n from modules where id = p_module;
    select array_agg(q.id) into v_ids from (
      select id from questions where module_id = p_module
      order by (id = any(coalesce(v_prev, '{}'))), random() limit v_n
    ) q;
    if v_ids is null then raise exception 'This chapter has no questions yet'; end if;
    insert into attempts (user_id, module_id, question_ids)
    values (auth.uid(), p_module, v_ids) returning id into v_id;
  end if;

  -- kind + options only: correct / accepted never leave the database
  return json_build_object(
    'attempt_id', v_id,
    'questions', (select json_agg(json_build_object('id', q.id, 'kind', q.kind, 'text', q.text, 'options', q.options)
                                  order by array_position(v_ids, q.id))
                  from questions q where q.id = any(v_ids)));
end $$;

-- p_answers: {"<question_id>": 2 | [0, 2] | "written answer"}
create or replace function submit_attempt(p_attempt uuid, p_answers jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare
  a attempts;
  v_detail jsonb;
  v_score int;
  v_total int;
  v_pass int;
  v_pct numeric;
begin
  select * into a from attempts
  where id = p_attempt and user_id = auth.uid() and submitted_at is null for update;
  if not found then raise exception 'Attempt not found or already submitted'; end if;
  if not module_unlocked(a.module_id) then raise exception 'Module locked'; end if;

  select jsonb_agg(jsonb_build_object('question', q.text, 'kind', q.kind, 'options', q.options, 'correct', q.correct,
                                      'accepted', q.accepted, 'chosen', p_answers -> q.id::text, 'ok', r.ok)
                   order by array_position(a.question_ids, q.id)),
         count(*) filter (where r.ok),
         count(*)
    into v_detail, v_score, v_total
  from questions q
  cross join lateral (select (case q.kind
      when 'single' then (p_answers ->> q.id::text) = q.correct::text
      when 'multi' then case when jsonb_typeof(p_answers -> q.id::text) = 'array'
        then (select jsonb_agg(v order by v) from jsonb_array_elements(p_answers -> q.id::text) v)
           = (select jsonb_agg(v order by v) from jsonb_array_elements(q.accepted) v)
        else false end
      -- written: case- and spacing-insensitive match against any accepted answer
      else exists (select 1 from jsonb_array_elements_text(q.accepted) x
                   where lower(regexp_replace(trim(x), '\s+', ' ', 'g'))
                       = lower(regexp_replace(trim(p_answers ->> q.id::text), '\s+', ' ', 'g')))
    end) is true as ok) r
  where q.id = any(a.question_ids);

  select pass_pct into v_pass from modules where id = a.module_id;
  v_pct := round(100.0 * v_score / greatest(v_total, 1), 2);

  update attempts set detail = v_detail, score = v_score, total = v_total, pct = v_pct,
                      passed = v_pct >= v_pass, submitted_at = now()
  where id = p_attempt;

  return json_build_object('score', v_score, 'total', v_total, 'pct', v_pct,
                           'passed', v_pct >= v_pass, 'pass_pct', v_pass);
end $$;

-- The learner's task for a chapter. The model answer is revealed only after they submit.
create function my_task(p_module uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  t tasks;
  s task_submissions;
begin
  if not module_unlocked(p_module) then raise exception 'Module locked'; end if;
  select * into t from tasks where module_id = p_module;
  if not found then return null; end if;
  select * into s from task_submissions where module_id = p_module and user_id = auth.uid();
  return json_build_object('instructions', t.instructions, 'submit_type', t.submit_type,
                           'answer', s.answer, 'submitted_at', s.submitted_at,
                           'model_answer', case when s.submitted_at is not null then t.model_answer end);
end $$;

-- Submitting = approved. Re-submitting replaces the previous answer.
create function submit_task(p_module uuid, p_answer text) returns json
language plpgsql security definer set search_path = public as $$
declare
  t tasks;
  v text := trim(p_answer);
begin
  if not module_unlocked(p_module) then raise exception 'Module locked'; end if;
  select * into t from tasks where module_id = p_module;
  if not found then raise exception 'This chapter has no practical task'; end if;
  if v is null or v = '' then raise exception 'Please write your answer first'; end if;
  if t.submit_type = 'link' and v !~* '^https?://\S+$' then raise exception 'Please paste a valid link starting with https://'; end if;
  insert into task_submissions (module_id, user_id, answer) values (p_module, auth.uid(), v)
  on conflict (module_id, user_id) do update set answer = excluded.answer, submitted_at = now();
  return json_build_object('model_answer', t.model_answer);
end $$;

-- admin progress now counts chapters by the same completion rule
create or replace function admin_users()
returns table (id uuid, full_name text, email text, phone text, user_type text, status text,
               notes text, created_at timestamptz, courses text, modules_total bigint,
               modules_passed bigint, attempts bigint, last_activity timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email, p.phone, p.user_type, p.status, p.notes, p.created_at,
         (select string_agg(c.title, ', ') from enrollments e join courses c on c.id = e.course_id where e.user_id = p.id),
         (select count(*) from enrollments e join modules m on m.course_id = e.course_id and m.published where e.user_id = p.id),
         (select count(*) from enrollments e join modules m on m.course_id = e.course_id and m.published
          where e.user_id = p.id and module_done(m.id, p.id)),
         (select count(*) from attempts a where a.user_id = p.id and a.submitted_at is not null),
         (select max(coalesce(a.submitted_at, a.started_at)) from attempts a where a.user_id = p.id)
  from profiles p
  where is_admin()
  order by p.created_at desc
$$;

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
             (select count(*) from enrollments e join modules m on m.course_id = e.course_id and m.published
              where e.user_id = p.id and module_done(m.id, p.id)) as chapters_passed,
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
      where a.submitted_at is not null) r),
    'tasks', (select coalesce(json_agg(r order by r.submitted desc), '[]') from (
      select p.full_name as name, p.phone, c.title as training, m.seq as chapter_no, m.title as chapter,
             s.answer, s.submitted_at as submitted
      from task_submissions s
      join profiles p on p.id = s.user_id
      join modules m on m.id = s.module_id
      join courses c on c.id = m.course_id) r));
end $$;
