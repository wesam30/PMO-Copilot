-- PMO Copilot Phase 2 MVP: identity, access control, assignments, and weekly updates.
-- Existing employee and project records are preserved.

alter table public.employees
  add column if not exists auth_user_id uuid unique,
  add column if not exists account_status text not null default 'pending'
    check (account_status in ('pending', 'active', 'inactive', 'rejected')),
  add column if not exists access_role text
    check (access_role in ('engineer', 'manager', 'admin')),
  add column if not exists specialty text,
  add column if not exists review_stage text not null default 'submitted'
    check (review_stage in ('submitted', 'reviewed', 'approved')),
  add column if not exists status_changed_at timestamptz not null default now(),
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by text references public.employees(employee_id);

create table if not exists public.project_assignments (
  assignment_id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(project_id) on delete cascade,
  employee_id text not null references public.employees(employee_id) on delete restrict,
  assigned_at timestamptz not null default now(),
  assigned_by text references public.employees(employee_id),
  ended_at timestamptz,
  active boolean not null default true,
  constraint project_assignments_dates_check check (ended_at is null or ended_at >= assigned_at)
);

create unique index if not exists project_assignments_one_active_engineer_idx
  on public.project_assignments(project_id) where active;
create index if not exists project_assignments_employee_active_idx
  on public.project_assignments(employee_id) where active;

create table if not exists public.project_updates (
  update_id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(project_id) on delete cascade,
  week_start date not null,
  version integer not null default 1 check (version > 0),
  is_current boolean not null default true,
  planned_percent numeric(5,2) not null check (planned_percent between 0 and 100),
  actual_percent numeric(5,2) not null check (actual_percent between 0 and 100),
  variance numeric(5,2) generated always as (actual_percent - planned_percent) stored,
  project_status text not null check (project_status in ('not_started', 'on_track', 'at_risk', 'delayed', 'completed')),
  challenge text,
  risk text,
  priority text not null check (priority in ('low', 'medium', 'high', 'critical')),
  next_action text not null,
  target_date date,
  manager_intervention_required boolean not null default false,
  manager_intervention_details text,
  completed_exception text,
  submitted_by text not null references public.employees(employee_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_updates_week_start_check check (extract(isodow from week_start) = 1),
  constraint project_updates_completed_check check (project_status <> 'completed' or actual_percent = 100 or nullif(btrim(coalesce(completed_exception, '')), '') is not null),
  constraint project_updates_intervention_check check (not manager_intervention_required or nullif(btrim(coalesce(manager_intervention_details, '')), '') is not null)
);

create unique index if not exists project_updates_one_current_week_idx
  on public.project_updates(project_id, week_start) where is_current;
create unique index if not exists project_updates_version_idx
  on public.project_updates(project_id, week_start, version);
create index if not exists project_updates_current_summary_idx
  on public.project_updates(project_id, week_start desc) where is_current;

create or replace function public.current_employee_id()
returns text language sql stable security definer set search_path = public
as $$
  select e.employee_id from public.employees e
  where e.auth_user_id = auth.uid() and e.account_status = 'active'
  limit 1;
$$;

create or replace function public.has_access_role(p_role text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.employees e
    where e.auth_user_id = auth.uid() and e.account_status = 'active' and e.access_role = p_role
  );
$$;

revoke all on function public.current_employee_id() from public;
revoke all on function public.has_access_role(text) from public;
grant execute on function public.current_employee_id() to authenticated;
grant execute on function public.has_access_role(text) to authenticated;

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
begin
  if v_employee_id is null then raise exception 'Active account required' using errcode = '42501'; end if;
  if not exists (select 1 from public.project_assignments a where a.project_id = p_project_id and a.employee_id = v_employee_id and a.active) then
    raise exception 'Project is not assigned to the current engineer' using errcode = '42501';
  end if;
  if extract(isodow from p_week_start) <> 1 then raise exception 'week_start must be a Monday' using errcode = '22023'; end if;
  if p_planned_percent not between 0 and 100 or p_actual_percent not between 0 and 100 then raise exception 'Percentages must be between 0 and 100' using errcode = '22023'; end if;
  if p_project_status = 'completed' and p_actual_percent < 100 and nullif(btrim(coalesce(p_completed_exception, '')), '') is null then
    raise exception 'Completed below 100%% requires a documented exception' using errcode = '22023';
  end if;
  if coalesce(p_manager_intervention_required, false) and nullif(btrim(coalesce(p_manager_intervention_details, '')), '') is null then
    raise exception 'Manager intervention details are required' using errcode = '22023';
  end if;

  select * into v_existing from public.project_updates
  where project_id = p_project_id and week_start = p_week_start and is_current for update;
  if found then
    update public.project_updates set is_current = false, updated_at = now() where update_id = v_existing.update_id;
  end if;
  insert into public.project_updates (project_id, week_start, version, planned_percent, actual_percent, project_status, challenge, risk, priority, next_action, target_date, manager_intervention_required, manager_intervention_details, completed_exception, submitted_by)
  values (p_project_id, p_week_start, coalesce(v_existing.version, 0) + 1, p_planned_percent, p_actual_percent, p_project_status, nullif(btrim(p_challenge), ''), nullif(btrim(p_risk), ''), p_priority, btrim(p_next_action), p_target_date, coalesce(p_manager_intervention_required, false), nullif(btrim(p_manager_intervention_details), ''), nullif(btrim(p_completed_exception), ''), v_employee_id)
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.admin_set_employee_access(p_employee_id text, p_account_status text, p_access_role text, p_specialty text default null)
returns public.employees language plpgsql security definer set search_path = public
as $$
declare v_result public.employees; begin
  if not public.has_access_role('admin') then raise exception 'Admin access required' using errcode = '42501'; end if;
  if p_account_status not in ('pending','active','inactive','rejected') then raise exception 'Invalid account status' using errcode = '22023'; end if;
  if p_access_role is not null and p_access_role not in ('engineer','manager','admin') then raise exception 'Invalid access role' using errcode = '22023'; end if;
  update public.employees set account_status=p_account_status, access_role=p_access_role, specialty=nullif(btrim(p_specialty), ''), status_changed_at=now(), approved_at=case when p_account_status='active' then now() else approved_at end, approved_by=case when p_account_status='active' then public.current_employee_id() else approved_by end where employee_id=p_employee_id returning * into v_result;
  if not found then raise exception 'Employee not found' using errcode = 'P0002'; end if;
  return v_result;
end; $$;

create or replace function public.admin_assign_project(p_project_id text, p_employee_id text)
returns public.project_assignments language plpgsql security definer set search_path = public
as $$
declare v_result public.project_assignments; begin
  if not public.has_access_role('admin') then raise exception 'Admin access required' using errcode = '42501'; end if;
  if not exists (select 1 from public.employees where employee_id=p_employee_id and account_status='active' and access_role='engineer') then raise exception 'Assignment requires an active engineer' using errcode='22023'; end if;
  update public.project_assignments set active=false, ended_at=now() where project_id=p_project_id and active;
  insert into public.project_assignments(project_id, employee_id, assigned_by) values (p_project_id,p_employee_id,public.current_employee_id()) returning * into v_result;
  return v_result;
end; $$;

revoke all on function public.submit_project_update(text,date,numeric,numeric,text,text,text,text,text,date,boolean,text,text) from public;
revoke all on function public.admin_set_employee_access(text,text,text,text) from public;
revoke all on function public.admin_assign_project(text,text) from public;
grant execute on function public.submit_project_update(text,date,numeric,numeric,text,text,text,text,text,date,boolean,text,text) to authenticated;
grant execute on function public.admin_set_employee_access(text,text,text,text) to authenticated;
grant execute on function public.admin_assign_project(text,text) to authenticated;

alter table public.employees enable row level security;
alter table public.projects enable row level security;
alter table public.project_assignments enable row level security;
alter table public.project_updates enable row level security;

create policy "employees_select_self_or_leadership" on public.employees for select to authenticated using (
  (auth_user_id = auth.uid() and account_status = 'active') or public.has_access_role('manager') or public.has_access_role('admin')
);
create policy "projects_select_assigned_or_leadership" on public.projects for select to authenticated using (
  exists (select 1 from public.project_assignments a where a.project_id=projects.project_id and a.employee_id=public.current_employee_id() and a.active) or public.has_access_role('manager') or public.has_access_role('admin')
);
create policy "assignments_select_own_or_leadership" on public.project_assignments for select to authenticated using (
  employee_id=public.current_employee_id() or public.has_access_role('manager') or public.has_access_role('admin')
);
create policy "updates_select_assigned_or_leadership" on public.project_updates for select to authenticated using (
  exists (select 1 from public.project_assignments a where a.project_id=project_updates.project_id and a.employee_id=public.current_employee_id() and a.active) or public.has_access_role('manager') or public.has_access_role('admin')
);

