-- Applied live as migration admin_portal_operations_and_workforce_status.
-- Full schema is intentionally kept in the Supabase migration history.
-- This local marker documents the feature boundary for the portable project.
-- Adds:
--   * suspended account status
--   * employee_work_status (future HR source boundary)
--   * admin_audit_log and communication_log
--   * admin_review_employee and admin_update_work_status RPCs

alter table public.employees drop constraint if exists employees_account_status_check;
update public.employees set account_status = 'suspended' where account_status = 'inactive';
alter table public.employees add constraint employees_account_status_check
  check (account_status in ('pending', 'active', 'suspended', 'rejected'));

create table if not exists public.employee_work_status (
  employee_id text primary key references public.employees(employee_id) on delete cascade,
  work_status text not null default 'not_provided' check (work_status in ('not_provided','available','on_leave','unavailable')),
  leave_type text,
  leave_reason text,
  leave_start_date date,
  expected_return_date date,
  source text not null default 'manual' check (source in ('manual','hr')),
  source_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by text references public.employees(employee_id),
  constraint employee_work_status_leave_dates_check check (expected_return_date is null or leave_start_date is null or expected_return_date >= leave_start_date),
  constraint employee_work_status_leave_details_check check (work_status='on_leave' or (leave_type is null and leave_reason is null and leave_start_date is null and expected_return_date is null))
);

insert into public.employee_work_status(employee_id)
select employee_id from public.employees on conflict (employee_id) do nothing;

create table if not exists public.admin_audit_log (
  audit_id bigint generated always as identity primary key,
  action text not null,
  target_type text not null,
  target_id text not null,
  details jsonb not null default '{}'::jsonb,
  initiated_by text not null references public.employees(employee_id),
  created_at timestamptz not null default now()
);

create table if not exists public.communication_log (
  communication_id bigint generated always as identity primary key,
  event_type text not null check (event_type in ('account_approved','account_changed','projects_changed','portfolio_report')),
  recipient_email text not null,
  related_employee_id text references public.employees(employee_id),
  delivery_status text not null check (delivery_status in ('sent','failed','previewed')),
  error_message text,
  initiated_by text not null references public.employees(employee_id),
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_target_idx on public.admin_audit_log(target_type,target_id,created_at desc);
create index if not exists admin_audit_log_initiated_by_idx on public.admin_audit_log(initiated_by,created_at desc);
create index if not exists communication_log_employee_idx on public.communication_log(related_employee_id,created_at desc);
create index if not exists communication_log_initiated_by_idx on public.communication_log(initiated_by,created_at desc);

create or replace function public.admin_review_employee(
  p_employee_id text,
  p_account_status text,
  p_access_role text,
  p_project_ids text[] default array[]::text[],
  p_change_note text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_admin_id text := public.current_employee_id();
  v_employee public.employees;
  v_previous jsonb;
  v_project_id text;
  v_project_ids text[] := coalesce(p_project_ids,array[]::text[]);
begin
  if v_admin_id is null or not public.has_access_role('admin') then raise exception 'Admin access required' using errcode='42501'; end if;
  if p_account_status not in ('pending','active','suspended','rejected') then raise exception 'Invalid account status' using errcode='22023'; end if;
  if p_access_role is not null and p_access_role not in ('engineer','manager','admin') then raise exception 'Invalid access role' using errcode='22023'; end if;

  select * into v_employee from public.employees where employee_id=p_employee_id for update;
  if not found then raise exception 'Employee not found' using errcode='P0002'; end if;
  if p_account_status='active' and v_employee.auth_user_id is null then raise exception 'The employee has not created an account yet' using errcode='22023'; end if;
  if p_account_status='active' and p_access_role is null then raise exception 'Choose an access role before activation' using errcode='22023'; end if;
  if p_account_status='active' and p_access_role<>'engineer' and cardinality(v_project_ids)>0 then raise exception 'Responsible projects can only be assigned to an engineer role' using errcode='22023'; end if;
  if cardinality(v_project_ids)<>cardinality(array(select distinct unnest(v_project_ids))) then raise exception 'Duplicate project selection' using errcode='22023'; end if;
  if exists(select 1 from unnest(v_project_ids) s(project_id) left join public.projects p on p.project_id=s.project_id where p.project_id is null) then raise exception 'One or more projects do not exist' using errcode='22023'; end if;

  v_previous:=jsonb_build_object('account_status',v_employee.account_status,'access_role',v_employee.access_role,'projects',coalesce((select jsonb_agg(a.project_id order by a.project_id) from public.project_assignments a where a.employee_id=p_employee_id and a.active),'[]'::jsonb));
  update public.employees set account_status=p_account_status,access_role=p_access_role,status_changed_at=now(),review_stage=case when p_account_status='active' then 'approved' when p_account_status='pending' then 'reviewed' else review_stage end,approved_at=case when p_account_status='active' then now() else approved_at end,approved_by=case when p_account_status='active' then v_admin_id else approved_by end where employee_id=p_employee_id returning * into v_employee;

  if p_account_status='active' and p_access_role='engineer' then
    update public.project_assignments set active=false,ended_at=now() where employee_id=p_employee_id and active and not(project_id=any(v_project_ids));
    foreach v_project_id in array v_project_ids loop
      update public.project_assignments set active=false,ended_at=now() where project_id=v_project_id and active and employee_id<>p_employee_id;
      if not exists(select 1 from public.project_assignments where project_id=v_project_id and employee_id=p_employee_id and active) then insert into public.project_assignments(project_id,employee_id,assigned_by) values(v_project_id,p_employee_id,v_admin_id); end if;
      update public.projects set employee_id=p_employee_id where project_id=v_project_id;
    end loop;
  end if;

  insert into public.admin_audit_log(action,target_type,target_id,details,initiated_by) values(case when p_account_status='active' then 'approve_or_update_access' else 'change_account_status' end,'employee',p_employee_id,jsonb_build_object('before',v_previous,'after',jsonb_build_object('account_status',p_account_status,'access_role',p_access_role,'projects',to_jsonb(v_project_ids)),'note',nullif(btrim(coalesce(p_change_note,'')),'')),v_admin_id);
  return jsonb_build_object('employee_id',v_employee.employee_id,'employee_name',v_employee.employee_name,'email',v_employee.email,'account_status',v_employee.account_status,'access_role',v_employee.access_role,'project_ids',to_jsonb(v_project_ids));
end; $$;

create or replace function public.admin_update_work_status(
  p_employee_id text,p_work_status text,p_leave_type text default null,p_leave_reason text default null,
  p_leave_start_date date default null,p_expected_return_date date default null,p_source text default 'manual'
) returns public.employee_work_status language plpgsql security definer set search_path=public as $$
declare v_admin_id text:=public.current_employee_id();v_result public.employee_work_status;
begin
  if v_admin_id is null or not public.has_access_role('admin') then raise exception 'Admin access required' using errcode='42501'; end if;
  if p_work_status not in ('not_provided','available','on_leave','unavailable') then raise exception 'Invalid employee status' using errcode='22023'; end if;
  if p_source not in ('manual','hr') then raise exception 'Invalid status source' using errcode='22023'; end if;
  if p_work_status='on_leave' and p_expected_return_date is null then raise exception 'Expected return date is required for leave' using errcode='22023'; end if;
  insert into public.employee_work_status(employee_id,work_status,leave_type,leave_reason,leave_start_date,expected_return_date,source,source_updated_at,updated_at,updated_by)
  values(p_employee_id,p_work_status,case when p_work_status='on_leave' then nullif(btrim(coalesce(p_leave_type,'')),'') end,case when p_work_status='on_leave' then nullif(btrim(coalesce(p_leave_reason,'')),'') end,case when p_work_status='on_leave' then p_leave_start_date end,case when p_work_status='on_leave' then p_expected_return_date end,p_source,now(),now(),v_admin_id)
  on conflict(employee_id) do update set work_status=excluded.work_status,leave_type=excluded.leave_type,leave_reason=excluded.leave_reason,leave_start_date=excluded.leave_start_date,expected_return_date=excluded.expected_return_date,source=excluded.source,source_updated_at=excluded.source_updated_at,updated_at=excluded.updated_at,updated_by=excluded.updated_by returning * into v_result;
  insert into public.admin_audit_log(action,target_type,target_id,details,initiated_by) values('update_work_status','employee',p_employee_id,to_jsonb(v_result),v_admin_id);
  return v_result;
end; $$;

alter table public.employee_work_status enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.communication_log enable row level security;
create policy "work_status_select_leadership" on public.employee_work_status for select to authenticated using(employee_id=(select public.current_employee_id()) or (select public.has_access_role('manager')) or (select public.has_access_role('admin')));
create policy "audit_log_select_admin" on public.admin_audit_log for select to authenticated using((select public.has_access_role('admin')));
create policy "communication_log_select_admin" on public.communication_log for select to authenticated using((select public.has_access_role('admin')));

revoke all on table public.employee_work_status,public.admin_audit_log,public.communication_log from anon,authenticated;
grant select on table public.employee_work_status,public.admin_audit_log,public.communication_log to authenticated;
grant all on table public.employee_work_status,public.admin_audit_log,public.communication_log to service_role;
revoke all on function public.admin_review_employee(text,text,text,text[],text) from public,anon;
revoke all on function public.admin_update_work_status(text,text,text,text,date,date,text) from public,anon;
grant execute on function public.admin_review_employee(text,text,text,text[],text) to authenticated;
grant execute on function public.admin_update_work_status(text,text,text,text,date,date,text) to authenticated;
