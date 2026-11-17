-- Akshardham LMS — Phase 0 schema.
-- Run once in Supabase → SQL Editor. All locking and scoring lives here, so the
-- browser can never unlock a module or set its own marks.

create table courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'General',          -- position / department
  audience text not null default 'all' check (audience in ('candidate','agent','employee','all')),
  description text,
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create table modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses on delete cascade,
  seq int not null default 1,
  title text not null,
  description text,
  videos text,                                        -- YouTube links, one per line
  pass_pct int not null default 80 check (pass_pct between 1 and 100),
  questions_per_test int not null default 10 check (questions_per_test > 0),
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references modules on delete cascade,
  text text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6),
  correct int not null,                               -- 0-based index into options
  check (correct >= 0 and correct < jsonb_array_length(options)),
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  full_name text not null,
  phone text not null unique check (phone ~ '^[6-9][0-9]{9}$'),
  user_type text not null check (user_type in ('candidate','agent','employee')),
  role text not null default 'learner' check (role in ('learner','admin')),
  status text not null default 'active' check (status in ('active','shortlisted','rejected','inactive')),
  notes text,
  created_at timestamptz not null default now()
);

-- Employees don't self-register: admin adds their Gmail here, and their first
-- Google login turns the row into a profile (see claim_invite).
create table employee_invites (
  email text primary key check (email = lower(email)),
  full_name text not null,
  phone text not null check (phone ~ '^[6-9][0-9]{9}$'),
  course_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table enrollments (
  user_id uuid not null references profiles on delete cascade,
  course_id uuid not null references courses on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

-- module_id has no cascade on purpose: a module with attempts can't be deleted
-- (unpublish it instead), so test history is never lost.
create table attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  module_id uuid not null references modules,
  question_ids uuid[] not null,
  detail jsonb,                                       -- question/answer snapshot taken at submit
  score int,
  total int,
  pct numeric(5,2),
  passed boolean,
  started_at timestamptz not null default now(),
  submitted_at timestamptz
);
create index on attempts (user_id, module_id);
create index on modules (course_id, seq);
create index on questions (module_id);

-- ---------- helpers ----------

create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and status <> 'inactive')
$$;

-- The one unlock rule: enrolled, active, published, and every earlier module passed.
create function module_unlocked(p_module uuid) returns boolean
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
          and not exists (select 1 from attempts a
                          where a.module_id = prev.id and a.user_id = auth.uid() and a.passed)
      )
  )
$$;

-- ---------- learner RPCs ----------

-- Self-registration is only for new candidates and agents.
create function register(p_name text, p_phone text, p_type text, p_course uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Login required'; end if;
  if p_type not in ('candidate', 'agent') then raise exception 'Employees are added by admin'; end if;
  if not exists (select 1 from courses where id = p_course and published and audience in (p_type, 'all')) then
    raise exception 'Invalid course';
  end if;
  insert into profiles (id, email, full_name, phone, user_type)
  values (auth.uid(), auth.jwt() ->> 'email', trim(p_name), p_phone, p_type);
  insert into enrollments (user_id, course_id) values (auth.uid(), p_course);
end $$;

-- Called on first login: if admin pre-added this Gmail, create the employee profile.
create function claim_invite() returns boolean
language plpgsql security definer set search_path = public as $$
declare
  i employee_invites;
begin
  select * into i from employee_invites where email = lower(auth.jwt() ->> 'email');
  if not found or auth.uid() is null or exists (select 1 from profiles where id = auth.uid()) then
    return false;
  end if;
  insert into profiles (id, email, full_name, phone, user_type)
  values (auth.uid(), i.email, i.full_name, i.phone, 'employee');
  insert into enrollments (user_id, course_id)
  select auth.uid(), c from unnest(i.course_ids) c where exists (select 1 from courses where id = c);
  delete from employee_invites where email = i.email;
  return true;
end $$;

-- Module list for a course. Video links are returned only for unlocked modules.
create function my_modules(p_course uuid)
returns table (id uuid, seq int, title text, description text, videos text, pass_pct int,
               state text, best_pct numeric, attempt_count bigint)
language sql stable security definer set search_path = public as $$
  select m.id, m.seq, m.title, m.description,
         case when u.ok then m.videos end,
         m.pass_pct,
         case when s.passed then 'passed' when u.ok then 'available' else 'locked' end,
         s.best, s.n
  from modules m
  join enrollments e on e.course_id = m.course_id and e.user_id = auth.uid()
  cross join lateral (select module_unlocked(m.id) as ok) u
  cross join lateral (
    select coalesce(bool_or(a.passed), false) as passed, max(a.pct) as best,
           count(*) filter (where a.submitted_at is not null) as n
    from attempts a where a.module_id = m.id and a.user_id = auth.uid()
  ) s
  where m.course_id = p_course and m.published
  order by m.seq, m.id
$$;

-- Starts (or resumes) a test. Answer keys never leave the database.
create function start_attempt(p_module uuid) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_ids uuid[];
  v_prev uuid[];
  v_n int;
begin
  if not module_unlocked(p_module) then raise exception 'Module locked'; end if;

  -- resume an unsubmitted attempt so a page refresh doesn't draw a new paper
  select id, question_ids into v_id, v_ids from attempts
  where user_id = auth.uid() and module_id = p_module and submitted_at is null
  order by started_at desc limit 1;

  if v_id is null then
    select question_ids into v_prev from attempts
    where user_id = auth.uid() and module_id = p_module and submitted_at is not null
    order by submitted_at desc limit 1;
    select questions_per_test into v_n from modules where id = p_module;
    -- retry = different paper: questions from the last attempt are picked last
    select array_agg(q.id) into v_ids from (
      select id from questions where module_id = p_module
      order by (id = any(coalesce(v_prev, '{}'))), random() limit v_n
    ) q;
    if v_ids is null then raise exception 'This chapter has no questions yet'; end if;
    insert into attempts (user_id, module_id, question_ids)
    values (auth.uid(), p_module, v_ids) returning id into v_id;
  end if;

  return json_build_object(
    'attempt_id', v_id,
    'questions', (select json_agg(json_build_object('id', q.id, 'text', q.text, 'options', q.options)
                                  order by array_position(v_ids, q.id))
                  from questions q where q.id = any(v_ids)));
end $$;

-- p_answers: {"<question_id>": <0-based option index>}
create function submit_attempt(p_attempt uuid, p_answers jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare
  a attempts;
  v_detail jsonb;
  v_score int;
  v_total int;
  v_pass int;
  v_pct numeric;
begin
  -- row lock + submitted_at check = double-click / repeat submit is safe
  select * into a from attempts
  where id = p_attempt and user_id = auth.uid() and submitted_at is null for update;
  if not found then raise exception 'Attempt not found or already submitted'; end if;
  if not module_unlocked(a.module_id) then raise exception 'Module locked'; end if;

  select jsonb_agg(jsonb_build_object('question', q.text, 'options', q.options, 'correct', q.correct,
                                      'chosen', (p_answers ->> q.id::text)::int)
                   order by array_position(a.question_ids, q.id)),
         count(*) filter (where (p_answers ->> q.id::text)::int = q.correct),
         count(*)
    into v_detail, v_score, v_total
  from questions q where q.id = any(a.question_ids);

  select pass_pct into v_pass from modules where id = a.module_id;
  v_pct := round(100.0 * v_score / greatest(v_total, 1), 2);

  update attempts set detail = v_detail, score = v_score, total = v_total, pct = v_pct,
                      passed = v_pct >= v_pass, submitted_at = now()
  where id = p_attempt;

  -- learners get the score only; correct answers stay hidden so retries mean something
  return json_build_object('score', v_score, 'total', v_total, 'pct', v_pct,
                           'passed', v_pct >= v_pass, 'pass_pct', v_pass);
end $$;

-- ---------- admin RPC ----------

create function admin_users()
returns table (id uuid, full_name text, email text, phone text, user_type text, status text,
               notes text, created_at timestamptz, courses text, modules_total bigint,
               modules_passed bigint, attempts bigint, last_activity timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email, p.phone, p.user_type, p.status, p.notes, p.created_at,
         (select string_agg(c.title, ', ') from enrollments e join courses c on c.id = e.course_id where e.user_id = p.id),
         (select count(*) from enrollments e join modules m on m.course_id = e.course_id and m.published where e.user_id = p.id),
         (select count(distinct a.module_id) from attempts a where a.user_id = p.id and a.passed),
         (select count(*) from attempts a where a.user_id = p.id and a.submitted_at is not null),
         (select max(coalesce(a.submitted_at, a.started_at)) from attempts a where a.user_id = p.id)
  from profiles p
  where is_admin()
  order by p.created_at desc
$$;

-- ---------- row level security ----------

alter table courses enable row level security;
alter table modules enable row level security;
alter table questions enable row level security;
alter table profiles enable row level security;
alter table enrollments enable row level security;
alter table attempts enable row level security;
alter table employee_invites enable row level security;

create policy admin_all on employee_invites for all using (is_admin()) with check (is_admin());
create policy admin_all on courses for all using (is_admin()) with check (is_admin());
create policy admin_all on modules for all using (is_admin()) with check (is_admin());
create policy admin_all on questions for all using (is_admin()) with check (is_admin());
create policy admin_all on profiles for all using (is_admin()) with check (is_admin());
create policy admin_all on enrollments for all using (is_admin()) with check (is_admin());
create policy admin_all on attempts for all using (is_admin()) with check (is_admin());

-- Learners: read published course list and their own profile/enrollments.
-- modules, questions and attempts are reachable only through the RPCs above.
create policy learner_read on courses for select to authenticated using (published);
create policy own_read on profiles for select using (id = auth.uid());
create policy own_read on enrollments for select using (user_id = auth.uid());
