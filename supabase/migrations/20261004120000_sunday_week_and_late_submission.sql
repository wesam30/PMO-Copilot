-- Weekly reporting policy: the reporting week starts on Sunday.
-- The target reminder is Sunday 10:00 Africa/Cairo; submissions remain open,
-- and are marked late only after Sunday 14:00 Africa/Cairo.

alter table public.project_updates
  add column if not exists submission_state text not null default 'on_time'
    check (submission_state in ('on_time', 'late'));

alter table public.project_updates drop constraint if exists project_updates_week_start_check;
update public.project_updates
set week_start = week_start - 1
where extract(isodow from week_start) = 1;

alter table public.project_updates
  add constraint project_updates_week_start_check
  check (extract(isodow from week_start) = 7);

update public.project_updates
set submission_state = case
  when created_at > ((week_start + time '14:00') at time zone 'Africa/Cairo') then 'late'
  else 'on_time'
end;

create or replace function public.submit_project_update(
  p_project_id text,
  p_week_start date,
  p_planned_percent numeric,
  p_actual_percent numeric,
  p_project_status text,
  p_challenge text,
  p_risk text,
  p_priority text,
  p_next_action text,
  p_target_date date,
  p_manager_intervention_required boolean,
  p_manager_intervention_details text,
  p_completed_exception text
) returns public.project_updates
language plpgsql security definer set search_path = public
as $$
declare
  v_employee_id text := public.current_employee_id();
  v_existing public.project_updates;
  v_result public.project_updates;
  v_submission_state text;
begin
  if v_employee_id is null then raise exception 'Active account required' using errcode = '42501'; end if;
  if not exists (select 1 from public.project_assignments a where a.project_id = p_project_id and a.employee_id = v_employee_id and a.active) then
    raise exception 'Project is not assigned to the current engineer' using errcode = '42501';
  end if;
  if extract(isodow from p_week_start) <> 7 then raise exception 'week_start must be a Sunday' using errcode = '22023'; end if;
  if p_planned_percent not between 0 and 100 or p_actual_percent not between 0 and 100 then raise exception 'Percentages must be between 0 and 100' using errcode = '22023'; end if;
  if p_project_status = 'completed' and p_actual_percent < 100 and nullif(btrim(coalesce(p_completed_exception, '')), '') is null then
    raise exception 'Completed below 100%% requires a documented exception' using errcode = '22023';
  end if;
  if coalesce(p_manager_intervention_required, false) and nullif(btrim(coalesce(p_manager_intervention_details, '')), '') is null then
    raise exception 'Manager intervention details are required' using errcode = '22023';
  end if;

  v_submission_state := case when now() > ((p_week_start + time '14:00') at time zone 'Africa/Cairo') then 'late' else 'on_time' end;
  select * into v_existing from public.project_updates
  where project_id = p_project_id and week_start = p_week_start and is_current for update;
  if found then
    update public.project_updates set is_current = false, updated_at = now() where update_id = v_existing.update_id;
  end if;
  insert into public.project_updates (project_id, week_start, version, is_current, submission_state, planned_percent, actual_percent, project_status, challenge, risk, priority, next_action, target_date, manager_intervention_required, manager_intervention_details, completed_exception, submitted_by)
  values (p_project_id, p_week_start, coalesce(v_existing.version, 0) + 1, true, v_submission_state, p_planned_percent, p_actual_percent, p_project_status, nullif(btrim(p_challenge), ''), nullif(btrim(p_risk), ''), p_priority, btrim(p_next_action), p_target_date, coalesce(p_manager_intervention_required, false), nullif(btrim(p_manager_intervention_details), ''), nullif(btrim(p_completed_exception), ''), v_employee_id)
  returning * into v_result;
  return v_result;
end;
$$;
