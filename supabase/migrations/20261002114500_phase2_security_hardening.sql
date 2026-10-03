-- Explicitly deny all anonymous execution and add advisor-recommended foreign-key indexes.
revoke execute on function public.current_employee_id() from anon;
revoke execute on function public.has_access_role(text) from anon;
revoke execute on function public.submit_project_update(text,date,numeric,numeric,text,text,text,text,text,date,boolean,text,text) from anon;
revoke execute on function public.admin_set_employee_access(text,text,text,text) from anon;
revoke execute on function public.admin_assign_project(text,text) from anon;

create index if not exists employees_approved_by_idx on public.employees(approved_by);
create index if not exists project_assignments_assigned_by_idx on public.project_assignments(assigned_by);
create index if not exists project_updates_submitted_by_idx on public.project_updates(submitted_by);

drop policy if exists "employees_select_self_or_leadership" on public.employees;
create policy "employees_select_self_or_leadership" on public.employees for select to authenticated using (
  (auth_user_id = (select auth.uid()) and account_status = 'active') or (select public.has_access_role('manager')) or (select public.has_access_role('admin'))
);

-- Table privileges allow authenticated requests to reach the RLS policies;
-- RLS still controls which employee and project rows each account can read.
grant select on table public.employees, public.projects to authenticated;
