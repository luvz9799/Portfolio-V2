-- Camera check while watching videos and taking tests (run after checkpoints.sql).
-- The camera picture never leaves the learner's device: only events like "face not visible" are stored.
-- A learner whose camera does not work asks for approval; until an admin approves, videos and tests stay locked.

alter table profiles add column if not exists camera_exempt boolean not null default false;
alter table profiles add column if not exists camera_request text;
alter table profiles add column if not exists camera_request_at timestamptz;

-- learners can only read their own profile, so asking for approval goes through this function
create or replace function request_camera_exempt(p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Please write what the problem with the camera is'; end if;
  update profiles set camera_request = left(trim(p_reason), 500), camera_request_at = now()
  where id = auth.uid() and not camera_exempt;
end $$;

-- test events: + no_face (face not visible for a while), multi_face (more than one face), camera_off
create or replace function log_attempt_event(p_attempt uuid, p_type text) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if p_type not in ('left_page', 'copy', 'paste', 'exit_fullscreen', 'no_face', 'multi_face', 'camera_off') then raise exception 'Unknown event'; end if;
  update attempts set events = events || jsonb_build_object('type', p_type, 'at', now())
  where id = p_attempt and user_id = auth.uid() and submitted_at is null and jsonb_array_length(events) < 200
  returning jsonb_array_length(events) into v_n;
  return coalesce(v_n, 0);
end $$;

-- video events: + no_face, camera_off
create or replace function log_video_event(p_module uuid, p_video text, p_type text) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if p_type not in ('left_page', 'no_face', 'camera_off') then raise exception 'Unknown event'; end if;
  if not module_unlocked(p_module) then raise exception 'Module locked'; end if;
  if p_video !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'Unknown video'; end if;
  insert into video_progress (user_id, module_id, video_id, events)
  values (auth.uid(), p_module, p_video, jsonb_build_array(jsonb_build_object('type', p_type, 'at', now())))
  on conflict (user_id, module_id, video_id) do update
    set events = case when jsonb_array_length(video_progress.events) < 200
                      then video_progress.events || jsonb_build_object('type', p_type, 'at', now())
                      else video_progress.events end
  returning jsonb_array_length(events) into v_n;
  return v_n;
end $$;
